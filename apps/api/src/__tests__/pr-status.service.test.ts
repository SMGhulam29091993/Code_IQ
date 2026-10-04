import type { Octokit } from "@octokit/rest";
import type Redis from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CHECK_RUN_NAME, PrStatusService } from "../modules/reviews/pr-status.service";
import type { IPrStatusRepository, PrStatusContext } from "../modules/reviews/review.types";

function buildContext(overrides: Partial<PrStatusContext> = {}): PrStatusContext {
  return {
    owner: "acme",
    repo: "widgets",
    prNumber: 15,
    headSha: "17c055a180eaef9702926ee027488edf52ccc18f",
    githubInstallationId: 555,
    statusCommentId: null,
    checkRunId: null,
    ...overrides,
  };
}

function buildOctokit() {
  return {
    issues: {
      createComment: vi.fn().mockResolvedValue({ data: { id: 1001 } }),
      updateComment: vi.fn().mockResolvedValue({ data: {} }),
    },
    checks: {
      create: vi.fn().mockResolvedValue({ data: { id: 2002 } }),
      update: vi.fn().mockResolvedValue({ data: {} }),
    },
  };
}

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { status });
}

describe("PrStatusService", () => {
  let repo: IPrStatusRepository;
  let redis: { set: ReturnType<typeof vi.fn> };
  let octokit: ReturnType<typeof buildOctokit>;
  let getOctokit: ReturnType<typeof vi.fn>;
  let service: PrStatusService;

  beforeEach(() => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    repo = {
      findContext: vi.fn().mockResolvedValue(buildContext()),
      saveStatusIds: vi.fn(),
      countChunkProgress: vi.fn().mockResolvedValue({ settled: 3, total: 10 }),
    };
    redis = { set: vi.fn().mockResolvedValue("OK") };
    octokit = buildOctokit();
    getOctokit = vi.fn().mockReturnValue(octokit as unknown as Octokit);
    service = new PrStatusService(repo, redis as unknown as Redis, getOctokit);
  });

  describe("start", () => {
    it("posts an in-progress comment on the PR and saves its id", async () => {
      await service.start("review-1");

      expect(octokit.issues.createComment).toHaveBeenCalledWith({
        owner: "acme",
        repo: "widgets",
        issue_number: 15,
        body: expect.stringContaining("CodeIQ review in progress"),
      });
      const body = octokit.issues.createComment.mock.calls[0]![0].body as string;
      expect(body).toContain("<!-- codeiq-status -->");
      expect(body).toContain("`17c055a`");
      expect(repo.saveStatusIds).toHaveBeenCalledWith("review-1", { statusCommentId: 1001 });
    });

    it("opens an in-progress check run on the head commit and saves its id", async () => {
      await service.start("review-1");

      expect(octokit.checks.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: CHECK_RUN_NAME,
          head_sha: "17c055a180eaef9702926ee027488edf52ccc18f",
          status: "in_progress",
        })
      );
      expect(repo.saveStatusIds).toHaveBeenCalledWith("review-1", { checkRunId: 2002 });
    });

    it("on a retry, resets the existing comment and supersedes the previous check run", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ statusCommentId: 1001, checkRunId: 2001 }));

      await service.start("review-1");

      expect(octokit.issues.createComment).not.toHaveBeenCalled();
      expect(octokit.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1001, body: expect.stringContaining("in progress") })
      );
      expect(octokit.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({ check_run_id: 2001, status: "completed", conclusion: "neutral" })
      );
      expect(octokit.checks.create).toHaveBeenCalledTimes(1);
    });

    it("never throws, and still opens the check run when the comment fails", async () => {
      octokit.issues.createComment.mockRejectedValue(httpError(500));

      await expect(service.start("review-1")).resolves.toBeUndefined();

      expect(octokit.checks.create).toHaveBeenCalled();
    });

    it("skips the check run quietly when the installation lacks the Checks permission", async () => {
      octokit.checks.create.mockRejectedValue(httpError(403));

      await service.start("review-1");
      await service.start("review-2");

      expect(repo.saveStatusIds).not.toHaveBeenCalledWith(expect.anything(), { checkRunId: expect.anything() });
      const permissionWarnings = vi
        .mocked(console.warn)
        .mock.calls.filter(([msg]) => String(msg).includes("Checks: Read & write"));
      expect(permissionWarnings).toHaveLength(1);
    });

    it("does nothing when the review no longer exists", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(null);

      await service.start("gone");

      expect(getOctokit).not.toHaveBeenCalled();
    });
  });

  describe("progress", () => {
    it("updates the comment and check run with settled / total sections", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ statusCommentId: 1001, checkRunId: 2002 }));

      await service.progress("review-1");

      expect(octokit.issues.updateComment).toHaveBeenCalledWith(
        expect.objectContaining({ comment_id: 1001, body: expect.stringContaining("3 / 10 sections analysed") })
      );
      expect(octokit.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({ check_run_id: 2002, output: expect.objectContaining({ title: "Reviewing… 3/10 sections" }) })
      );
    });

    it("is throttled per review with a Redis NX key", async () => {
      redis.set.mockResolvedValue(null);

      await service.progress("review-1");

      expect(redis.set).toHaveBeenCalledWith("review:review-1:pr-status-progress", "1", "EX", 15, "NX");
      expect(repo.findContext).not.toHaveBeenCalled();
      expect(octokit.issues.updateComment).not.toHaveBeenCalled();
    });

    it("skips GitHub calls when nothing was posted at start", async () => {
      await service.progress("review-1");

      expect(octokit.issues.updateComment).not.toHaveBeenCalled();
      expect(octokit.checks.update).not.toHaveBeenCalled();
    });
  });

  describe("complete", () => {
    it("edits the comment to a result line linking the posted review", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ statusCommentId: 1001 }));

      await service.complete("review-1", { githubReviewId: 777, critical: 2, warning: 13, info: 0 });

      const body = octokit.issues.updateComment.mock.calls[0]![0].body as string;
      expect(body).toContain("✅ CodeIQ review complete");
      expect(body).toContain("**15 issues** — 🔴 2 critical · 🟡 13 warning · 🔵 0 info");
      expect(body).toContain("https://github.com/acme/widgets/pull/15#pullrequestreview-777");
    });

    it("completes the check run as success, whatever the findings", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ checkRunId: 2002 }));

      await service.complete("review-1", { githubReviewId: 777, critical: 5, warning: 0, info: 0 });

      expect(octokit.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({
          check_run_id: 2002,
          status: "completed",
          conclusion: "success",
          details_url: "https://github.com/acme/widgets/pull/15#pullrequestreview-777",
          output: expect.objectContaining({ title: "5 issues found" }),
        })
      );
    });

    it("flags unanalysed sections so a partial review isn't shown as complete", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ statusCommentId: 1001 }));

      await service.complete("review-1", { githubReviewId: 777, critical: 0, warning: 1, info: 0, gaps: 7 });

      const body = octokit.issues.updateComment.mock.calls[0]![0].body as string;
      expect(body).toContain("⚠️ 7 file section(s) could not be analysed");
    });

    it("uses the note instead of counts when no review was posted", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ statusCommentId: 1001 }));

      await service.complete("review-1", { githubReviewId: null, critical: 0, warning: 0, info: 0, note: "No reviewable files." });

      const body = octokit.issues.updateComment.mock.calls[0]![0].body as string;
      expect(body).toContain("No reviewable files.");
      expect(body).not.toContain("View the review");
    });
  });

  describe("fail", () => {
    it("shows the quota message for FREE_TIER_EXHAUSTED and concludes the check run neutral", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ statusCommentId: 1001, checkRunId: 2002 }));

      await service.fail("review-1", "FREE_TIER_EXHAUSTED");

      const body = octokit.issues.updateComment.mock.calls[0]![0].body as string;
      expect(body).toContain("❌ CodeIQ review could not be completed");
      expect(body).toContain("free AI review quota has been reached");
      expect(octokit.checks.update).toHaveBeenCalledWith(
        expect.objectContaining({ status: "completed", conclusion: "neutral" })
      );
    });

    it("shows a generic retry message for any other failure", async () => {
      vi.mocked(repo.findContext).mockResolvedValue(buildContext({ statusCommentId: 1001 }));

      await service.fail("review-1", null);

      const body = octokit.issues.updateComment.mock.calls[0]![0].body as string;
      expect(body).toContain("retried from the CodeIQ dashboard");
    });
  });

  it("reuses one Octokit client per installation", async () => {
    await service.start("review-1");
    await service.complete("review-1", { githubReviewId: 1, critical: 0, warning: 0, info: 0 });

    expect(getOctokit).toHaveBeenCalledTimes(1);
    expect(getOctokit).toHaveBeenCalledWith(555);
  });
});
