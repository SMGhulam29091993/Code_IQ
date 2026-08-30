import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ReviewChunkJobProcessor } from "../jobs/review-chunk.job";
import type { SanitizedRepoConfig } from "../modules/repos/repo.types";
import type {
  IGeminiService,
  IReviewChunkRepository,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewChunkJobData,
} from "../modules/reviews/review.types";

const DEFAULT_CONFIG: SanitizedRepoConfig = {
  severityThreshold: "WARNING",
  enabledCategories: ["bug", "security", "performance", "logic"],
  ignorePatterns: [],
  reviewOnDraft: false,
  postSummaryComment: true,
};

function buildJob(overrides: Partial<ReviewChunkJobData> = {}): Job<ReviewChunkJobData> {
  return {
    data: {
      reviewId: "review-1",
      chunkId: "chunk-1",
      filename: "a.ts",
      patch: "@@ -1 +1 @@",
      repoConfig: DEFAULT_CONFIG,
      ...overrides,
    },
  } as Job<ReviewChunkJobData>;
}

describe("ReviewChunkJobProcessor.process", () => {
  let reviewRepo: IReviewRepository;
  let reviewIssueRepo: IReviewIssueRepository;
  let reviewChunkRepo: IReviewChunkRepository;
  let geminiService: IGeminiService;
  let processor: ReviewChunkJobProcessor;

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
    reviewIssueRepo = { createMany: vi.fn(), findByReviewId: vi.fn() };
    reviewChunkRepo = {
      createMany: vi.fn(),
      findByReviewId: vi.fn(),
      findIncomplete: vi.fn(),
      markRunning: vi.fn(),
      markDone: vi.fn(),
      markFailed: vi.fn(),
    };
    geminiService = {
      reviewDiff: vi.fn().mockResolvedValue({
        issues: [{ line: 1, severity: "info", category: "style", message: "m", suggestion: "s" }],
        summary: "ok",
      }),
      summarizePR: vi.fn(),
    };

    processor = new ReviewChunkJobProcessor(reviewRepo, reviewIssueRepo, reviewChunkRepo, geminiService);
  });

  it("marks the chunk RUNNING before calling Gemini", async () => {
    await processor.process(buildJob());

    expect(reviewChunkRepo.markRunning).toHaveBeenCalledWith("chunk-1");
  });

  it("calls Gemini with the chunk's patch, config, and filename", async () => {
    await processor.process(buildJob());

    expect(geminiService.reviewDiff).toHaveBeenCalledWith("@@ -1 +1 @@", DEFAULT_CONFIG, "a.ts");
  });

  it("persists returned issues tagged with the review, file, and chunk id", async () => {
    await processor.process(buildJob());

    expect(reviewIssueRepo.createMany).toHaveBeenCalledWith("review-1", [
      { line: 1, severity: "info", category: "style", message: "m", suggestion: "s", file: "a.ts", chunkId: "chunk-1" },
    ]);
  });

  it("marks the chunk DONE on success", async () => {
    await processor.process(buildJob());

    expect(reviewChunkRepo.markDone).toHaveBeenCalledWith("chunk-1");
    expect(reviewChunkRepo.markFailed).not.toHaveBeenCalled();
  });

  it("marks the chunk FAILED and rethrows (so BullMQ retries) when Gemini fails", async () => {
    vi.mocked(geminiService.reviewDiff).mockRejectedValue(new Error("gemini timeout"));

    await expect(processor.process(buildJob())).rejects.toThrow("gemini timeout");

    expect(reviewChunkRepo.markFailed).toHaveBeenCalledWith("chunk-1", "Error: gemini timeout");
    expect(reviewChunkRepo.markDone).not.toHaveBeenCalled();
  });

  it("increments completedChunks whether the chunk succeeds or fails", async () => {
    await processor.process(buildJob());
    expect(reviewRepo.incrementCompletedChunks).toHaveBeenCalledWith("review-1");

    vi.clearAllMocks();
    vi.mocked(geminiService.reviewDiff).mockRejectedValue(new Error("down"));
    await expect(processor.process(buildJob())).rejects.toThrow();
    expect(reviewRepo.incrementCompletedChunks).toHaveBeenCalledWith("review-1");
  });
});
