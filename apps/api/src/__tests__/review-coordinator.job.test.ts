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
  IFairnessService,
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
    id: "coordinator-job-1",
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
    coordinatorJobId: null,
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
  let fairnessService: IFairnessService;
  let flowProducer: FlowProducer;
  let processor: ReviewCoordinatorJobProcessor;
  let nextChunkId: number;

  beforeEach(() => {
    vi.clearAllMocks();
    nextChunkId = 0;

    reviewRepo = {
      findManyForUser: vi.fn(),
      findById: vi.fn(),
      findByCoordinatorJobId: vi.fn().mockResolvedValue(null),
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
      prioritizeFiles: vi.fn().mockImplementation((files: DiffFile[]) => files),
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
    fairnessService = {
      priorityFor: vi.fn().mockResolvedValue(1),
      markInFlight: vi.fn(),
    };
    flowProducer = { add: vi.fn() } as unknown as FlowProducer;

    fakeOctokit.pulls.listFiles.mockResolvedValue({ data: [buildDiffFile()] });

    processor = new ReviewCoordinatorJobProcessor(
      reviewRepo,
      installationRepo,
      configService,
      diffService,
      reviewChunkRepo,
      fairnessService,
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
      coordinatorJobId: "coordinator-job-1",
    });
  });

  // BullMQ retries a failed coordinator job under the exact same job.id (jobs/worker.ts's
  // attempts: 3) — found live 2026-09-06 that this created a duplicate Review row per retry
  // attempt (memory/pitfalls.md #016's follow-up). These three tests cover the fix.
  it("reuses the existing Review row when one already exists for this job id (BullMQ retry)", async () => {
    const existing = buildReview({ id: "existing-review", coordinatorJobId: "coordinator-job-1" });
    vi.mocked(reviewRepo.findByCoordinatorJobId).mockResolvedValue(existing);
    vi.mocked(reviewRepo.update).mockResolvedValue(existing);
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([]);

    await processor.process(buildJob());

    expect(reviewRepo.findByCoordinatorJobId).toHaveBeenCalledWith("coordinator-job-1");
    expect(reviewRepo.create).not.toHaveBeenCalled();
    expect(reviewRepo.update).toHaveBeenCalledWith("existing-review", { status: "RUNNING" });
  });

  it("reuses already-persisted chunks from an earlier attempt instead of re-fetching the diff", async () => {
    const existing = buildReview({ id: "existing-review", coordinatorJobId: "coordinator-job-1" });
    const existingChunks: ReviewChunkRow[] = [
      {
        id: "chunk-from-earlier-attempt",
        reviewId: "existing-review",
        filename: "src/index.ts",
        patch: "@@ -1 +1 @@",
        chunkIndex: 0,
        status: "PENDING",
        attempts: 0,
      },
    ];
    vi.mocked(reviewRepo.findByCoordinatorJobId).mockResolvedValue(existing);
    vi.mocked(reviewRepo.update).mockResolvedValue(existing);
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue(existingChunks);

    await processor.process(buildJob());

    expect(fakeOctokit.pulls.listFiles).not.toHaveBeenCalled();
    expect(reviewChunkRepo.createMany).not.toHaveBeenCalled();
    expect(flowProducer.add).toHaveBeenCalledWith(
      expect.objectContaining({
        children: [expect.objectContaining({ data: expect.objectContaining({ chunkId: "chunk-from-earlier-attempt" }) })],
      })
    );
  });

  it("still fetches and chunks the diff on a reused review with no persisted chunks yet", async () => {
    const existing = buildReview({ id: "existing-review", coordinatorJobId: "coordinator-job-1" });
    vi.mocked(reviewRepo.findByCoordinatorJobId).mockResolvedValue(existing);
    vi.mocked(reviewRepo.update).mockResolvedValue(existing);
    vi.mocked(reviewChunkRepo.findByReviewId).mockResolvedValue([]);

    await processor.process(buildJob());

    expect(fakeOctokit.pulls.listFiles).toHaveBeenCalled();
    expect(reviewChunkRepo.createMany).toHaveBeenCalledWith("existing-review", expect.any(Array));
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
    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { totalChunks: 2, truncated: false });
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
        truncated: false,
      },
      children: [
        {
          name: "review-chunk",
          queueName: "review-chunk-queue",
          data: {
            reviewId: "review-1",
            chunkId: "chunk-1",
            installationId: "install-1",
            filename: "src/index.ts",
            patch: "@@ -1 +1 @@",
            repoConfig: DEFAULT_CONFIG,
          },
          opts: {
            jobId: "review-1-chunk-1",
            priority: 1,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000 },
            failParentOnFailure: false,
          },
        },
      ],
    });
  });

  it("truncates to MAX_CHUNKS_PER_REVIEW and marks the review truncated when a PR produces more chunks than the cap", async () => {
    const files = Array.from({ length: 3 }, (_, i) => buildDiffFile({ filename: `f${i}.ts` }));
    fakeOctokit.pulls.listFiles.mockResolvedValue({ data: files });
    // Force chunkFiles to fan a single file out into many chunks so 3 files comfortably exceed
    // a small test cap without needing 200+ fixture files.
    vi.mocked(diffService.chunkFiles).mockImplementation((fs: DiffFile[]) =>
      fs.flatMap((f) =>
        Array.from({ length: 100 }, (_, i): DiffChunk => ({ filename: f.filename, patch: "p", chunkIndex: i }))
      )
    );

    await processor.process(buildJob());

    // 3 files * 100 chunks = 300, which exceeds the real MAX_CHUNKS_PER_REVIEW (200).
    expect(reviewRepo.update).toHaveBeenCalledWith("review-1", { totalChunks: 200, truncated: true });
    const flowCall = vi.mocked(flowProducer.add).mock.calls[0]![0] as { children: unknown[] };
    expect(flowCall.children).toHaveLength(200);
  });

  it("prioritizes the largest diffs before chunking", async () => {
    await processor.process(buildJob());

    expect(diffService.prioritizeFiles).toHaveBeenCalledWith([
      expect.objectContaining({ filename: "src/index.ts" }),
    ]);
  });
});
