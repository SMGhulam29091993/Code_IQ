import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation } from "@codeiq/db";
import { ReviewFinalizeJobProcessor } from "../jobs/review-finalize.job";
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

    processor = new ReviewFinalizeJobProcessor(
      reviewRepo,
      reviewIssueRepo,
      reviewChunkRepo,
      installationRepo,
      geminiService,
      commentService
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
      buildChunk({ status: "FAILED" }),
      buildChunk({ id: "chunk-2", status: "FAILED" }),
    ]);

    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { status: "FAILED" });
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
});
