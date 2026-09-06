import type { Job } from "bullmq";
import type {
  IFairnessService,
  IGeminiService,
  IReviewChunkRepository,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewChunkJobData,
} from "../modules/reviews/review.types";

// decisions/007 Phase 3: one BullMQ job per chunk, on its own queue (review-chunk-queue) —
// horizontally scalable by adding worker pods, and rate-limited fleet-wide via that queue's
// Worker `limiter` option (jobs/worker.ts), not by an in-process pool. A failed attempt throws
// so BullMQ's own attempts/backoff retries it; failParentOnFailure: false on the job (set by
// whoever created the Flow — jobs/review-coordinator.job.ts or ReviewService.retryReview) means
// exhausting those retries doesn't block the parent finalize job.
//
// Called only from the BullMQ worker (jobs/worker.ts) — never from a controller
// (.ai/rules/backend.md #5).
export class ReviewChunkJobProcessor {
  constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly reviewIssueRepo: IReviewIssueRepository,
    private readonly reviewChunkRepo: IReviewChunkRepository,
    private readonly geminiService: IGeminiService,
    private readonly fairnessService: IFairnessService
  ) {}

  async process(job: Job<ReviewChunkJobData>): Promise<void> {
    const { reviewId, chunkId, installationId, filename, patch, repoConfig } = job.data;

    await this.reviewChunkRepo.markRunning(chunkId);
    await this.fairnessService.markInFlight(installationId, 1);
    try {
      const result = await this.geminiService.reviewDiff(patch, repoConfig, filename);
      await this.reviewIssueRepo.createMany(
        reviewId,
        result.issues.map((issue) => ({ ...issue, file: filename, chunkId }))
      );
      await this.reviewChunkRepo.markDone(chunkId);
    } catch (err) {
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
