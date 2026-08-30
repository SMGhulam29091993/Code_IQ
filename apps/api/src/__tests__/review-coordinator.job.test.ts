import type { FlowProducer, Job } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation, Review } from "@codeiq/db";
import { ReviewCoordinatorJobProcessor } from "../jobs/review-coordinator.job";
import type { IInstallationRepository } from "../modules/github/github.types";
import type { ConfigService } from "../modules/repos/config.service";
import type { SanitizedRepoConfig } from "../modules/repos/repo.types";
import type {
  DiffChunk,
  DiffFile,
  IDiffService,
  IReviewChunkRepository,
  IReviewRepository,
  ReviewChunkRow,
  ReviewCoordinatorJobData,
} from "../modules/reviews/review.types";

const { fakeOctokit } = vi.hoisted(() => ({
  fakeOctokit: { rest: {}, pulls: { listFiles: vi.fn() } },
}));
vi.mock("../lib/octokit", () => ({
  getInstallationOctokit: vi.fn().mockReturnValue(fakeOctokit),
}));

const NOW = new Date("2026-01-01T00:00:00Z");

const DEFAULT_CONFIG: SanitizedRepoConfig = {
  severityThreshold: "WARNING",
  enabledCategories: ["bug", "security", "performance", "logic"],
  ignorePatterns: [],
  reviewOnDraft: false,
  postSummaryComment: true,
};

function buildJob(overrides: Partial<ReviewCoordinatorJobData> = {}): Job<ReviewCoordinatorJobData> {
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
  } as Job<ReviewCoordinatorJobData>;
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

describe("ReviewCoordinatorJobProcessor.process", () => {
  let reviewRepo: IReviewRepository;
  let installationRepo: IInstallationRepository;
  let configService: ConfigService;
  let diffService: IDiffService;
  let reviewChunkRepo: IReviewChunkRepository;
  let flowProducer: FlowProducer;
  let processor: ReviewCoordinatorJobProcessor;
  let nextChunkId: number;

  beforeEach(() => {
    vi.clearAllMocks();
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
    reviewChunkRepo = {
      createMany: vi.fn().mockImplementation(async (reviewId: string, chunks: DiffChunk[]) =>
        chunks.map(
          (chunk): ReviewChunkRow => ({
            id: `chunk-${++nextChunkId}`,
            reviewId,
            filename: chunk.filename,
            patch: chunk.patch,
            chunkIndex: chunk.chunkIndex,
            status: "PENDING",
            attempts: 0,
          })
        )
      ),
      findByReviewId: vi.fn(),
      findIncomplete: vi.fn(),
      markRunning: vi.fn(),
      markDone: vi.fn(),
      markFailed: vi.fn(),
    };
    flowProducer = { add: vi.fn() } as unknown as FlowProducer;

    fakeOctokit.pulls.listFiles.mockResolvedValue({ data: [buildDiffFile()] });

    processor = new ReviewCoordinatorJobProcessor(
      reviewRepo,
      installationRepo,
      configService,
      diffService,
      reviewChunkRepo,
      flowProducer
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

  it("marks review FAILED when the installation is not found", async () => {
    vi.mocked(installationRepo.findById).mockResolvedValue(null);

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

  it("marks DONE with no-issues summary when all files are filtered out, without fanning out", async () => {
    vi.mocked(diffService.filterFiles).mockReturnValue([]);

    await processor.process(buildJob());

    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", {
      status: "DONE",
      summary: "No reviewable files in this PR.",
      filesReviewed: 0,
    });
    expect(flowProducer.add).not.toHaveBeenCalled();
  });

  it("persists a ReviewChunk row per chunk and records totalChunks before fanning out", async () => {
    fakeOctokit.pulls.listFiles.mockResolvedValue({
      data: [buildDiffFile({ filename: "a.ts" }), buildDiffFile({ filename: "b.ts" })],
    });

    await processor.process(buildJob());

    expect(reviewChunkRepo.createMany).toHaveBeenCalledWith(
      "review-1",
      expect.arrayContaining([
        expect.objectContaining({ filename: "a.ts" }),
        expect.objectContaining({ filename: "b.ts" }),
      ])
    );
    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { totalChunks: 2 });
  });

  it("fans out one review-chunk job per chunk under a finalize-review parent", async () => {
    await processor.process(buildJob());

    expect(flowProducer.add).toHaveBeenCalledWith({
      name: "finalize-review",
      queueName: "review-finalize-queue",
      data: {
        reviewId: "review-1",
        installationId: "install-1",
        owner: "acme",
        repo: "widgets",
        prNumber: 42,
        prTitle: "Add feature",
        headSha: "sha123",
      },
      children: [
        {
          name: "review-chunk",
          queueName: "review-chunk-queue",
          data: {
            reviewId: "review-1",
            chunkId: "chunk-1",
            filename: "src/index.ts",
            patch: "@@ -1 +1 @@",
            repoConfig: DEFAULT_CONFIG,
          },
          opts: {
            jobId: "review-1:chunk-1",
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            failParentOnFailure: false,
          },
        },
      ],
    });
  });
});
