import type { Octokit } from "@octokit/rest";
import type Redis from "ioredis";
import type {
  IPrStatusRepository,
  IPrStatusService,
  PrStatusContext,
  PrStatusResult,
} from "./review.types";

export const CHECK_RUN_NAME = "CodeIQ Review";

// At most one progress edit per review per window — a 30-chunk PR would otherwise mean 60 GitHub
// API calls (comment + check run per chunk) just for a progress counter.
const PROGRESS_THROTTLE_SECONDS = 15;

// Hidden marker so the status comment is identifiable on the PR (and by any future cleanup).
const STATUS_MARKER = "<!-- codeiq-status -->";

const FAILURE_MESSAGES: Record<string, string> = {
  FREE_TIER_EXHAUSTED:
    "The free AI review quota has been reached. Upgrade for uninterrupted reviews, or wait for the free tier to refresh and retry from the CodeIQ dashboard.",
};

// The CodeRabbit-style "review in progress" signals on the PR page: one issue comment edited in
// place (in progress → live "N / M sections analysed" → result line) plus a "CodeIQ Review"
// check run in the PR's checks box. Driven by the pipeline: review-coordinator.job.ts (start,
// and fail/complete on its early exits), review-chunk.job.ts (progress), review-finalize.job.ts
// (complete/fail), ReviewService.retryReview (start again).
//
// Best-effort by design: every GitHub call is caught and logged, never thrown — the PR comment
// is a courtesy signal, the posted review is the product. The comment and the check run are
// also independent of each other: the check run needs the GitHub App's "Checks: Read & write"
// permission, which an installation may not have granted; without it the comment still works.
//
// Check-run conclusion is "success" whenever a review was posted, regardless of findings, and
// "neutral" when the review itself couldn't complete — never "failure". CodeIQ is deliberately
// non-blocking (`event: 'COMMENT'`, .ai/memory/lessons.md #001); a red check would let branch
// protection turn it back into a merge gate.
export class PrStatusService implements IPrStatusService {
  private readonly octokits = new Map<number, Octokit>();
  private warnedNoChecksPermission = false;

  constructor(
    private readonly repo: IPrStatusRepository,
    private readonly redis: Redis,
    private readonly getOctokit: (githubInstallationId: number) => Octokit
  ) {}

  async start(reviewId: string): Promise<void> {
    const ctx = await this.context(reviewId);
    if (!ctx) return;
    const octokit = this.octokitFor(ctx);
    const body = statusBody("🔄 CodeIQ review in progress", [
      `Reviewing commit \`${short(ctx.headSha)}\`. Inline comments will appear on this PR when the review is done.`,
    ]);

    await this.attempt(`status comment for review ${reviewId}`, async () => {
      if (ctx.statusCommentId !== null) {
        // A retry of an earlier run — reset the existing comment rather than adding another.
        await octokit.issues.updateComment({ owner: ctx.owner, repo: ctx.repo, comment_id: ctx.statusCommentId, body });
      } else {
        const { data } = await octokit.issues.createComment({
          owner: ctx.owner,
          repo: ctx.repo,
          issue_number: ctx.prNumber,
          body,
        });
        await this.repo.saveStatusIds(reviewId, { statusCommentId: data.id });
      }
    });

    // Always a new check run, even on a retry — a fresh one shows up as the latest "CodeIQ
    // Review" run on the commit. The previous run (if any) is closed first so it doesn't sit at
    // "in progress" forever next to the new one.
    if (ctx.checkRunId !== null) {
      const previousRunId = ctx.checkRunId;
      await this.attemptCheck(reviewId, () =>
        octokit.checks.update({
          owner: ctx.owner,
          repo: ctx.repo,
          check_run_id: previousRunId,
          status: "completed",
          conclusion: "neutral",
          completed_at: new Date().toISOString(),
          output: { title: "Superseded", summary: "Replaced by a newer CodeIQ review run." },
        })
      );
    }
    await this.attemptCheck(reviewId, async () => {
      const { data } = await octokit.checks.create({
        owner: ctx.owner,
        repo: ctx.repo,
        name: CHECK_RUN_NAME,
        head_sha: ctx.headSha,
        status: "in_progress",
        started_at: new Date().toISOString(),
        output: { title: "Review in progress", summary: "CodeIQ is analysing this pull request." },
      });
      await this.repo.saveStatusIds(reviewId, { checkRunId: data.id });
    });
  }

  async progress(reviewId: string): Promise<void> {
    try {
      const acquired = await this.redis.set(
        `review:${reviewId}:pr-status-progress`,
        "1",
        "EX",
        PROGRESS_THROTTLE_SECONDS,
        "NX"
      );
      if (acquired === null) return; // another update for this review went out recently
    } catch (err) {
      console.warn(`[pr-status] progress throttle unavailable for review ${reviewId}: ${String(err)}`);
      return;
    }

    const ctx = await this.context(reviewId);
    if (!ctx) return;
    let counts: { settled: number; total: number };
    try {
      counts = await this.repo.countChunkProgress(reviewId);
    } catch (err) {
      console.warn(`[pr-status] chunk progress unavailable for review ${reviewId}: ${String(err)}`);
      return;
    }
    if (counts.total === 0) return;
    const octokit = this.octokitFor(ctx);
    const progressLine = `**Progress:** ${counts.settled} / ${counts.total} sections analysed`;

    if (ctx.statusCommentId !== null) {
      const commentId = ctx.statusCommentId;
      await this.attempt(`status comment progress for review ${reviewId}`, () =>
        octokit.issues.updateComment({
          owner: ctx.owner,
          repo: ctx.repo,
          comment_id: commentId,
          body: statusBody("🔄 CodeIQ review in progress", [
            `Reviewing commit \`${short(ctx.headSha)}\`.`,
            progressLine,
          ]),
        })
      );
    }
    if (ctx.checkRunId !== null) {
      const checkRunId = ctx.checkRunId;
      await this.attemptCheck(reviewId, () =>
        octokit.checks.update({
          owner: ctx.owner,
          repo: ctx.repo,
          check_run_id: checkRunId,
          output: {
            title: `Reviewing… ${counts.settled}/${counts.total} sections`,
            summary: progressLine,
          },
        })
      );
    }
  }

  async complete(reviewId: string, result: PrStatusResult): Promise<void> {
    const ctx = await this.context(reviewId);
    if (!ctx) return;
    const octokit = this.octokitFor(ctx);
    const total = result.critical + result.warning + result.info;
    const reviewUrl =
      result.githubReviewId !== null
        ? `https://github.com/${ctx.owner}/${ctx.repo}/pull/${ctx.prNumber}#pullrequestreview-${result.githubReviewId}`
        : null;
    const findings =
      result.note ??
      `**${total} ${total === 1 ? "issue" : "issues"}** — 🔴 ${result.critical} critical · 🟡 ${result.warning} warning · 🔵 ${result.info} info`;
    const lines = [`Reviewed commit \`${short(ctx.headSha)}\`.`, findings];
    if (reviewUrl) lines.push(`[View the review →](${reviewUrl})`);

    if (ctx.statusCommentId !== null) {
      const commentId = ctx.statusCommentId;
      await this.attempt(`status comment result for review ${reviewId}`, () =>
        octokit.issues.updateComment({
          owner: ctx.owner,
          repo: ctx.repo,
          comment_id: commentId,
          body: statusBody("✅ CodeIQ review complete", lines),
        })
      );
    }
    if (ctx.checkRunId !== null) {
      const checkRunId = ctx.checkRunId;
      await this.attemptCheck(reviewId, () =>
        octokit.checks.update({
          owner: ctx.owner,
          repo: ctx.repo,
          check_run_id: checkRunId,
          status: "completed",
          conclusion: "success",
          completed_at: new Date().toISOString(),
          ...(reviewUrl ? { details_url: reviewUrl } : {}),
          output: {
            title: result.note ?? `${total} ${total === 1 ? "issue" : "issues"} found`,
            summary: lines.join("\n\n"),
          },
        })
      );
    }
  }

  async fail(reviewId: string, failureReason: string | null): Promise<void> {
    const ctx = await this.context(reviewId);
    if (!ctx) return;
    const octokit = this.octokitFor(ctx);
    const reason =
      (failureReason && FAILURE_MESSAGES[failureReason]) ??
      "Something went wrong while reviewing this pull request. It can be retried from the CodeIQ dashboard.";

    if (ctx.statusCommentId !== null) {
      const commentId = ctx.statusCommentId;
      await this.attempt(`status comment failure for review ${reviewId}`, () =>
        octokit.issues.updateComment({
          owner: ctx.owner,
          repo: ctx.repo,
          comment_id: commentId,
          body: statusBody("❌ CodeIQ review could not be completed", [
            `Commit \`${short(ctx.headSha)}\`.`,
            reason,
          ]),
        })
      );
    }
    if (ctx.checkRunId !== null) {
      const checkRunId = ctx.checkRunId;
      await this.attemptCheck(reviewId, () =>
        octokit.checks.update({
          owner: ctx.owner,
          repo: ctx.repo,
          check_run_id: checkRunId,
          status: "completed",
          conclusion: "neutral", // never "failure" — see the class comment
          completed_at: new Date().toISOString(),
          output: { title: "Review could not be completed", summary: reason },
        })
      );
    }
  }

  private async context(reviewId: string): Promise<PrStatusContext | null> {
    try {
      return await this.repo.findContext(reviewId);
    } catch (err) {
      console.warn(`[pr-status] could not load review ${reviewId}: ${String(err)}`);
      return null;
    }
  }

  private octokitFor(ctx: PrStatusContext): Octokit {
    // One client per installation, reused — each new client would fetch a fresh installation
    // token; @octokit/auth-app caches and refreshes it per client instance.
    let octokit = this.octokits.get(ctx.githubInstallationId);
    if (!octokit) {
      octokit = this.getOctokit(ctx.githubInstallationId);
      this.octokits.set(ctx.githubInstallationId, octokit);
    }
    return octokit;
  }

  private async attempt(what: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      console.warn(`[pr-status] ${what} failed: ${describe(err)}`);
    }
  }

  // Check-run calls 403 ("Resource not accessible by integration") when the installation hasn't
  // granted Checks: write — expected until it's enabled, so say so once per process instead of
  // on every chunk.
  private async attemptCheck(reviewId: string, fn: () => Promise<unknown>): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if ((err as { status?: number }).status === 403) {
        if (!this.warnedNoChecksPermission) {
          this.warnedNoChecksPermission = true;
          console.warn(
            `[pr-status] check run skipped: the GitHub App installation lacks "Checks: Read & write" — grant it to show the "${CHECK_RUN_NAME}" check on PRs`
          );
        }
        return;
      }
      console.warn(`[pr-status] check run for review ${reviewId} failed: ${describe(err)}`);
    }
  }
}

function statusBody(heading: string, lines: string[]): string {
  return `${STATUS_MARKER}\n### ${heading}\n\n${lines.join("\n\n")}`;
}

function short(sha: string): string {
  return sha.slice(0, 7);
}

function describe(err: unknown): string {
  const status = (err as { status?: number } | undefined)?.status;
  const message = err instanceof Error ? err.message : String(err);
  return status !== undefined ? `${status} ${message}` : message;
}
