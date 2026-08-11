import crypto from "node:crypto";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { app } from "../app";
import { reviewQueue } from "../jobs/queue";
import { env } from "../lib/env";

vi.mock("@codeiq/db", () => ({
  prisma: {
    installation: { findUnique: vi.fn(), updateMany: vi.fn() },
    repo: { findUnique: vi.fn(), updateMany: vi.fn(), upsert: vi.fn() },
    review: { count: vi.fn() },
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

function buildInstallation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "install-1",
    githubInstallationId: 111,
    accountLogin: "acme",
    accountType: "Organization",
    userId: "user-1",
    planTier: "FREE",
    seatCount: 0,
    isActive: true,
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
    installationId: "install-1",
    isActive: true,
    config: { reviewOnDraft: false },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildPullRequestBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    action: "opened",
    installation: { id: 111 },
    repository: { id: 222, full_name: "acme/widgets" },
    pull_request: {
      number: 42,
      title: "Add feature",
      draft: false,
      user: { login: "octocat" },
      head: { sha: "abc123" },
    },
    ...overrides,
  };
}

function sign(payload: string) {
  return "sha256=" + crypto.createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(payload).digest("hex");
}

function mockPrisma() {
  return prisma as unknown as {
    installation: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    repo: {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
      upsert: ReturnType<typeof vi.fn>;
    };
    review: { count: ReturnType<typeof vi.fn> };
  };
}

function postWebhook(body: unknown, opts: { event?: string; signature?: string | null } = {}) {
  const payload = JSON.stringify(body);
  const req = request(app)
    .post("/api/webhooks/github")
    .set("Content-Type", "application/json")
    .set("X-GitHub-Event", opts.event ?? "pull_request")
    .set("X-GitHub-Delivery", "delivery-1");

  if (opts.signature !== null) {
    req.set("X-Hub-Signature-256", opts.signature ?? sign(payload));
  }
  return req.send(payload);
}

describe("Webhook routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when the signature header is missing", async () => {
    const res = await postWebhook(buildPullRequestBody(), { signature: null });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Missing signature");
  });

  it("returns 401 when the signature does not match", async () => {
    const res = await postWebhook(buildPullRequestBody(), { signature: "sha256=deadbeef" });
    expect(res.status).toBe(401);
    expect(res.body.message).toBe("Invalid signature");
  });

  it("returns 200 and enqueues a review job for pull_request.opened", async () => {
    mockPrisma().installation.findUnique.mockResolvedValueOnce(buildInstallation());
    mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo());
    mockPrisma().review.count.mockResolvedValueOnce(0);

    const res = await postWebhook(buildPullRequestBody({ action: "opened" }));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("OK");
    expect(reviewQueue.add).toHaveBeenCalledWith(
      "review-pr",
      expect.objectContaining({ repoId: "repo-1", installationId: "install-1" }),
      { jobId: "delivery-1" }
    );
  });

  it("returns 200 without enqueuing for pull_request.closed", async () => {
    const res = await postWebhook(buildPullRequestBody({ action: "closed" }));

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Action ignored");
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it("returns 200 without enqueuing when the installation is inactive", async () => {
    mockPrisma().installation.findUnique.mockResolvedValueOnce(
      buildInstallation({ isActive: false })
    );

    const res = await postWebhook(buildPullRequestBody());

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Installation not active");
    expect(reviewQueue.add).not.toHaveBeenCalled();
  });

  it("marks the installation inactive on installation.deleted", async () => {
    const res = await postWebhook(
      { action: "deleted", installation: { id: 111 } },
      { event: "installation" }
    );

    expect(res.status).toBe(200);
    expect(mockPrisma().installation.updateMany).toHaveBeenCalledWith({
      where: { githubInstallationId: 111 },
      data: { isActive: false },
    });
  });

  it("deactivates repos on installation_repositories.removed", async () => {
    const res = await postWebhook(
      { action: "removed", repositories_removed: [{ id: 1 }, { id: 2 }] },
      { event: "installation_repositories" }
    );

    expect(res.status).toBe(200);
    expect(mockPrisma().repo.updateMany).toHaveBeenCalledTimes(2);
  });

  it("creates repos on installation_repositories.added when the installation is known", async () => {
    mockPrisma().installation.findUnique.mockResolvedValueOnce(buildInstallation());

    const res = await postWebhook(
      {
        action: "added",
        installation: { id: 111 },
        repositories_added: [{ id: 1, full_name: "acme/one" }],
      },
      { event: "installation_repositories" }
    );

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Repos synced");
    expect(mockPrisma().repo.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns 200 for unhandled event types", async () => {
    const res = await postWebhook({ action: "created" }, { event: "star" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("Event ignored");
  });

  it("returns 503 when the review queue is unreachable", async () => {
    mockPrisma().installation.findUnique.mockResolvedValueOnce(buildInstallation());
    mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo());
    mockPrisma().review.count.mockResolvedValueOnce(0);
    vi.mocked(reviewQueue.add).mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await postWebhook(buildPullRequestBody());

    expect(res.status).toBe(503);
  });
});
