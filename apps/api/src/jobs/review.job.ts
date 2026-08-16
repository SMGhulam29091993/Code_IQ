import type { Job } from "bullmq";
import { getInstallationOctokit } from "../lib/octokit";
import type { IInstallationRepository } from "../modules/github/github.types";
import type { ConfigService } from "../modules/repos/config.service";
import type {
  GeminiIssue,
  ICommentService,
  IDiffService,
  IGeminiService,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewJobData,
} from "../modules/reviews/review.types";

// Exact pipeline pseudocode from .ai/knowledge/domains/review.md "Core pipeline: review.job.ts".
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
    private readonly commentService: ICommentService
  ) {}

  async process(job: Job<ReviewJobData>): Promise<void> {
    const { installationId, repoId, prNumber, prTitle, prAuthor, headSha, repoFullName } =
      job.data;

    // 1. Create Review row (status: RUNNING) — ReviewRepository.create hardcodes RUNNING.
    const review = await this.reviewRepo.create({ repoId, prNumber, prTitle, prAuthor, headSha });

    try {
      // 2. Get installation-scoped Octokit
      const installation = await this.installationRepo.findById(installationId);
      if (!installation) {
        throw new Error(`Installation not found: ${installationId}`);
      }
      const octokit = getInstallationOctokit(installation.githubInstallationId);

      // 3. Fetch PR diff
      const [owner, repo] = repoFullName.split("/");
      if (!owner || !repo) {
        throw new Error(`Invalid repoFullName: ${repoFullName}`);
      }
      const { data: files } = await octokit.pulls.listFiles({
        owner,
        repo,
        pull_number: prNumber,
      });

      // 4. Load repo config (DB config merged with .codeiq.yml)
      const repoConfig = await this.configService.getEffectiveConfig(repoId, octokit, owner, repo);

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

      // 6. Chunk each file's diff
      const chunks = this.diffService.chunkFiles(filesToReview);

      // 7. Call Gemini for each chunk in parallel
      const results = await Promise.allSettled(
        chunks.map((chunk) =>
          this.geminiService.reviewDiff(chunk.patch, repoConfig, chunk.filename)
        )
      );

      // ALL Gemini calls failing is a pipeline failure — BullMQ retries. A partial failure
      // (some chunks rejected) is not; step 8 just skips the rejected ones.
      if (results.every((result) => result.status === "rejected")) {
        throw new Error("All Gemini review calls failed");
      }

      // 8. Aggregate issues (ignore rejected chunks — log warning)
      const allIssues: Array<GeminiIssue & { file: string }> = [];
      results.forEach((result, i) => {
        const chunk = chunks[i]!;
        if (result.status === "fulfilled") {
          for (const issue of result.value.issues) {
            allIssues.push({ ...issue, file: chunk.filename });
          }
        } else {
          console.warn(`Chunk failed for ${chunk.filename}: ${String(result.reason)}`);
        }
      });

      // 9. Store issues
      await this.reviewIssueRepo.createMany(review.id, allIssues);

      // 10. Generate PR-level summary
      const summary = await this.geminiService.summarizePR(prTitle, allIssues);

      // 11. Post inline comments + summary to GitHub
      const githubReviewId = await this.commentService.postReview(octokit, {
        owner,
        repo,
        prNumber,
        headSha,
        issues: allIssues,
        summary,
      });

      // 12. Mark done
      await this.reviewRepo.update(review.id, {
        status: "DONE",
        summary,
        filesReviewed: filesToReview.length,
        githubReviewId,
      });
    } catch (err) {
      await this.reviewRepo.update(review.id, { status: "FAILED" });
      throw err; // BullMQ retries (max 3 attempts, exponential backoff — see jobs/worker.ts).
    }
  }
}
