import type { FlowProducer, Job } from "bullmq";
import { REVIEW_CHUNK_QUEUE_NAME, REVIEW_FINALIZE_QUEUE_NAME } from "./queue";
import type { IInstallationRepository } from "../modules/github/github.types";
import type { ConfigService } from "../modules/repos/config.service";
import { resolveReviewContext } from "../modules/reviews/resolve-review-context";
import type {
  IDiffService,
  IFairnessService,
  IReviewChunkRepository,
  IReviewRepository,
  ReviewCoordinatorJobData,
} from "../modules/reviews/review.types";

// Hard ceiling on chunks reviewed per PR (decisions/007 Phase 4 backpressure) — a pathological
// PR (thousands of files, e.g. a vendor bump) gets a bounded cost/time instead of enqueueing an
// unbounded number of Gemini calls. The largest diffs (by additions+deletions) are kept —
// diffService.prioritizeFiles — since they're more likely to carry real issues than a one-line
// version bump; Review.truncated records that it happened.
const MAX_CHUNKS_PER_REVIEW = 200;

// decisions/007 Phase 3: the coordinator's whole job is "get to a fanned-out Flow as fast as
// possible" — fetch diff, filter, chunk, persist ReviewChunk rows, hand off to
// reviewFlowProducer, done. It never runs a Gemini call or waits for one; that's
// review-chunk.job.ts's job, on its own queue, scaled independently. See
// knowledge/technical/backend/review-pipeline-scaling.md "Queue topology".
//
// Called only from the BullMQ worker (jobs/worker.ts) — never from a controller
// (.ai/rules/backend.md #5).
export class ReviewCoordinatorJobProcessor {
  constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly installationRepo: IInstallationRepository,
    private readonly configService: ConfigService,
    private readonly diffService: IDiffService,
    private readonly reviewChunkRepo: IReviewChunkRepository,
    private readonly fairnessService: IFairnessService,
    private readonly flowProducer: FlowProducer
  ) {}

  async process(job: Job<ReviewCoordinatorJobData>): Promise<void> {
    const { installationId, repoId, prNumber, prTitle, prAuthor, headSha, repoFullName } =
      job.data;

    // 1. Create the Review row (status: RUNNING) — ReviewRepository.create hardcodes RUNNING.
    const review = await this.reviewRepo.create({ repoId, prNumber, prTitle, prAuthor, headSha });

    try {
      // 2-3. Installation-scoped Octokit + effective repo config, resolved once and threaded
      // through every chunk job's data (see resolve-review-context.ts) rather than re-fetched
      // per chunk.
      const { octokit, owner, repo, repoConfig } = await resolveReviewContext(
        repoId,
        repoFullName,
        installationId,
        this.installationRepo,
        this.configService
      );

      // 4. Fetch PR diff
      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      // 5. Filter files by ignore patterns and config
      const filesToReview = this.diffService.filterFiles(files, repoConfig);
      if (filesToReview.length === 0) {
        await this.reviewRepo.update(review.id, {
          status: "DONE",
          summary: "No reviewable files in this PR.",
          filesReviewed: 0,
        });
        return;
      }

      // 6. Chunk the largest diffs first (diffService.prioritizeFiles) and persist a ReviewChunk
      // row (PENDING) per chunk *before* fanning out — a crash between here and the
      // flowProducer.add below leaves chunks a retry can still discover via findIncomplete.
      // Truncate to MAX_CHUNKS_PER_REVIEW if the PR produced more chunks than that.
      let chunks = this.diffService.chunkFiles(this.diffService.prioritizeFiles(filesToReview));
      let truncated = false;
      if (chunks.length > MAX_CHUNKS_PER_REVIEW) {
        chunks = chunks.slice(0, MAX_CHUNKS_PER_REVIEW);
        truncated = true;
      }
      const chunkRows = await this.reviewChunkRepo.createMany(review.id, chunks);
      await this.reviewRepo.update(review.id, { totalChunks: chunkRows.length, truncated });

      // Per-installation fairness (decisions/007 Phase 4): an installation with many chunks
      // already in flight gets a lower BullMQ priority for its next chunk jobs, so one tenant's
      // huge PR can't starve everyone else's small ones.
      const priority = await this.fairnessService.priorityFor(installationId);

      // 7. Fan out: one review-chunk job per chunk, under a review-finalize parent that BullMQ
      // activates automatically once every child has settled. failParentOnFailure: false means
      // one chunk exhausting its own retries doesn't block finalization — it's just a gap noted
      // in the summary.
      await this.flowProducer.add({
        name: "finalize-review",
        queueName: REVIEW_FINALIZE_QUEUE_NAME,
        data: { reviewId: review.id, installationId, owner, repo, prNumber, prTitle, headSha, truncated },
        children: chunkRows.map((row) => ({
          name: "review-chunk",
          queueName: REVIEW_CHUNK_QUEUE_NAME,
          data: {
            reviewId: review.id,
            chunkId: row.id,
            installationId,
            filename: row.filename,
            patch: row.patch,
            repoConfig,
          },
          opts: {
            jobId: `${review.id}:${row.id}`,
            priority,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            failParentOnFailure: false,
          },
        })),
      });
    } catch (err) {
      await this.reviewRepo.update(review.id, { status: "FAILED" });
      throw err; // BullMQ retries (max 3 attempts, exponential backoff — see jobs/worker.ts).
    }
  }
}
