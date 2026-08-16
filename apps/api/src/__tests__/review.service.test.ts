import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Review } from "@codeiq/db";
import { reviewQueue } from "../jobs/queue";
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from "../lib/errors";
import type { IRepoRepository, RepoWithConfigAndOwner } from "../modules/repos/repo.types";
import { ReviewService } from "../modules/reviews/review.service";
import type { IReviewRepository, ReviewWithOwner } from "../modules/reviews/review.types";

vi.mock("../jobs/queue", () => ({ reviewQueue: { add: vi.fn() } }));

const NOW = new Date("2026-01-01T00:00:00Z");

function buildReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "review-1",
    repoId: "repo-1",
    prNumber: 42,
    prTitle: "Add feature",
    prAuthor: "octocat",
    headSha: "abc123",
    status: "FAILED",
    summary: null,
    filesReviewed: 0,
    githubReviewId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildOwnedReview(overrides: Partial<Record<string, unknown>> = {}): ReviewWithOwner {
  return {
    ...buildReview(),
    issues: [],
    repo: { installation: { userId: "user-1" } },
    ...overrides,
  } as unknown as ReviewWithOwner;
}

function buildOwnedRepo(overrides: Partial<Record<string, unknown>> = {}): RepoWithConfigAndOwner {
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
    ...overrides,
  } as unknown as RepoWithConfigAndOwner;
}

describe("ReviewService", () => {
  let reviewRepo: IReviewRepository;
  let repoRepo: IRepoRepository;
  let service: ReviewService;

  beforeEach(() => {
    vi.clearAllMocks();

    reviewRepo = {
      findManyForUser: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      countForUser: vi.fn(),
      countIssuesBySeverityForUser: vi.fn(),
      countIssuesByCategoryForUser: vi.fn(),
      countIssuesByDayForUser: vi.fn(),
    };
    repoRepo = {
      findManyForUser: vi.fn(),
      findByIdForUser: vi.fn(),
      setActive: vi.fn(),
      countActiveForInstallation: vi.fn(),
      countReviews: vi.fn(),
    };

    service = new ReviewService(reviewRepo, repoRepo);
  });

  describe("listReviews", () => {
    it("returns only reviews for the current user's installations", async () => {
      vi.mocked(reviewRepo.findManyForUser).mockResolvedValue({
        reviews: [buildReview()],
        total: 1,
      });

      const result = await service.listReviews("user-1", { page: 1, limit: 20 });

      expect(reviewRepo.findManyForUser).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ page: 1, limit: 20 })
      );
      expect(result.reviews).toHaveLength(1);
    });

    it("filters by repoId when provided, after verifying ownership", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildOwnedRepo());
      vi.mocked(reviewRepo.findManyForUser).mockResolvedValue({ reviews: [], total: 0 });

      await service.listReviews("user-1", { repoId: "repo-1", page: 1, limit: 20 });

      expect(reviewRepo.findManyForUser).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ repoId: "repo-1" })
      );
    });

    it("filters by status when provided", async () => {
      vi.mocked(reviewRepo.findManyForUser).mockResolvedValue({ reviews: [], total: 0 });

      await service.listReviews("user-1", { status: "DONE", page: 1, limit: 20 });

      expect(reviewRepo.findManyForUser).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ status: "DONE" })
      );
    });

    it("paginates correctly with page and limit", async () => {
      vi.mocked(reviewRepo.findManyForUser).mockResolvedValue({ reviews: [], total: 45 });

      const result = await service.listReviews("user-1", { page: 2, limit: 20 });

      expect(result.page).toBe(2);
      expect(result.totalPages).toBe(3);
    });

    it("throws ForbiddenError when repoId belongs to another user", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildOwnedRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      await expect(
        service.listReviews("user-1", { repoId: "repo-1", page: 1, limit: 20 })
      ).rejects.toThrow(ForbiddenError);
    });

    it("returns empty array with total:0 when no reviews exist", async () => {
      vi.mocked(reviewRepo.findManyForUser).mockResolvedValue({ reviews: [], total: 0 });

      const result = await service.listReviews("user-1", { page: 1, limit: 20 });

      expect(result).toEqual({ reviews: [], total: 0, page: 1, totalPages: 0 });
    });

    it("does not include an issues array in list response items", async () => {
      vi.mocked(reviewRepo.findManyForUser).mockResolvedValue({
        reviews: [buildReview()],
        total: 1,
      });

      const result = await service.listReviews("user-1", { page: 1, limit: 20 });

      expect(result.reviews[0]).not.toHaveProperty("issues");
    });
  });

  describe("getReview", () => {
    it("returns full review with issues for authorized user", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(
        buildOwnedReview({
          issues: [
            {
              id: "issue-1",
              file: "a.ts",
              line: 1,
              severity: "critical",
              category: "bug",
              message: "m",
              suggestion: "s",
            },
          ],
        })
      );

      const result = await service.getReview("user-1", "review-1");

      expect(result.review.issues).toHaveLength(1);
      expect(result.review.issues[0]).toEqual({
        id: "issue-1",
        file: "a.ts",
        line: 1,
        severity: "critical",
        category: "bug",
        message: "m",
        suggestion: "s",
      });
    });

    it("throws NotFoundError for unknown reviewId", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(null);

      await expect(service.getReview("user-1", "missing")).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError when review belongs to another user", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(
        buildOwnedReview({ repo: { installation: { userId: "someone-else" } } })
      );

      await expect(service.getReview("user-1", "review-1")).rejects.toThrow(ForbiddenError);
    });

    it("returns empty issues array when review is PENDING", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(
        buildOwnedReview({ status: "PENDING", issues: [] })
      );

      const result = await service.getReview("user-1", "review-1");

      expect(result.review.issues).toEqual([]);
    });
  });

  describe("retryReview", () => {
    it("resets status to PENDING and enqueues job", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(buildOwnedReview({ status: "FAILED" }));
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildOwnedRepo());
      vi.mocked(reviewRepo.update).mockResolvedValue(buildReview({ status: "PENDING" }));

      const result = await service.retryReview("user-1", "review-1");

      expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { status: "PENDING" });
      expect(reviewQueue.add).toHaveBeenCalledWith(
        "review-pr",
        expect.objectContaining({ installationId: "install-1", repoId: "repo-1" }),
        { jobId: "retry-review-1" }
      );
      expect(result.review.status).toBe("PENDING");
    });

    it("throws BadRequestError when review status is not FAILED", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(buildOwnedReview({ status: "DONE" }));

      await expect(service.retryReview("user-1", "review-1")).rejects.toThrow(BadRequestError);
    });

    it("throws NotFoundError for unknown reviewId", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(null);

      await expect(service.retryReview("user-1", "missing")).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError when review belongs to another user", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(
        buildOwnedReview({ status: "FAILED", repo: { installation: { userId: "someone-else" } } })
      );

      await expect(service.retryReview("user-1", "review-1")).rejects.toThrow(ForbiddenError);
    });

    it("throws 503 AppError when BullMQ is unavailable", async () => {
      vi.mocked(reviewRepo.findById).mockResolvedValue(buildOwnedReview({ status: "FAILED" }));
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildOwnedRepo());
      vi.mocked(reviewRepo.update).mockResolvedValue(buildReview({ status: "PENDING" }));
      vi.mocked(reviewQueue.add).mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(service.retryReview("user-1", "review-1")).rejects.toThrow(AppError);
    });
  });

  describe("getStats", () => {
    it("returns severity breakdown", async () => {
      vi.mocked(reviewRepo.countForUser).mockResolvedValue(1);
      vi.mocked(reviewRepo.countIssuesBySeverityForUser).mockResolvedValue({
        critical: 1,
        warning: 2,
      });
      vi.mocked(reviewRepo.countIssuesByCategoryForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByDayForUser).mockResolvedValue([]);

      const result = await service.getStats("user-1", { days: 30 });

      expect(result.issuesBySeverity).toEqual({ critical: 1, warning: 2, info: 0 });
    });

    it("returns category breakdown", async () => {
      vi.mocked(reviewRepo.countForUser).mockResolvedValue(1);
      vi.mocked(reviewRepo.countIssuesBySeverityForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByCategoryForUser).mockResolvedValue({ bug: 3, style: 1 });
      vi.mocked(reviewRepo.countIssuesByDayForUser).mockResolvedValue([]);

      const result = await service.getStats("user-1", { days: 30 });

      expect(result.issuesByCategory).toEqual({
        bug: 3,
        security: 0,
        style: 1,
        performance: 0,
        logic: 0,
      });
    });

    it("returns daily trend for default 30-day window", async () => {
      vi.mocked(reviewRepo.countForUser).mockResolvedValue(0);
      vi.mocked(reviewRepo.countIssuesBySeverityForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByCategoryForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByDayForUser).mockResolvedValue([
        { date: "2026-01-01", count: 2 },
      ]);

      const result = await service.getStats("user-1", { days: 30 });

      expect(result.recentTrend).toEqual([{ date: "2026-01-01", count: 2 }]);
    });

    it("respects days param up to 90", async () => {
      vi.mocked(reviewRepo.countForUser).mockResolvedValue(0);
      vi.mocked(reviewRepo.countIssuesBySeverityForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByCategoryForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByDayForUser).mockResolvedValue([]);

      await service.getStats("user-1", { days: 90 });

      const sinceArg = vi.mocked(reviewRepo.countForUser).mock.calls[0]![1]!.since!;
      const daysApart = (Date.now() - sinceArg.getTime()) / (24 * 60 * 60 * 1000);
      expect(daysApart).toBeCloseTo(90, 0);
    });

    it("scopes stats to current user's installations only, and to repoId when given", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildOwnedRepo());
      vi.mocked(reviewRepo.countForUser).mockResolvedValue(0);
      vi.mocked(reviewRepo.countIssuesBySeverityForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByCategoryForUser).mockResolvedValue({});
      vi.mocked(reviewRepo.countIssuesByDayForUser).mockResolvedValue([]);

      await service.getStats("user-1", { repoId: "repo-1", days: 30 });

      expect(reviewRepo.countForUser).toHaveBeenCalledWith(
        "user-1",
        expect.objectContaining({ repoId: "repo-1" })
      );
    });

    it("throws ForbiddenError when repoId belongs to another user's repo", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildOwnedRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      await expect(service.getStats("user-1", { repoId: "repo-1", days: 30 })).rejects.toThrow(
        ForbiddenError
      );
    });
  });
});
