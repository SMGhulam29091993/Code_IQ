import type { Job } from "bullmq";
import { mapWithConcurrency } from "../lib/concurrency";
import { getInstallationOctokit } from "../lib/octokit";
import type { IInstallationRepository } from "../modules/github/github.types";
import type { ConfigService } from "../modules/repos/config.service";
import type {
  ICommentService,
  IDiffService,
  IGeminiService,
  IReviewChunkRepository,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewChunkRow,
  ReviewJobData,
} from "../modules/reviews/review.types";

// Caps how many chunks' Gemini calls run at once per review. Added 2026-08-26 after the
// previous unbounded Promise.allSettled(chunks.map(...)) blew through the free tier's 5
// requests/minute quota on any PR with more than a few chunks. This bounds *this review's* own
// burst; it doesn't coordinate across multiple reviews running concurrently (worker.ts's
// REVIEW_WORKER_CONCURRENCY=5 means several reviews' chunk batches could still overlap and
// jointly exceed the quota) — gemini.service.ts's retry-with-backoff is what makes that case
// recover instead of fail outright, rather than this cap trying to prevent it entirely.
const CHUNK_CONCURRENCY = 3;

// decisions/007 Phase 2: chunk state (ReviewChunk rows) is now persisted around each Gemini
// call, and a retry (job.data.reviewId set) resumes an existing review instead of starting over
// — only its non-DONE chunks re-run, so a crash/failure never re-pays for already-successful
// Gemini calls. Still one BullMQ job per PR/retry (Phase 3 splits chunk execution into its own
// queue) — see knowledge/technical/backend/review-pipeline-scaling.md.
//
// Called only from the BullMQ worker (jobs/worker.ts) — never from a controller
// (.ai/rules/backend.md #5).
export class ReviewJobProcessor {
  constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly reviewIssueRepo: IReviewIssueRepository,
    private readonly installationRepo: IInstallationRepository,
    private readonly configService: ConfigService,
    private readonly diffService: IDiffService,
    private readonly geminiService: IGeminiService,
    private readonly commentService: ICommentService,
    private readonly reviewChunkRepo: IReviewChunkRepository
  ) {}

  async process(job: Job<ReviewJobData>): Promise<void> {
    const {
      installationId,
      repoId,
      prNumber,
      prTitle,
      prAuthor,
      headSha,
      repoFullName,
      reviewId,
    } = job.data;
    const isRetry = Boolean(reviewId);

    // 1. Create the Review row (status: RUNNING) for a fresh review, or resume an existing one
    // for a retry — ReviewRepository.create hardcodes RUNNING; a retry's row was already reset
    // to PENDING by ReviewService.retryReview and gets flipped to RUNNING below once we're past
    // ownership/lookup and into the try block, matching a fresh run's semantics.
    const review = isRetry
      ? await this.mustFindReview(reviewId!)
      : await this.reviewRepo.create({ repoId, prNumber, prTitle, prAuthor, headSha });

    try {
      // 2. Get installation-scoped Octokit
      const installation = await this.installationRepo.findById(installationId);
      if (!installation) {
        throw new Error(`Installation not found: ${installationId}`);
      }
      const octokit = getInstallationOctokit(installation.githubInstallationId);

      const [owner, repo] = repoFullName.split("/");
      if (!owner || !repo) {
        throw new Error(`Invalid repoFullName: ${repoFullName}`);
      }

      // 3. Load repo config (DB config merged with .codeiq.yml) — needed for every Gemini call,
      // retry or not.
      const repoConfig = await this.configService.getEffectiveConfig(repoId, octokit, owner, repo);

      let chunksToRun: ReviewChunkRow[];
      if (isRetry) {
        await this.reviewRepo.update(review.id, { status: "RUNNING" });
        // Patches are already persisted on the ReviewChunk rows from the original run — no need
        // to re-fetch the diff from GitHub. Only chunks that never reached DONE re-run.
        chunksToRun = await this.reviewChunkRepo.findIncomplete(review.id);
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

        // 6. Chunk each file's diff and persist a ReviewChunk row (PENDING) per chunk up front,
        // before any Gemini call — a crash from here on always has something to resume from.
        const chunks = this.diffService.chunkFiles(filesToReview);
        chunksToRun = await this.reviewChunkRepo.createMany(review.id, chunks);
        await this.reviewRepo.update(review.id, { totalChunks: chunksToRun.length });
      }

      // 7. Call Gemini for each pending/failed chunk, capped at CHUNK_CONCURRENCY in flight —
      // chunks already DONE from a prior attempt are not in chunksToRun and are never re-run.
      await mapWithConcurrency(chunksToRun, CHUNK_CONCURRENCY, async (chunk) => {
        await this.reviewChunkRepo.markRunning(chunk.id);
        try {
          const result = await this.geminiService.reviewDiff(chunk.patch, repoConfig, chunk.filename);
          await this.reviewIssueRepo.createMany(
            review.id,
            result.issues.map((issue) => ({ ...issue, file: chunk.filename, chunkId: chunk.id }))
          );
          await this.reviewChunkRepo.markDone(chunk.id);
        } catch (err) {
          // Logging runs unconditionally, before the "all failed" check below, so a
          // total-failure run still records *why* each chunk failed — previously the throw
          // happened first and swallowed every reason (see .ai/knowledge/domains/review.md
          // "Implementation notes", found 2026-08-26 debugging a real all-chunks-failed run
          // that left nothing more specific than "All Gemini review calls failed" in the logs).
          console.warn(`Chunk failed for ${chunk.filename}: ${String(err)}`);
          await this.reviewChunkRepo.markFailed(chunk.id, String(err));
        } finally {
          // UI-progress only — the "all failed" gate below re-queries ReviewChunk rows
          // directly rather than trusting this counter.
          await this.reviewRepo.incrementCompletedChunks(review.id);
        }
      });

      // 8. Aggregate every issue persisted for this review so far — including ones from chunks
      // that reached DONE in an earlier (failed) attempt, on a retry — rather than only the
      // issues produced by this run's loop.
      const allChunks = await this.reviewChunkRepo.findByReviewId(review.id);
      const allIssues = await this.reviewIssueRepo.findByReviewId(review.id);

      // ALL chunks failing is a pipeline failure — BullMQ retries. A partial failure (some
      // chunks failed) is not; the DONE ones' issues still get summarized and posted.
      if (allChunks.length > 0 && allChunks.every((chunk) => chunk.status === "FAILED")) {
        throw new Error("All Gemini review calls failed");
      }

      // 9. Generate PR-level summary
      const summary = await this.geminiService.summarizePR(prTitle, allIssues);

      // 10. Post inline comments + summary to GitHub
      const githubReviewId = await this.commentService.postReview(octokit, {
        owner,
        repo,
        prNumber,
        headSha,
        issues: allIssues,
        summary,
      });

      // 11. Mark done
      const filesReviewed = new Set(
        allChunks.filter((chunk) => chunk.status === "DONE").map((chunk) => chunk.filename)
      ).size;
      await this.reviewRepo.update(review.id, {
        status: "DONE",
        summary,
        filesReviewed,
        githubReviewId,
      });
    } catch (err) {
      await this.reviewRepo.update(review.id, { status: "FAILED" });
      throw err; // BullMQ retries (max 3 attempts, exponential backoff — see jobs/worker.ts).
    }
  }

  private async mustFindReview(reviewId: string) {
    const review = await this.reviewRepo.findById(reviewId);
    if (!review) {
      throw new Error(`Review not found for retry: ${reviewId}`);
    }
    return review;
  }
}
