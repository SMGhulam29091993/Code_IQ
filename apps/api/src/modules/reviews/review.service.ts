import type { Review, ReviewIssue } from "@codeiq/db";
import { resolveReviewContext } from "./resolve-review-context";
import type {
  GetReviewResult,
  GetStatsFilters,
  IReviewChunkRepository,
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
import { REVIEW_CHUNK_QUEUE_NAME, REVIEW_FINALIZE_QUEUE_NAME, reviewFlowProducer } from "../../jobs/queue";
import { AppError, BadRequestError, ForbiddenError, NotFoundError } from "../../lib/errors";
import type { IInstallationRepository } from "../github/github.types";
import type { ConfigService } from "../repos/config.service";
import type { IRepoRepository } from "../repos/repo.types";

export class ReviewService implements IReviewService {
  constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly repoRepo: IRepoRepository,
    private readonly reviewChunkRepo: IReviewChunkRepository,
    private readonly installationRepo: IInstallationRepository,
    private readonly configService: ConfigService
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

    const incomplete = await this.reviewChunkRepo.findIncomplete(reviewId);
    const updated = await this.reviewRepo.update(reviewId, { status: "RUNNING" });

    try {
      // Resolved once here (not per chunk) for the same reason the coordinator job does it once
      // — see resolve-review-context.ts. decisions/007 Phase 3: retry re-enters the Flow
      // directly (never review-coordinator-queue) since the review's chunks — and their
      // already-persisted patches — are already known; only chunks that never reached DONE
      // (`incomplete` above) re-run, so a retry never re-pays for an already-successful chunk.
      const { owner, repo: repoName, repoConfig } = await resolveReviewContext(
        repo.id,
        repo.fullName,
        repo.installationId,
        this.installationRepo,
        this.configService
      );

      await reviewFlowProducer.add({
        name: "finalize-review",
        queueName: REVIEW_FINALIZE_QUEUE_NAME,
        data: {
          reviewId,
          installationId: repo.installationId,
          owner,
          repo: repoName,
          prNumber: review.prNumber,
          prTitle: review.prTitle,
          headSha: review.headSha,
        },
        children: incomplete.map((chunk) => ({
          name: "review-chunk",
          queueName: REVIEW_CHUNK_QUEUE_NAME,
          data: {
            reviewId,
            chunkId: chunk.id,
            filename: chunk.filename,
            patch: chunk.patch,
            repoConfig,
          },
          opts: {
            // A new jobId per retry generation — the chunk's original jobId
            // (`${reviewId}:${chunk.id}`) is already DONE/terminal in BullMQ and needs a fresh
            // id to run again. `attempts` (already incremented by every prior run of this
            // chunk) makes each retry generation's id unique even across repeated retries.
            jobId: `${reviewId}:${chunk.id}:retry${chunk.attempts}`,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            failParentOnFailure: false,
          },
        })),
      });
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
