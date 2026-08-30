import type { Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation, Review } from "@codeiq/db";
import { ReviewJobProcessor } from "../jobs/review.job";
import type { IInstallationRepository } from "../modules/github/github.types";
import type { ConfigService } from "../modules/repos/config.service";
import type { SanitizedRepoConfig } from "../modules/repos/repo.types";
import type {
  CreateChunkInput,
  DiffChunk,
  DiffFile,
  GeminiIssue,
  ICommentService,
  IDiffService,
  IGeminiService,
  IReviewChunkRepository,
  IReviewIssueRepository,
  IReviewRepository,
  ReviewChunkRow,
  ReviewJobData,
} from "../modules/reviews/review.types";

const { fakeOctokit } = vi.hoisted(() => ({
  fakeOctokit: { rest: {}, pulls: { listFiles: vi.fn() } },
}));
vi.mock("../lib/octokit", () => ({
  getInstallationOctokit: vi.fn().mockReturnValue(fakeOctokit),
}));
vi.mock("../lib/prisma", () => ({ prisma: {} }));

const NOW = new Date("2026-01-01T00:00:00Z");

const DEFAULT_CONFIG: SanitizedRepoConfig = {
  severityThreshold: "WARNING",
  enabledCategories: ["bug", "security", "performance", "logic"],
  ignorePatterns: [],
  reviewOnDraft: false,
  postSummaryComment: true,
};

function buildJob(overrides: Partial<ReviewJobData> = {}): Job<ReviewJobData> {
  return {
    data: {
      installationId: "install-1",
      repoId: "repo-1",
      prNumber: 42,
      prTitle: "Add feature",
      prAuthor: "octocat",
      headSha: "sha123",
      repoFullName: "acme/widgets",
      ...overrides,
    },
  } as Job<ReviewJobData>;
}

function buildReview(overrides: Partial<Review> = {}): Review {
  return {
    id: "review-1",
    repoId: "repo-1",
    prNumber: 42,
    prTitle: "Add feature",
    prAuthor: "octocat",
    headSha: "sha123",
    status: "RUNNING",
    summary: null,
    filesReviewed: 0,
    githubReviewId: null,
    totalChunks: 0,
    completedChunks: 0,
    truncated: false,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildDiffFile(overrides: Partial<DiffFile> = {}): DiffFile {
  return { filename: "src/index.ts", patch: "@@ -1 +1 @@", status: "modified", ...overrides };
}

describe("ReviewJobProcessor.process", () => {
  let reviewRepo: IReviewRepository;
  let reviewIssueRepo: IReviewIssueRepository;
  let installationRepo: IInstallationRepository;
  let configService: ConfigService;
  let diffService: IDiffService;
  let geminiService: IGeminiService;
  let commentService: ICommentService;
  let reviewChunkRepo: IReviewChunkRepository;
  let processor: ReviewJobProcessor;

  // Simple in-memory stand-ins for the ReviewChunk/ReviewIssue tables — decisions/007 Phase 2
  // moved chunk-level state and issue aggregation to be re-read from "storage" at finalize time
  // rather than accumulated in-process, so the fakes need to behave like real persistence
  // (survive across calls within one process() run) rather than being stateless mocks.
  let chunkStore: ReviewChunkRow[] = [];
  let issueStore: Array<GeminiIssue & { file: string; chunkId?: string }> = [];
  let nextChunkId = 0;

  beforeEach(() => {
    vi.clearAllMocks();
    chunkStore = [];
    issueStore = [];
    nextChunkId = 0;

    reviewRepo = {
      findManyForUser: vi.fn(),
      findById: vi.fn(),
      create: vi.fn().mockResolvedValue(buildReview()),
      update: vi.fn().mockResolvedValue(buildReview({ status: "DONE" })),
      countForUser: vi.fn(),
      countIssuesBySeverityForUser: vi.fn(),
      countIssuesByCategoryForUser: vi.fn(),
      countIssuesByDayForUser: vi.fn(),
      countReviewsByAuthorForInstallation: vi.fn(),
      incrementCompletedChunks: vi.fn(),
    };
    reviewIssueRepo = {
      createMany: vi.fn().mockImplementation(async (_reviewId, issues) => {
        issueStore.push(...issues);
      }),
      findByReviewId: vi.fn().mockImplementation(async () => issueStore),
    };
    reviewChunkRepo = {
      createMany: vi.fn().mockImplementation(async (reviewId: string, chunks: CreateChunkInput[]) => {
        const rows = chunks.map(
          (chunk): ReviewChunkRow => ({
            id: `chunk-${++nextChunkId}`,
            reviewId,
            filename: chunk.filename,
            patch: chunk.patch,
            chunkIndex: chunk.chunkIndex,
            status: "PENDING",
            attempts: 0,
          })
        );
        chunkStore.push(...rows);
        return rows;
      }),
      findByReviewId: vi.fn().mockImplementation(async () => chunkStore),
      findIncomplete: vi
        .fn()
        .mockImplementation(async () =>
          chunkStore.filter((row) => row.status === "PENDING" || row.status === "FAILED")
        ),
      markRunning: vi.fn().mockImplementation(async (chunkId: string) => {
        const row = chunkStore.find((r) => r.id === chunkId);
        if (row) {
          row.status = "RUNNING";
          row.attempts += 1;
        }
      }),
      markDone: vi.fn().mockImplementation(async (chunkId: string) => {
        const row = chunkStore.find((r) => r.id === chunkId);
        if (row) row.status = "DONE";
      }),
      markFailed: vi.fn().mockImplementation(async (chunkId: string) => {
        const row = chunkStore.find((r) => r.id === chunkId);
        if (row) row.status = "FAILED";
      }),
    };
    installationRepo = {
      findByGithubId: vi.fn(),
      findById: vi.fn().mockResolvedValue({ githubInstallationId: 555 } as Installation),
      upsert: vi.fn(),
      findManyActiveForUser: vi.fn(),
      softDelete: vi.fn(),
      updateActiveByGithubId: vi.fn(),
    };
    configService = { getEffectiveConfig: vi.fn().mockResolvedValue(DEFAULT_CONFIG) } as unknown as ConfigService;
    diffService = {
      filterFiles: vi.fn().mockImplementation((files: DiffFile[]) => files),
      chunkFiles: vi.fn().mockImplementation((files: DiffFile[]) =>
        files.map((f): DiffChunk => ({ filename: f.filename, patch: f.patch ?? "", chunkIndex: 0 }))
      ),
    };
    geminiService = {
      reviewDiff: vi.fn().mockResolvedValue({ issues: [], summary: "ok" }),
      summarizePR: vi.fn().mockResolvedValue("PR summary"),
    };
    commentService = { postReview: vi.fn().mockResolvedValue(777) };

    fakeOctokit.pulls.listFiles.mockResolvedValue({ data: [buildDiffFile()] });

    processor = new ReviewJobProcessor(
      reviewRepo,
      reviewIssueRepo,
      installationRepo,
      configService,
      diffService,
      geminiService,
      commentService,
      reviewChunkRepo
    );
  });

  it("creates a Review row at start", async () => {
    await processor.process(buildJob());

    expect(reviewRepo.create).toHaveBeenCalledWith({
      repoId: "repo-1",
      prNumber: 42,
      prTitle: "Add feature",
      prAuthor: "octocat",
      headSha: "sha123",
    });
  });

  it("marks review DONE on successful completion", async () => {
    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith(
      "review-1",
      expect.objectContaining({ status: "DONE" })
    );
  });

  it("marks review FAILED when an unhandled error occurs", async () => {
    vi.mocked(installationRepo.findById).mockResolvedValue(null);

    await expect(processor.process(buildJob())).rejects.toThrow();

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { status: "FAILED" });
  });

  it("calls geminiService for each file chunk", async () => {
    fakeOctokit.pulls.listFiles.mockResolvedValue({
      data: [buildDiffFile({ filename: "a.ts" }), buildDiffFile({ filename: "b.ts" })],
    });

    await processor.process(buildJob());

    expect(geminiService.reviewDiff).toHaveBeenCalledTimes(2);
  });

  it("uses Promise.allSettled — continues when one chunk fails", async () => {
    fakeOctokit.pulls.listFiles.mockResolvedValue({
      data: [buildDiffFile({ filename: "a.ts" }), buildDiffFile({ filename: "b.ts" })],
    });
    vi.mocked(geminiService.reviewDiff)
      .mockRejectedValueOnce(new Error("gemini timeout"))
      .mockResolvedValueOnce({
        issues: [
          { line: 1, severity: "info", category: "style", message: "m", suggestion: "s" },
        ],
        summary: "ok",
      });

    await processor.process(buildJob());

    expect(reviewIssueRepo.createMany).toHaveBeenCalledWith("review-1", [
      expect.objectContaining({ file: "b.ts" }),
    ]);
    expect(reviewRepo.update).toHaveBeenCalledWith(
      "review-1",
      expect.objectContaining({ status: "DONE" })
    );
  });

  it("marks review FAILED when all Gemini calls fail", async () => {
    vi.mocked(geminiService.reviewDiff).mockRejectedValue(new Error("gemini down"));

    await expect(processor.process(buildJob())).rejects.toThrow();

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { status: "FAILED" });
  });

  it("applies ignore patterns from repo config via diffService.filterFiles", async () => {
    await processor.process(buildJob());

    expect(diffService.filterFiles).toHaveBeenCalledWith(
      [expect.objectContaining({ filename: "src/index.ts" })],
      DEFAULT_CONFIG
    );
  });

  it("posts all issues in a single GitHub review API call", async () => {
    await processor.process(buildJob());

    expect(commentService.postReview).toHaveBeenCalledTimes(1);
    expect(commentService.postReview).toHaveBeenCalledWith(
      fakeOctokit,
      expect.objectContaining({ owner: "acme", repo: "widgets", prNumber: 42, headSha: "sha123" })
    );
  });

  it("stores filesReviewed count correctly", async () => {
    fakeOctokit.pulls.listFiles.mockResolvedValue({
      data: [buildDiffFile({ filename: "a.ts" }), buildDiffFile({ filename: "b.ts" })],
    });

    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith(
      "review-1",
      expect.objectContaining({ filesReviewed: 2 })
    );
  });

  it("marks DONE with no-issues summary when all files are filtered out", async () => {
    vi.mocked(diffService.filterFiles).mockReturnValue([]);

    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", {
      status: "DONE",
      summary: "No reviewable files in this PR.",
      filesReviewed: 0,
    });
    expect(commentService.postReview).not.toHaveBeenCalled();
  });

  it("stores githubReviewId after successful GitHub post", async () => {
    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith(
      "review-1",
      expect.objectContaining({ githubReviewId: 777 })
    );
  });

  // decisions/007 Phase 2: retry (job.data.reviewId set) resumes an existing review's
  // already-persisted ReviewChunk rows instead of creating a new Review and re-fetching/
  // re-chunking the diff from GitHub.
  describe("retry (job.data.reviewId set)", () => {
    function seedExistingChunk(overrides: Partial<ReviewChunkRow> = {}): ReviewChunkRow {
      const row: ReviewChunkRow = {
        id: `chunk-${++nextChunkId}`,
        reviewId: "review-1",
        filename: "a.ts",
        patch: "@@ -1 +1 @@",
        chunkIndex: 0,
        status: "PENDING",
        attempts: 0,
        ...overrides,
      };
      chunkStore.push(row);
      return row;
    }

    beforeEach(() => {
      vi.mocked(reviewRepo.findById).mockResolvedValue({
        ...buildReview({ status: "PENDING" }),
        issues: [],
        repo: { installation: { userId: "user-1" } },
      });
    });

    it("resumes the existing review instead of creating a new one", async () => {
      seedExistingChunk({ status: "FAILED" });

      await processor.process(buildJob({ reviewId: "review-1" }));

      expect(reviewRepo.create).not.toHaveBeenCalled();
      expect(reviewRepo.findById).toHaveBeenCalledWith("review-1");
      expect(fakeOctokit.pulls.listFiles).not.toHaveBeenCalled();
    });

    it("only re-runs chunks that are not DONE, never re-billing an already-successful chunk", async () => {
      const doneChunk = seedExistingChunk({ filename: "done.ts", status: "DONE" });
      issueStore.push({
        line: 1,
        severity: "info",
        category: "style",
        message: "already found",
        suggestion: "s",
        file: doneChunk.filename,
        chunkId: doneChunk.id,
      });
      seedExistingChunk({ filename: "failed.ts", status: "FAILED" });

      await processor.process(buildJob({ reviewId: "review-1" }));

      expect(geminiService.reviewDiff).toHaveBeenCalledTimes(1);
      expect(geminiService.reviewDiff).toHaveBeenCalledWith(
        "@@ -1 +1 @@",
        DEFAULT_CONFIG,
        "failed.ts"
      );
    });

    it("aggregates issues from previously-DONE chunks together with newly-run chunks", async () => {
      const doneChunk = seedExistingChunk({ filename: "done.ts", status: "DONE" });
      issueStore.push({
        line: 1,
        severity: "info",
        category: "style",
        message: "already found",
        suggestion: "s",
        file: doneChunk.filename,
        chunkId: doneChunk.id,
      });
      seedExistingChunk({ filename: "failed.ts", status: "FAILED" });
      vi.mocked(geminiService.reviewDiff).mockResolvedValue({
        issues: [
          { line: 2, severity: "warning", category: "bug", message: "new issue", suggestion: "s2" },
        ],
        summary: "ok",
      });

      await processor.process(buildJob({ reviewId: "review-1" }));

      expect(commentService.postReview).toHaveBeenCalledWith(
        fakeOctokit,
        expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ file: "done.ts" }),
            expect.objectContaining({ file: "failed.ts" }),
          ]),
        })
      );
      expect(reviewRepo.update).toHaveBeenCalledWith(
        "review-1",
        expect.objectContaining({ status: "DONE", filesReviewed: 2 })
      );
    });

    it("marks the resumed review FAILED again if the retry's chunks fail too", async () => {
      seedExistingChunk({ filename: "failed.ts", status: "FAILED" });
      vi.mocked(geminiService.reviewDiff).mockRejectedValue(new Error("still down"));

      await expect(processor.process(buildJob({ reviewId: "review-1" }))).rejects.toThrow();

      expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { status: "FAILED" });
    });
  });
});
