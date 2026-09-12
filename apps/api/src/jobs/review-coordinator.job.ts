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
  ReviewChunkRow,
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
    //
    // Idempotency: this job's BullMQ id never changes across BullMQ's own retries of it
    // (`attempts: 3`, jobs/worker.ts's default coordinator options) — a failed attempt gets
    // retried under the exact same job.id, not a new one. Without this check, every retry would
    // call reviewRepo.create again and leave a duplicate Review row per attempt — found live
    // 2026-09-06 running a real coordinator job for the first time (memory/pitfalls.md #016's
    // follow-up; three duplicate rows for the same PR/headSha were observed from exactly this).
    // job.id is always set: webhook.service.ts passes the GitHub delivery id as jobId, and
    // BullMQ generates one itself when the caller doesn't.
    const jobId = job.id!;
    const existingReview = await this.reviewRepo.findByCoordinatorJobId(jobId);
    const review = existingReview
      ? await this.reviewRepo.update(existingReview.id, { status: "RUNNING" })
      : await this.reviewRepo.create({
          repoId,
          prNumber,
          prTitle,
          prAuthor,
          headSha,
          coordinatorJobId: jobId,
        });

    try {
      // 2-3. Installation-scoped Octokit + effective repo config, resolved once and threaded
      // through every chunk job's data (see resolve-review-context.ts) rather than re-fetched
      // per chunk. Cheap enough to redo unconditionally even when reusing an earlier attempt's
      // chunks below — it never hits the PR diff itself.
      const { octokit, owner, repo, repoConfig } = await resolveReviewContext(
        repoId,
        repoFullName,
        installationId,
        this.installationRepo,
        this.configService
      );

      // An earlier attempt of this same job (existingReview above) may have already fetched,
      // chunked, and persisted ReviewChunk rows before failing — e.g. exactly the `:` jobId bug
      // this file used to have, which failed at flowProducer.add *after* chunks were already
      // written. Reuse them instead of re-fetching the diff and re-chunking, which would create
      // a second, duplicate set of ReviewChunk rows (and duplicate review-chunk jobs) for the
      // same review.
      const existingChunks = existingReview
        ? await this.reviewChunkRepo.findByReviewId(existingReview.id)
        : [];

      let chunkRows: ReviewChunkRow[];
      let truncated = review.truncated;

      if (existingChunks.length > 0) {
        chunkRows = existingChunks;
      } else {
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

        // 6. Chunk the largest diffs first (diffService.prioritizeFiles) and persist a
        // ReviewChunk row (PENDING) per chunk *before* fanning out — a crash between here and
        // the flowProducer.add below leaves chunks a retry can still discover and reuse (above).
        // Truncate to MAX_CHUNKS_PER_REVIEW if the PR produced more chunks than that.
        let chunks = this.diffService.chunkFiles(this.diffService.prioritizeFiles(filesToReview));
        truncated = false;
        if (chunks.length > MAX_CHUNKS_PER_REVIEW) {
          chunks = chunks.slice(0, MAX_CHUNKS_PER_REVIEW);
          truncated = true;
        }
        chunkRows = await this.reviewChunkRepo.createMany(review.id, chunks);
      }

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
            // Not `${review.id}:${row.id}` — found live 2026-09-06 running a real coordinator
            // job against real Redis/BullMQ: this installed BullMQ version (5.80.8, inside the
            // `^5.21.0` range package.json pins) rejects any custom jobId containing `:` with
            // "Custom Id cannot contain :", something no unit/integration test caught since
            // they all mock FlowProducer entirely. `-` is safe — cuids never contain it.
            jobId: `${review.id}-${row.id}`,
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
