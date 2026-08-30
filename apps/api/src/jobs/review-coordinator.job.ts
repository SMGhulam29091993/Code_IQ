import type { FlowProducer, Job } from "bullmq";
import { REVIEW_CHUNK_QUEUE_NAME, REVIEW_FINALIZE_QUEUE_NAME } from "./queue";
import type { IInstallationRepository } from "../modules/github/github.types";
import type { ConfigService } from "../modules/repos/config.service";
import { resolveReviewContext } from "../modules/reviews/resolve-review-context";
import type {
  IDiffService,
  IReviewChunkRepository,
  IReviewRepository,
  ReviewCoordinatorJobData,
} from "../modules/reviews/review.types";

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

      // 6. Chunk each file's diff and persist a ReviewChunk row (PENDING) per chunk *before*
      // fanning out — a crash between here and the flowProducer.add below leaves chunks a retry
      // can still discover and resume via findIncomplete.
      const chunks = this.diffService.chunkFiles(filesToReview);
      const chunkRows = await this.reviewChunkRepo.createMany(review.id, chunks);
      await this.reviewRepo.update(review.id, { totalChunks: chunkRows.length });

      // 7. Fan out: one review-chunk job per chunk, under a review-finalize parent that BullMQ
      // activates automatically once every child has settled. failParentOnFailure: false means
      // one chunk exhausting its own retries doesn't block finalization — it's just a gap noted
      // in the summary.
      await this.flowProducer.add({
        name: "finalize-review",
        queueName: REVIEW_FINALIZE_QUEUE_NAME,
        data: { reviewId: review.id, installationId, owner, repo, prNumber, prTitle, headSha },
        children: chunkRows.map((row) => ({
          name: "review-chunk",
          queueName: REVIEW_CHUNK_QUEUE_NAME,
          data: {
            reviewId: review.id,
            chunkId: row.id,
            filename: row.filename,
            patch: row.patch,
            repoConfig,
          },
          opts: {
            jobId: `${review.id}:${row.id}`,
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
