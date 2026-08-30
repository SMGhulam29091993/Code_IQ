import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { app } from "../app";
import { redis } from "../lib/redis";

const { mockGetInstallation, mockGetAuthenticated, mockListRepos } = vi.hoisted(() => ({
  mockGetInstallation: vi.fn(),
  mockGetAuthenticated: vi.fn(),
  mockListRepos: vi.fn(),
}));

// Mocked at the module boundary, same approach as auth.routes.test.ts, extended one layer
// further out to the GitHub network calls (Octokit + the OAuth token-exchange fetch call).
vi.mock("@codeiq/db", () => ({
  prisma: {
    user: { findUnique: vi.fn(), update: vi.fn() },
    installation: { findUnique: vi.fn(), upsert: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    repo: { updateMany: vi.fn(), upsert: vi.fn() },
  },
}));

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ping: vi.fn().mockResolvedValue("PONG"),
  })),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue(undefined) }),
  },
}));

vi.mock("@octokit/rest", () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      apps: {
        getInstallation: mockGetInstallation,
        listReposAccessibleToInstallation: mockListRepos,
      },
      users: { getAuthenticated: mockGetAuthenticated },
    },
  })),
}));

vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn() }));

// container.ts wires WebhookService (unused by these routes) with the real reviewQueue,
// which would otherwise open a real BullMQ/ioredis connection on import — see
// webhook.service.test.ts for reviewQueue.add behaviour coverage.
vi.mock("../jobs/queue", () => ({
  reviewCoordinatorQueue: { add: vi.fn() },
  reviewFlowProducer: { add: vi.fn() },
  REVIEW_CHUNK_QUEUE_NAME: "review-chunk-queue",
  REVIEW_FINALIZE_QUEUE_NAME: "review-finalize-queue",
}));

const NOW = new Date("2026-01-01T00:00:00Z");

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Ada Lovelace",
    passwordHash: "hash",
    status: "ACTIVE",
    githubId: null,
    githubLogin: null,
    githubAccessToken: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildInstallation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "install-1",
    githubInstallationId: 123,
    accountLogin: "acme",
    accountType: "Organization",
    userId: "user-1",
    stripeCustomerId: null,
    stripeSubId: null,
    planTier: "FREE",
    seatCount: 0,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function accessTokenFor(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: "15m" });
}

function mockPrisma() {
  return prisma as unknown as {
    user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    installation: {
      findUnique: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    repo: { updateMany: ReturnType<typeof vi.fn>; upsert: ReturnType<typeof vi.fn> };
  };
}

function mockRedis() {
  return redis as unknown as {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    del: ReturnType<typeof vi.fn>;
  };
}

describe("GitHub routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListRepos.mockResolvedValue({ data: { repositories: [] } });
  });

  describe("GET /api/github/oauth/url", () => {
    it("returns 401 without an Authorization header", async () => {
      const res = await request(app).get("/api/github/oauth/url");
      expect(res.status).toBe(401);
    });

    it("returns a GitHub authorize URL when authenticated", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockRedis().set.mockResolvedValueOnce("OK");

      const res = await request(app)
        .get("/api/github/oauth/url")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`);

      expect(res.status).toBe(200);
      expect(res.body.data.url).toContain("https://github.com/login/oauth/authorize?");
    });
  });

  describe("GET /api/github/oauth/callback", () => {
    it("returns 400 when code/state query params are missing", async () => {
      const res = await request(app).get("/api/github/oauth/callback");
      expect(res.status).toBe(400);
    });

    it("returns 400 when the state is invalid or expired", async () => {
      mockRedis().get.mockResolvedValueOnce(null);

      const res = await request(app)
        .get("/api/github/oauth/callback")
        .query({ code: "abc", state: "unknown" });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid or expired state");
    });

    it("redirects to /install on success", async () => {
      mockRedis().get.mockResolvedValueOnce("user-1");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: () => Promise.resolve({ access_token: "gh-token" }),
        })
      );
      mockGetAuthenticated.mockResolvedValueOnce({ data: { id: 999, login: "adalovelace" } });
      mockPrisma().user.findUnique.mockResolvedValueOnce(null);
      mockPrisma().user.update.mockResolvedValueOnce(buildUser());

      const res = await request(app)
        .get("/api/github/oauth/callback")
        .query({ code: "abc", state: "s1" });

      expect(res.status).toBe(302);
      expect(res.headers.location).toBe("http://localhost:3000/install");
      vi.unstubAllGlobals();
    });
  });

  describe("POST /api/github/install", () => {
    it("returns 401 without an Authorization header", async () => {
      const res = await request(app).post("/api/github/install").send({ installationId: 123 });
      expect(res.status).toBe(401);
    });

    it("returns 400 when installationId is not a positive integer", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());

      const res = await request(app)
        .post("/api/github/install")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ installationId: -1 });

      expect(res.status).toBe(400);
    });

    it("returns 201 with the saved installation on success", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockGetInstallation.mockResolvedValueOnce({
        data: { account: { login: "acme", type: "Organization" } },
      });
      mockPrisma().installation.findUnique.mockResolvedValueOnce(null);
      mockPrisma().installation.upsert.mockResolvedValueOnce(buildInstallation());

      const res = await request(app)
        .post("/api/github/install")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ installationId: 123 });

      expect(res.status).toBe(201);
      expect(res.body.data.installation.accountLogin).toBe("acme");
    });

    it("returns 409 when the installation belongs to another user", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockGetInstallation.mockResolvedValueOnce({
        data: { account: { login: "acme", type: "Organization" } },
      });
      mockPrisma().installation.findUnique.mockResolvedValueOnce(
        buildInstallation({ userId: "someone-else" })
      );

      const res = await request(app)
        .post("/api/github/install")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ installationId: 123 });

      expect(res.status).toBe(409);
    });

    it("returns 404 when GitHub does not know the installation", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockGetInstallation.mockRejectedValueOnce({ status: 404 });

      const res = await request(app)
        .post("/api/github/install")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ installationId: 123 });

      expect(res.status).toBe(404);
    });

    it("syncs repos from GitHub and reflects the count in the response", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockGetInstallation.mockResolvedValueOnce({
        data: { account: { login: "acme", type: "Organization" } },
      });
      mockPrisma().installation.findUnique.mockResolvedValueOnce(null);
      mockPrisma().installation.upsert.mockResolvedValueOnce(buildInstallation());
      mockListRepos.mockResolvedValueOnce({
        data: {
          repositories: [
            { id: 1, full_name: "acme/one", language: "TypeScript" },
            { id: 2, full_name: "acme/two", language: null },
          ],
        },
      });

      const res = await request(app)
        .post("/api/github/install")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ installationId: 123 });

      expect(res.status).toBe(201);
      expect(res.body.data.installation.repoCount).toBe(2);
      expect(mockPrisma().repo.upsert).toHaveBeenCalledTimes(2);
    });
  });

  describe("GET /api/github/installations", () => {
    it("returns the list of active installations for the current user", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findMany.mockResolvedValueOnce([
        { ...buildInstallation(), _count: { repos: 2 } },
      ]);

      const res = await request(app)
        .get("/api/github/installations")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`);

      expect(res.status).toBe(200);
      expect(res.body.data.installations).toHaveLength(1);
      expect(res.body.data.installations[0].repoCount).toBe(2);
    });
  });

  describe("DELETE /api/github/installations/:installationId", () => {
    it("returns 404 when the installation does not exist", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findUnique.mockResolvedValueOnce(null);

      const res = await request(app)
        .delete("/api/github/installations/missing")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`);

      expect(res.status).toBe(404);
    });

    it("returns 403 when the installation belongs to another user", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findUnique.mockResolvedValueOnce(
        buildInstallation({ userId: "someone-else" })
      );

      const res = await request(app)
        .delete("/api/github/installations/install-1")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`);

      expect(res.status).toBe(403);
    });

    it("returns 200 and removes the installation when owned by the current user", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findUnique.mockResolvedValueOnce(buildInstallation());
      mockPrisma().installation.update.mockResolvedValueOnce({});

      const res = await request(app)
        .delete("/api/github/installations/install-1")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`);

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Installation removed");
    });
  });
});
