import type { Review, ReviewIssue } from "@codeiq/db";
import type {
  GetReviewResult,
  GetStatsFilters,
  IReviewRepository,
  IReviewService,
  IssueCategory,
  IssueSeverity,
  ListReviewsFilters,
  ListReviewsResult,
  ReviewStatsResult,
  ReviewStatus,
  ReviewWithOwner,
  RetryReviewResult,
  SanitizedReview,
  SanitizedReviewIssue,
  SanitizedReviewSummary,
} from "./review.types";
import { reviewQueue } from "../../jobs/queue";
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { IRepoRepository } from "../repos/repo.types";

export class ReviewService implements IReviewService {
  constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly repoRepo: IRepoRepository
  ) {}

  async listReviews(userId: string, filters: ListReviewsFilters): Promise<ListReviewsResult> {
    if (filters.repoId) {
      await this.findOwnedRepoOrThrow(userId, filters.repoId);
    }

    const { reviews, total } = await this.reviewRepo.findManyForUser(userId, filters);
    return {
      reviews: reviews.map(sanitizeReviewSummary),
      total,
      page: filters.page,
      totalPages: total === 0 ? 0 : Math.ceil(total / filters.limit),
    };
  }

  async getReview(userId: string, reviewId: string): Promise<GetReviewResult> {
    const review = await this.findOwnedReview(userId, reviewId);
    return { review: sanitizeReview(review) };
  }

  async retryReview(userId: string, reviewId: string): Promise<RetryReviewResult> {
    const review = await this.findOwnedReview(userId, reviewId);
    if (review.status !== "FAILED") {
      throw new BadRequestError("Only failed reviews can be retried");
    }

    const repo = await this.repoRepo.findByIdForUser(review.repoId);
    if (!repo) {
      throw new NotFoundError("Repo not found");
    }

    const updated = await this.reviewRepo.update(reviewId, { status: "PENDING" });

    try {
      // Await only the enqueue — same stance as webhook.service.ts (.ai/rules/backend.md #6).
      await reviewQueue.add(
        "review-pr",
        {
          installationId: repo.installationId,
          repoId: repo.id,
          prNumber: review.prNumber,
          prTitle: review.prTitle,
          prAuthor: review.prAuthor,
          headSha: review.headSha,
          repoFullName: repo.fullName,
        },
        { jobId: `retry-${reviewId}` }
      );
    } catch {
      throw new AppError("Review queue unavailable", 503);
    }

    return { review: sanitizeReviewSummary(updated) };
  }

  async getStats(userId: string, filters: GetStatsFilters): Promise<ReviewStatsResult> {
    if (filters.repoId) {
      await this.findOwnedRepoOrThrow(userId, filters.repoId);
    }

    const since = new Date(Date.now() - filters.days * 24 * 60 * 60 * 1000);
    const statFilters = { repoId: filters.repoId, since };

    const [totalReviews, bySeverity, byCategory, recentTrend] = await Promise.all([
      this.reviewRepo.countForUser(userId, statFilters),
      this.reviewRepo.countIssuesBySeverityForUser(userId, statFilters),
      this.reviewRepo.countIssuesByCategoryForUser(userId, statFilters),
      this.reviewRepo.countIssuesByDayForUser(userId, statFilters),
    ]);

    const totalIssues = Object.values(bySeverity).reduce((sum, n) => sum + n, 0);

    return {
      totalReviews,
      totalIssues,
      issuesBySeverity: {
        critical: bySeverity.critical ?? 0,
        warning: bySeverity.warning ?? 0,
        info: bySeverity.info ?? 0,
      },
      issuesByCategory: {
        bug: byCategory.bug ?? 0,
        security: byCategory.security ?? 0,
        style: byCategory.style ?? 0,
        performance: byCategory.performance ?? 0,
        logic: byCategory.logic ?? 0,
      },
      recentTrend,
    };
  }

  private async findOwnedReview(userId: string, reviewId: string): Promise<ReviewWithOwner> {
    const review = await this.reviewRepo.findById(reviewId);
    if (!review) {
      throw new NotFoundError("Review not found");
    }
    if (review.repo.installation.userId !== userId) {
      throw new ForbiddenError("Forbidden");
    }
    return review;
  }

  private async findOwnedRepoOrThrow(userId: string, repoId: string): Promise<void> {
    const repo = await this.repoRepo.findByIdForUser(repoId);
    if (!repo) {
      throw new NotFoundError("Repo not found");
    }
    if (repo.installation.userId !== userId) {
      throw new ForbiddenError("Forbidden");
    }
  }
}

function sanitizeReviewSummary(review: Review): SanitizedReviewSummary {
  return {
    id: review.id,
    repoId: review.repoId,
    prNumber: review.prNumber,
    prTitle: review.prTitle,
    prAuthor: review.prAuthor,
    status: review.status as ReviewStatus,
    filesReviewed: review.filesReviewed,
    createdAt: review.createdAt,
  };
}

function sanitizeReview(review: ReviewWithOwner): SanitizedReview {
  return {
    ...sanitizeReviewSummary(review),
    headSha: review.headSha,
    summary: review.summary,
    githubReviewId: review.githubReviewId,
    issues: review.issues.map(sanitizeIssue),
  };
}

function sanitizeIssue(issue: ReviewIssue): SanitizedReviewIssue {
  return {
    id: issue.id,
    file: issue.file,
    line: issue.line,
    severity: issue.severity as IssueSeverity,
    category: issue.category as IssueCategory,
    message: issue.message,
    suggestion: issue.suggestion,
  };
}
