import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { app } from "../app";
import { reviewFlowProducer } from "../jobs/queue";

vi.mock("@codeiq/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    repo: { findUnique: vi.fn() },
    review: { findUnique: vi.fn(), update: vi.fn(), count: vi.fn(), findMany: vi.fn() },
    reviewIssue: { groupBy: vi.fn().mockResolvedValue([]), findMany: vi.fn().mockResolvedValue([]) },
    reviewChunk: { findMany: vi.fn().mockResolvedValue([]) },
    installation: { findUnique: vi.fn() },
    repoConfig: { findUnique: vi.fn().mockResolvedValue(null) },
    $transaction: vi.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
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

function buildReview(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "review-1",
    repoId: "repo-1",
    prNumber: 42,
    prTitle: "Add feature",
    prAuthor: "octocat",
    headSha: "sha123",
    status: "DONE",
    summary: "All good.",
    filesReviewed: 3,
    githubReviewId: 999,
    createdAt: NOW,
    updatedAt: NOW,
    issues: [],
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
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    config: null,
    installation: { userId: "user-1", planTier: "FREE" },
    reviews: [], // repo.repository.ts's findByIdForUser selects the latest review for lastReviewAt
    ...overrides,
  };
}

function accessTokenFor(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: "15m" });
}

function mockPrisma() {
  return prisma as unknown as {
    user: { findUnique: ReturnType<typeof vi.fn> };
    repo: { findUnique: ReturnType<typeof vi.fn> };
    review: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      count: ReturnType<typeof vi.fn>;
      findMany: ReturnType<typeof vi.fn>;
    };
    reviewChunk: { findMany: ReturnType<typeof vi.fn> };
    installation: { findUnique: ReturnType<typeof vi.fn> };
  };
}

function auth(req: request.Test) {
  return req.set("Authorization", `Bearer ${accessTokenFor("user-1")}`);
}

describe("Review routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma().user.findUnique.mockResolvedValue(buildUser());
  });

  describe("GET /api/reviews", () => {
    it("returns paginated reviews for the current user", async () => {
      mockPrisma().review.findMany.mockResolvedValueOnce([buildReview()]);
      mockPrisma().review.count.mockResolvedValueOnce(1);

      const res = await auth(request(app).get("/api/reviews"));

      expect(res.status).toBe(200);
      expect(res.body.data.reviews).toHaveLength(1);
      expect(res.body.data.reviews[0]).not.toHaveProperty("issues");
      expect(res.body.data.total).toBe(1);
    });

    it("returns 400 when limit exceeds 100", async () => {
      const res = await auth(request(app).get("/api/reviews").query({ limit: 101 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 when page is less than 1", async () => {
      const res = await auth(request(app).get("/api/reviews").query({ page: 0 }));
      expect(res.status).toBe(400);
    });

    it("returns 400 for an invalid status value", async () => {
      const res = await auth(request(app).get("/api/reviews").query({ status: "BOGUS" }));
      expect(res.status).toBe(400);
    });

    it("returns 403 when repoId belongs to another user's repo", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      const res = await auth(request(app).get("/api/reviews").query({ repoId: "repo-1" }));
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/reviews/:reviewId", () => {
    it("returns the full review with issues for an authorized user", async () => {
      mockPrisma().review.findUnique.mockResolvedValueOnce({
        ...buildReview(),
        repo: { installation: { userId: "user-1" } },
      });

      const res = await auth(request(app).get("/api/reviews/review-1"));

      expect(res.status).toBe(200);
      expect(res.body.data.review.id).toBe("review-1");
    });

    it("returns 404 for an unknown reviewId", async () => {
      mockPrisma().review.findUnique.mockResolvedValueOnce(null);

      const res = await auth(request(app).get("/api/reviews/missing"));
      expect(res.status).toBe(404);
    });

    it("returns 403 when the review belongs to another user", async () => {
      mockPrisma().review.findUnique.mockResolvedValueOnce({
        ...buildReview(),
        repo: { installation: { userId: "someone-else" } },
      });

      const res = await auth(request(app).get("/api/reviews/review-1"));
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/reviews/:reviewId/retry", () => {
    it("resets a FAILED review to RUNNING and re-enters the Flow with its incomplete chunks", async () => {
      mockPrisma().review.findUnique.mockResolvedValueOnce({
        ...buildReview({ status: "FAILED" }),
        repo: { installation: { userId: "user-1" } },
      });
      mockPrisma().repo.findUnique.mockResolvedValueOnce(buildRepo());
      mockPrisma().installation.findUnique.mockResolvedValueOnce({ githubInstallationId: 555 });
      mockPrisma().reviewChunk.findMany.mockResolvedValueOnce([
        { id: "chunk-1", reviewId: "review-1", filename: "a.ts", patch: "@@ -1 +1 @@", chunkIndex: 0, status: "FAILED", attempts: 1 },
      ]);
      mockPrisma().review.update.mockResolvedValueOnce(buildReview({ status: "RUNNING" }));

      const res = await auth(request(app).post("/api/reviews/review-1/retry"));

      expect(res.status).toBe(200);
      expect(res.body.data.review.status).toBe("RUNNING");
      expect(reviewFlowProducer.add).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "finalize-review",
          queueName: "review-finalize-queue",
          data: expect.objectContaining({ reviewId: "review-1" }),
          children: [
            expect.objectContaining({
              name: "review-chunk",
              queueName: "review-chunk-queue",
              data: expect.objectContaining({ reviewId: "review-1", chunkId: "chunk-1" }),
              opts: expect.objectContaining({ jobId: "review-1:chunk-1:retry1" }),
            }),
          ],
        })
      );
    });

    it("returns 400 when the review is not FAILED", async () => {
      mockPrisma().review.findUnique.mockResolvedValueOnce({
        ...buildReview({ status: "DONE" }),
        repo: { installation: { userId: "user-1" } },
      });

      const res = await auth(request(app).post("/api/reviews/review-1/retry"));
      expect(res.status).toBe(400);
    });

    it("returns 404 for an unknown reviewId", async () => {
      mockPrisma().review.findUnique.mockResolvedValueOnce(null);

      const res = await auth(request(app).post("/api/reviews/missing/retry"));
      expect(res.status).toBe(404);
    });

    it("returns 403 when the review belongs to another user", async () => {
      mockPrisma().review.findUnique.mockResolvedValueOnce({
        ...buildReview({ status: "FAILED" }),
        repo: { installation: { userId: "someone-else" } },
      });

      const res = await auth(request(app).post("/api/reviews/review-1/retry"));
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/reviews/stats", () => {
    it("returns aggregate stats for the current user", async () => {
      mockPrisma().review.count.mockResolvedValueOnce(2);

      const res = await auth(request(app).get("/api/reviews/stats"));

      expect(res.status).toBe(200);
      expect(res.body.data.totalReviews).toBe(2);
      expect(res.body.data.issuesBySeverity).toEqual({ critical: 0, warning: 0, info: 0 });
    });

    it("returns 400 when days exceeds 90", async () => {
      const res = await auth(request(app).get("/api/reviews/stats").query({ days: 91 }));
      expect(res.status).toBe(400);
    });

    it("returns 403 when repoId belongs to another user's repo", async () => {
      mockPrisma().repo.findUnique.mockResolvedValueOnce(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      const res = await auth(request(app).get("/api/reviews/stats").query({ repoId: "repo-1" }));
      expect(res.status).toBe(403);
    });
  });
});
