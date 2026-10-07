import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation } from "@codeiq/db";
import { ALL_TIERS_EXHAUSTED_CHUNK_ERROR } from "../jobs/review-chunk.job";
import { ReviewFinalizeJobProcessor } from "../jobs/review-finalize.job";
import { AllTiersExhaustedError } from "../lib/llm-client";
import type { IInstallationRepository } from "../modules/github/github.types";
import type {
  ICommentService,
  IGeminiService,
  IReviewChunkRepository,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewChunkRow,
  ReviewFinalizeJobData,
} from "../modules/reviews/review.types";

// pr-status.service.ts is best-effort and fully mocked here — its own behavior is covered by
// pr-status.service.test.ts.
function buildPrStatus() {
  return { start: vi.fn(), progress: vi.fn(), complete: vi.fn(), fail: vi.fn() };
}
let prStatus: ReturnType<typeof buildPrStatus>;

const { fakeOctokit } = vi.hoisted(() => ({ fakeOctokit: { rest: {} } }));
vi.mock("../lib/octokit", () => ({
  getInstallationOctokit: vi.fn().mockReturnValue(fakeOctokit),
}));

function buildJob(overrides: Partial<ReviewFinalizeJobData> = {}): Job<ReviewFinalizeJobData> {
  return {
    data: {
      reviewId: "review-1",
      installationId: "install-1",
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      prTitle: "Add feature",
      headSha: "sha123",
      truncated: false,
      ...overrides,
    },
  } as Job<ReviewFinalizeJobData>;
}

function buildChunk(overrides: Partial<ReviewChunkRow> = {}): ReviewChunkRow {
  return {
    id: "chunk-1",
    reviewId: "review-1",
    filename: "a.ts",
    patch: "@@ -1 +1 @@",
    chunkIndex: 0,
    status: "DONE",
    attempts: 1,
    ...overrides,
  };
}

describe("ReviewFinalizeJobProcessor.process", () => {
  let reviewRepo: IReviewRepository;
  let reviewIssueRepo: IReviewIssueRepository;
  let reviewChunkRepo: IReviewChunkRepository;
  let installationRepo: IInstallationRepository;
  let geminiService: IGeminiService;
  let commentService: ICommentService;
  let processor: ReviewFinalizeJobProcessor;

  beforeEach(() => {
    vi.clearAllMocks();

    reviewRepo = {
      findManyForUser: vi.fn(),
      findById: vi.fn(),
      findByCoordinatorJobId: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      countForUser: vi.fn(),
      countIssuesBySeverityForUser: vi.fn(),
      countIssuesByCategoryForUser: vi.fn(),
      countIssuesByDayForUser: vi.fn(),
      countReviewsByAuthorForInstallation: vi.fn(),
      incrementCompletedChunks: vi.fn(),
    };
    reviewIssueRepo = { createMany: vi.fn(), findByReviewId: vi.fn().mockResolvedValue([]) };
    reviewChunkRepo = {
      createMany: vi.fn(),
      findByReviewId: vi.fn().mockResolvedValue([buildChunk()]),
      findIncomplete: vi.fn(),
      markRunning: vi.fn(),
      markDone: vi.fn(),
      markFailed: vi.fn(),
    };
    installationRepo = {
      findByGithubId: vi.fn(),
      findById: vi.fn().mockResolvedValue({ githubInstallationId: 555 } as Installation),
      upsert: vi.fn(),
      findManyActiveForUser: vi.fn(),
      softDelete: vi.fn(),
      updateActiveByGithubId: vi.fn(),
    };
    geminiService = {
      reviewDiff: vi.fn(),
      summarizePR: vi.fn().mockResolvedValue("PR summary"),
    };
    commentService = { postReview: vi.fn().mockResolvedValue(777) };

    prStatus = buildPrStatus();
    processor = new ReviewFinalizeJobProcessor(
      reviewRepo,
      reviewIssueRepo,
      reviewChunkRepo,
      installationRepo,
      geminiService,
      commentService,
      prStatus
    );
  });

  it("posts a single GitHub review with every issue aggregated for the review", async () => {
    vi.mocked(reviewIssueRepo.findByReviewId).mockResolvedValue([
      { line: 1, severity: "info", category: "style", message: "m", suggestion: "s", file: "a.ts" },
    ]);

    await processor.process(buildJob());

    expect(commentService.postReview).toHaveBeenCalledWith(fakeOctokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 42,
      headSha: "sha123",
      issues: [{ line: 1, severity: "info", category: "style", message: "m", suggestion: "s", file: "a.ts" }],
      summary: "PR summary",
      includeSummary: true,
    });
  });

  it("marks the review DONE with distinct-filename filesReviewed and the githubReviewId", async () => {
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([
      buildChunk({ id: "chunk-1", filename: "a.ts", status: "DONE", chunkIndex: 0 }),
      buildChunk({ id: "chunk-2", filename: "a.ts", status: "DONE", chunkIndex: 1 }), // same file, 2 chunks
      buildChunk({ id: "chunk-3", filename: "b.ts", status: "DONE" }),
    ]);

    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", {
      status: "DONE",
      summary: "PR summary",
      filesReviewed: 2,
      githubReviewId: 777,
    });
  });

  it("marks the review FAILED without posting when every chunk failed", async () => {
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([
      buildChunk({ status: "FAILED", error: "gemini timeout" }),
      buildChunk({ id: "chunk-2", status: "FAILED", error: "gemini timeout" }),
    ]);

    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", {
      status: "FAILED",
      failureReason: null,
    });
    expect(commentService.postReview).not.toHaveBeenCalled();
  });

  // decisions/008's fast-fail addendum — jobs/review-chunk.job.ts stamps every chunk it
  // terminates via the exhaustion short circuit with this exact marker.
  it("marks the review FAILED with failureReason FREE_TIER_EXHAUSTED when every chunk failed due to the LLM fallback chain being exhausted", async () => {
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([
      buildChunk({ status: "FAILED", error: ALL_TIERS_EXHAUSTED_CHUNK_ERROR }),
      buildChunk({ id: "chunk-2", status: "FAILED", error: ALL_TIERS_EXHAUSTED_CHUNK_ERROR }),
    ]);

    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", {
      status: "FAILED",
      failureReason: "FREE_TIER_EXHAUSTED",
    });
    expect(commentService.postReview).not.toHaveBeenCalled();
  });

  it("still posts and marks DONE on a partial failure, noting the gap in the summary", async () => {
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([
      buildChunk({ id: "chunk-1", status: "DONE" }),
      buildChunk({ id: "chunk-2", filename: "b.ts", status: "FAILED" }),
    ]);

    await processor.process(buildJob());

    expect(commentService.postReview).toHaveBeenCalledWith(
      fakeOctokit,
      expect.objectContaining({
        summary: expect.stringContaining("1 file section(s) could not be analyzed after retries."),
      })
    );
    expect(reviewRepo.update).toHaveBeenCalledWith(
      "review-1",
      expect.objectContaining({ status: "DONE", filesReviewed: 1 })
    );
  });

  it("notes the per-review analysis limit in the summary when the review was truncated", async () => {
    await processor.process(buildJob({ truncated: true }));

    expect(commentService.postReview).toHaveBeenCalledWith(
      fakeOctokit,
      expect.objectContaining({
        summary: expect.stringContaining("exceeded the per-review analysis limit"),
      })
    );
  });

  describe("PR status (pr-status.service.ts)", () => {
    it("completes the PR status with the posted review id and severity counts", async () => {
      vi.mocked(reviewIssueRepo.findByReviewId).mockResolvedValue([
        { line: 1, severity: "critical", category: "bug", message: "m1", suggestion: "s", file: "a.ts" },
        { line: 2, severity: "warning", category: "bug", message: "m2", suggestion: "s", file: "a.ts" },
        { line: 3, severity: "warning", category: "logic", message: "m3", suggestion: "s", file: "b.ts" },
      ]);

      await processor.process(buildJob());

      expect(prStatus.complete).toHaveBeenCalledWith("review-1", {
        githubReviewId: 777,
        critical: 1,
        warning: 2,
        info: 0,
        gaps: 0,
      });
    });

    it("marks the PR status failed with the failure reason when every chunk failed", async () => {
      vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([
        buildChunk({ status: "FAILED", error: ALL_TIERS_EXHAUSTED_CHUNK_ERROR }),
      ]);

      await processor.process(buildJob());

      expect(prStatus.fail).toHaveBeenCalledWith("review-1", "FREE_TIER_EXHAUSTED");
      expect(prStatus.complete).not.toHaveBeenCalled();
    });

    it("marks the PR status failed and rethrows when posting the review fails", async () => {
      vi.mocked(commentService.postReview).mockRejectedValue(new Error("422 Line could not be resolved"));

      await expect(processor.process(buildJob())).rejects.toThrow("422");

      expect(prStatus.fail).toHaveBeenCalledWith("review-1", null);
      expect(prStatus.complete).not.toHaveBeenCalled();
    });
  });

  // pitfall #021: a chunk job BullMQ fails for stalling never reaches its catch block, so its row
  // is still RUNNING when finalize runs — it's a gap, not a success.
  it("counts a chunk stranded at RUNNING as a gap in the summary", async () => {
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([
      buildChunk({ status: "DONE" }),
      buildChunk({ id: "chunk-2", status: "RUNNING" }),
    ]);

    await processor.process(buildJob());

    expect(commentService.postReview).toHaveBeenCalled();
    expect(reviewRepo.update).toHaveBeenCalledWith(
      "review-1",
      expect.objectContaining({
        status: "DONE",
        summary: expect.stringContaining("1 file section(s) could not be analyzed"),
      })
    );
    expect(prStatus.complete).toHaveBeenCalledWith("review-1", expect.objectContaining({ gaps: 1 }));
  });

  it("marks the review FAILED when every chunk is stranded at RUNNING", async () => {
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([
      buildChunk({ status: "RUNNING" }),
      buildChunk({ id: "chunk-2", status: "RUNNING" }),
    ]);

    await processor.process(buildJob());

    expect(commentService.postReview).not.toHaveBeenCalled();
    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", expect.objectContaining({ status: "FAILED" }));
  });

  it("posts, summarizes and counts duplicate issues only once", async () => {
    const dup = { line: 1, severity: "warning" as const, category: "logic" as const, message: "Same thing", suggestion: "s", file: "a.ts" };
    vi.mocked(reviewIssueRepo.findByReviewId).mockResolvedValue([dup, { ...dup, line: 50 }, { ...dup, line: 99 }]);

    await processor.process(buildJob());

    expect(geminiService.summarizePR).toHaveBeenCalledWith(expect.anything(), [dup]);
    expect(commentService.postReview).toHaveBeenCalledWith(fakeOctokit, expect.objectContaining({ issues: [dup] }));
    expect(prStatus.complete).toHaveBeenCalledWith("review-1", expect.objectContaining({ warning: 1 }));
  });

  describe("postSummaryComment", () => {
    it("passes the repo's postSummaryComment setting through to postReview", async () => {
      await processor.process(buildJob({ postSummaryComment: false }));

      expect(commentService.postReview).toHaveBeenCalledWith(
        fakeOctokit,
        expect.objectContaining({ includeSummary: false })
      );
    });

    it("defaults to including the summary for jobs queued without the setting", async () => {
      await processor.process(buildJob());

      expect(commentService.postReview).toHaveBeenCalledWith(
        fakeOctokit,
        expect.objectContaining({ includeSummary: true })
      );
    });

    it("marks the review DONE without a githubReviewId when nothing was posted", async () => {
      vi.mocked(commentService.postReview).mockResolvedValue(null);

      await processor.process(buildJob({ postSummaryComment: false }));

      const update = vi.mocked(reviewRepo.update).mock.calls.at(-1)![1];
      expect(update).toEqual(expect.objectContaining({ status: "DONE" }));
      expect(update).not.toHaveProperty("githubReviewId");
      expect(prStatus.complete).toHaveBeenCalledWith("review-1", expect.objectContaining({ githubReviewId: null }));
    });
  });

  // 2026-10-08: a failed finalize (e.g. GitHub 500 on createReview) left the review RUNNING forever.
  describe("failure handling across attempts", () => {
    function jobOnAttempt(attemptsMade: number, attempts = 3) {
      return { ...buildJob(), attemptsMade, opts: { attempts } } as unknown as ReturnType<typeof buildJob>;
    }

    it("rethrows without settling the review on a non-final attempt, so BullMQ retries", async () => {
      vi.mocked(commentService.postReview).mockRejectedValue(new Error("Server Error"));

      await expect(processor.process(jobOnAttempt(0))).rejects.toThrow("Server Error");

      expect(reviewRepo.update).not.toHaveBeenCalledWith("review-1", expect.objectContaining({ status: "FAILED" }));
      expect(prStatus.fail).not.toHaveBeenCalled();
    });

    it("marks the review FAILED and the PR status failed on the final attempt", async () => {
      vi.mocked(commentService.postReview).mockRejectedValue(new Error("Server Error"));

      await expect(processor.process(jobOnAttempt(2))).rejects.toThrow("Server Error");

      expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { status: "FAILED", failureReason: null });
      expect(prStatus.fail).toHaveBeenCalledWith("review-1", null);
    });

    it("uses FREE_TIER_EXHAUSTED when the summary call ran out of every LLM tier", async () => {
      vi.mocked(geminiService.summarizePR).mockRejectedValue(new AllTiersExhaustedError("quota", ["gemini=429"]));

      await expect(processor.process(jobOnAttempt(2))).rejects.toThrow();

      expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { status: "FAILED", failureReason: "FREE_TIER_EXHAUSTED" });
      expect(prStatus.fail).toHaveBeenCalledWith("review-1", "FREE_TIER_EXHAUSTED");
    });
  });
});
