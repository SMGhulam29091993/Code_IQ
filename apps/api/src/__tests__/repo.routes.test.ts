import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { app } from "../app";

vi.mock("@codeiq/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    installation: { findUnique: vi.fn() },
    repo: { findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), count: vi.fn() },
    repoConfig: { upsert: vi.fn(), create: vi.fn() },
    review: { count: vi.fn() },
    reviewIssue: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
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

vi.mock("@octokit/rest", () => ({ Octokit: vi.fn().mockImplementation(() => ({ rest: {} })) }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn() }));
vi.mock("../jobs/queue", () => ({ reviewQueue: { add: vi.fn() } }));

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

function buildRepo(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "repo-1",
    githubRepoId: 222,
    fullName: "acme/widgets",
    language: "TypeScript",
    installationId: "install-1",
    isActive: false,
    createdAt: NOW,
    updatedAt: NOW,
    config: null,
    installation: { userId: "user-1", planTier: "FREE" },
    ...overrides,
  };
}

function accessTokenFor(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: "15m" });
}

function mockPrisma() {
  return prisma as unknown as {
    user: { findUnique: ReturnType<typeof vi.fn> };
    installation: { findUnique: ReturnType<typeof vi.fn> };
    repo: {
      findMany: ReturnType<typeof vi.fn>;
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
    };
    repoConfig: { upsert: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
    review: { count: ReturnType<typeof vi.fn> };
  };
}

function auth(req: request.Test) {
  return req.set("Authorization", `Bearer ${accessTokenFor("user-1")}`);
}

describe("Repo routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma().user.findUnique.mockResolvedValue(buildUser());
  });

  describe("GET /api/repos", () => {
    it("returns 401 without an Authorization header", async () => {
      const res = await request(app).get("/api/repos");
      expect(res.status).toBe(401);
    });

    it("returns the user's repos with review count and config", async () => {
      mockPrisma().repo.findMany.mockResolvedValueOnce([
        { ...buildRepo(), _count: { reviews: 5 } },
      ]);

      const res = await auth(request(app).get("/api/repos"));

      expect(res.status).toBe(200);
      expect(res.body.data.repos).toHaveLength(1);
      expect(res.body.data.repos[0].reviewCount).toBe(5);
      expect(res.body.data.repos[0].config.severityThreshold).toBe("WARNING");
    });

    it("returns 403 when installationId filter belongs to another user", async () => {
      mockPrisma().installation.findUnique.mockResolvedValueOnce({
        id: "install-1",
        userId: "someone-else",
      });

      const res = await auth(request(app).get("/api/repos").query({ installationId: "install-1" }));

      expect(res.status).toBe(403);
    });

    it("returns 400 when isActive is not a valid boolean string", async () => {
      const res = await auth(request(app).get("/api/repos").query({ isActive: "maybe" }));

      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/repos/:repoId/activate", () => {
    it("activates the repo and creates a default config", async () => {
      mockPrisma()
        .repo.findUnique.mockResolvedValueOnce(buildRepo({ isActive: false, config: null }))
        .mockResolvedValueOnce(buildRepo({ isActive: true, config: { id: "c1" } }));
      mockPrisma().repo.count.mockResolvedValueOnce(0);
      mockPrisma().repoConfig.create.mockResolvedValueOnce({ id: "c1" });
      mockPrisma().review.count.mockResolvedValueOnce(0);

      const res = await auth(request(app).post("/api/repos/repo-1/activate"));

      expect(res.status).toBe(200);
      expect(res.body.data.repo.isActive).toBe(true);
      expect(mockPrisma().repo.update).toHaveBeenCalledWith({
        where: { id: "repo-1" },
        data: { isActive: true },
      });
    });

    it("returns 404 for an unknown repoId", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(null);

      const res = await auth(request(app).post("/api/repos/missing/activate"));

      expect(res.status).toBe(404);
    });

    it("returns 403 when the repo belongs to another user's installation", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      const res = await auth(request(app).post("/api/repos/repo-1/activate"));

      expect(res.status).toBe(403);
    });

    it("returns 403 with the plan-limit message when the FREE tier's 3-repo limit is reached", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo({ isActive: false }));
      mockPrisma().repo.count.mockResolvedValueOnce(3);

      const res = await auth(request(app).post("/api/repos/repo-1/activate"));

      expect(res.status).toBe(403);
      expect(res.body.message).toBe("Plan limit: upgrade to activate more repos");
    });
  });

  describe("POST /api/repos/:repoId/deactivate", () => {
    it("deactivates the repo", async () => {
      mockPrisma()
        .repo.findUnique.mockResolvedValueOnce(buildRepo({ isActive: true }))
        .mockResolvedValueOnce(buildRepo({ isActive: false }));
      mockPrisma().review.count.mockResolvedValueOnce(0);

      const res = await auth(request(app).post("/api/repos/repo-1/deactivate"));

      expect(res.status).toBe(200);
      expect(res.body.data.repo.isActive).toBe(false);
    });

    it("returns 404 for an unknown repoId", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(null);

      const res = await auth(request(app).post("/api/repos/missing/deactivate"));

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/repos/:repoId/config", () => {
    it("returns default config values when no RepoConfig row exists", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo({ config: null }));

      const res = await auth(request(app).get("/api/repos/repo-1/config"));

      expect(res.status).toBe(200);
      expect(res.body.data.config.enabledCategories).toEqual([
        "bug",
        "security",
        "performance",
        "logic",
      ]);
    });

    it("returns 403 when the repo belongs to another user", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      const res = await auth(request(app).get("/api/repos/repo-1/config"));

      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/repos/:repoId/config", () => {
    it("returns 400 when enabledCategories is an empty array", async () => {
      const res = await auth(
        request(app).patch("/api/repos/repo-1/config").send({ enabledCategories: [] })
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("At least one category must be enabled");
    });

    it("returns 400 for an invalid glob pattern in ignorePatterns", async () => {
      const res = await auth(
        request(app).patch("/api/repos/repo-1/config").send({ ignorePatterns: ["[invalid"] })
      );

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid glob pattern: [invalid");
    });

    it("returns a no-op 200 for an empty body", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo());
      mockPrisma().repoConfig.upsert.mockResolvedValueOnce({
        severityThreshold: "WARNING",
        enabledCategories: ["bug"],
        ignorePatterns: [],
        reviewOnDraft: false,
        postSummaryComment: true,
      });

      const res = await auth(request(app).patch("/api/repos/repo-1/config").send({}));

      expect(res.status).toBe(200);
    });

    it("partially updates only provided fields and returns the full config", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo());
      mockPrisma().repoConfig.upsert.mockResolvedValueOnce({
        severityThreshold: "CRITICAL",
        enabledCategories: ["bug", "security", "performance", "logic"],
        ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**", "node_modules/**"],
        reviewOnDraft: false,
        postSummaryComment: true,
      });

      const res = await auth(
        request(app).patch("/api/repos/repo-1/config").send({ severityThreshold: "CRITICAL" })
      );

      expect(res.status).toBe(200);
      expect(res.body.data.config.severityThreshold).toBe("CRITICAL");
    });

    it("returns 403 when the repo belongs to another user", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      const res = await auth(
        request(app).patch("/api/repos/repo-1/config").send({ severityThreshold: "CRITICAL" })
      );

      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/repos/:repoId/stats", () => {
    it("returns aggregate stats for an owned repo", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo());
      mockPrisma().review.count.mockResolvedValueOnce(0);

      const res = await auth(request(app).get("/api/repos/repo-1/stats"));

      expect(res.status).toBe(200);
      expect(res.body.data.totalReviews).toBe(0);
      expect(res.body.data.issuesBySeverity).toEqual({ critical: 0, warning: 0, info: 0 });
    });

    it("returns 404 for an unknown repoId", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(null);

      const res = await auth(request(app).get("/api/repos/missing/stats"));

      expect(res.status).toBe(404);
    });
  });
});
