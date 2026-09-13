import type { Job } from "bullmq";
import { UnrecoverableError } from "bullmq";
import { AllTiersExhaustedError } from "../lib/llm-client";
import type {
  IFairnessService,
  IGeminiService,
  ILlmExhaustionService,
  IReviewChunkRepository,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewChunkJobData,
} from "../modules/reviews/review.types";

// review-finalize.job.ts's findByReviewId reads a failed chunk's stored `error` back and checks
// for this exact marker to set Review.failureReason — see that file and decisions/008's
// fast-fail addendum.
export const ALL_TIERS_EXHAUSTED_CHUNK_ERROR = "ALL_TIERS_EXHAUSTED";

// decisions/007 Phase 3: one BullMQ job per chunk, on its own queue (review-chunk-queue) —
// horizontally scalable by adding worker pods, and rate-limited fleet-wide via that queue's
// Worker `limiter` option (jobs/worker.ts), not by an in-process pool. A failed attempt throws
// so BullMQ's own attempts/backoff retries it; failParentOnFailure: false on the job (set by
// whoever created the Flow — jobs/review-coordinator.job.ts or ReviewService.retryReview) means
// exhausting those retries doesn't block the parent finalize job.
//
// Fast-fail exception (decisions/008 addendum): when lib/llm-client.ts's FallbackLLMClient has
// exhausted every tier, retrying *this* chunk (or letting every other already-queued chunk for
// the same review independently rediscover the same exhaustion) is pointless — none of the
// underlying free-tier quotas reset within a BullMQ backoff window. That case marks the review
// via llmExhaustionService and throws bullmq's UnrecoverableError instead of the raw error, so
// this attempt is terminal rather than retried up to `attempts` times; every other chunk for the
// same review short-circuits on its own next pickup instead of calling the LLM at all.
//
// Called only from the BullMQ worker (jobs/worker.ts) — never from a controller
// (.ai/rules/backend.md #5).
export class ReviewChunkJobProcessor {
  constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly reviewIssueRepo: IReviewIssueRepository,
    private readonly reviewChunkRepo: IReviewChunkRepository,
    private readonly geminiService: IGeminiService,
    private readonly fairnessService: IFairnessService,
    private readonly llmExhaustionService: ILlmExhaustionService
  ) {}

  async process(job: Job<ReviewChunkJobData>): Promise<void> {
    const { reviewId, chunkId, installationId, filename, patch, repoConfig } = job.data;

    await this.reviewChunkRepo.markRunning(chunkId);

    if (await this.llmExhaustionService.isExhausted(reviewId)) {
      await this.reviewChunkRepo.markFailed(chunkId, ALL_TIERS_EXHAUSTED_CHUNK_ERROR);
      await this.reviewRepo.incrementCompletedChunks(reviewId);
      throw new UnrecoverableError(
        `LLM fallback chain already exhausted for review ${reviewId} — skipping chunk ${chunkId}`
      );
    }

    await this.fairnessService.markInFlight(installationId, 1);
    try {
      const result = await this.geminiService.reviewDiff(patch, repoConfig, filename);
      await this.reviewIssueRepo.createMany(
        reviewId,
        result.issues.map((issue) => ({ ...issue, file: filename, chunkId }))
      );
      await this.reviewChunkRepo.markDone(chunkId);
    } catch (err) {
      if (err instanceof AllTiersExhaustedError) {
        await this.reviewChunkRepo.markFailed(chunkId, ALL_TIERS_EXHAUSTED_CHUNK_ERROR);
        await this.llmExhaustionService.markExhausted(reviewId);
        throw new UnrecoverableError(err.message);
      }
      await this.reviewChunkRepo.markFailed(chunkId, String(err));
      throw err;
    } finally {
      // UI-progress only, and — because this job can retry — may over-count relative to
      // totalChunks across attempts. The finalize job (review-finalize.job.ts) never trusts this
      // counter for its DONE/FAILED gate; it re-queries real ReviewChunk rows instead. See
      // knowledge/technical/backend/review-pipeline-scaling.md.
      await this.reviewRepo.incrementCompletedChunks(reviewId);
      await this.fairnessService.markInFlight(installationId, -1);
    }
  }
}
