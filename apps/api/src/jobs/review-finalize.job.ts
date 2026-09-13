import type { Job } from "bullmq";
import { ALL_TIERS_EXHAUSTED_CHUNK_ERROR } from "./review-chunk.job";
import { getInstallationOctokit } from "../lib/octokit";
import type { IInstallationRepository } from "../modules/github/github.types";
import type {
  ICommentService,
  IGeminiService,
  IReviewChunkRepository,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewFinalizeJobData,
} from "../modules/reviews/review.types";

// decisions/007 Phase 3: the Flow parent — BullMQ activates this automatically once every
// review-chunk child of the same Flow has settled (whether it reached DONE or exhausted its
// retries and stayed FAILED; failParentOnFailure: false on the children is what lets this run
// instead of the whole Flow failing on one bad chunk). Aggregates whatever issues exist for the
// review (from this run's chunks, and — on a retry — chunks that already reached DONE in an
// earlier attempt), posts the single GitHub review, and marks the review DONE/FAILED.
//
// Called only from the BullMQ worker (jobs/worker.ts) — never from a controller
// (.ai/rules/backend.md #5).
export class ReviewFinalizeJobProcessor {
  constructor(
    private readonly reviewRepo: IReviewRepository,
    private readonly reviewIssueRepo: IReviewIssueRepository,
    private readonly reviewChunkRepo: IReviewChunkRepository,
    private readonly installationRepo: IInstallationRepository,
    private readonly geminiService: IGeminiService,
    private readonly commentService: ICommentService
  ) {}

  async process(job: Job<ReviewFinalizeJobData>): Promise<void> {
    const { reviewId, installationId, owner, repo, prNumber, prTitle, headSha, truncated } =
      job.data;

    const allChunks = await this.reviewChunkRepo.findByReviewId(reviewId);
    const failedChunks = allChunks.filter((chunk) => chunk.status === "FAILED");
    const doneChunks = allChunks.filter((chunk) => chunk.status === "DONE");

    // ALL chunks failing is a pipeline failure. A partial failure isn't — the DONE ones' issues
    // still get summarized and posted, with a note about the gap.
    if (allChunks.length > 0 && failedChunks.length === allChunks.length) {
      // The fast-fail short circuit (jobs/review-chunk.job.ts, decisions/008 addendum) stamps
      // every chunk it terminates early with this exact marker — re-querying real ReviewChunk
      // rows here (never a transient flag) to tell "ran out of free-tier quota" apart from any
      // other reason every chunk could fail, so the dashboard can show a specific, actionable
      // message instead of a generic failure.
      const exhausted = failedChunks.some((chunk) => chunk.error === ALL_TIERS_EXHAUSTED_CHUNK_ERROR);
      await this.reviewRepo.update(reviewId, {
        status: "FAILED",
        failureReason: exhausted ? "FREE_TIER_EXHAUSTED" : null,
      });
      return;
    }

    const allIssues = await this.reviewIssueRepo.findByReviewId(reviewId);
    let summary = await this.geminiService.summarizePR(prTitle, allIssues);
    if (truncated) {
      summary += `\n\n_This PR exceeded the per-review analysis limit — only the largest files were reviewed._`;
    }
    if (failedChunks.length > 0) {
      summary += `\n\n_${failedChunks.length} file section(s) could not be analyzed after retries._`;
    }

    const installation = await this.installationRepo.findById(installationId);
    if (!installation) {
      throw new Error(`Installation not found: ${installationId}`);
    }
    const octokit = getInstallationOctokit(installation.githubInstallationId);

    const githubReviewId = await this.commentService.postReview(octokit, {
      owner,
      repo,
      prNumber,
      headSha,
      issues: allIssues,
      summary,
    });

    await this.reviewRepo.update(reviewId, {
      status: "DONE",
      summary,
      filesReviewed: new Set(doneChunks.map((chunk) => chunk.filename)).size,
      githubReviewId,
    });
  }
}
