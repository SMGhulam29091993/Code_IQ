import type { Review, ReviewIssue } from "@codeiq/db";
import type { SanitizedRepoConfig } from "../repos/repo.types";

export type ReviewStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
export type IssueSeverity = "critical" | "warning" | "info";
export type IssueCategory = "bug" | "security" | "style" | "performance" | "logic";
export type ChunkStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";

export interface SanitizedReviewIssue {
  id: string;
  file: string;
  line: number;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  suggestion: string;
}

export interface SanitizedReviewSummary {
  id: string;
  repoId: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  status: ReviewStatus;
  filesReviewed: number;
  createdAt: Date;
  // Live progress (decisions/007 Phase 4) — completedChunks is UI-only and may not always be
  // monotonic under chunk-job retries; poll while status is RUNNING for a coarse progress bar,
  // never for correctness decisions.
  totalChunks: number;
  completedChunks: number;
  truncated: boolean;
}

export interface SanitizedReview extends SanitizedReviewSummary {
  headSha: string;
  summary: string | null;
  githubReviewId: number | null;
  issues: SanitizedReviewIssue[];
}

export interface ListReviewsFilters {
  repoId?: string;
  status?: ReviewStatus;
  page: number;
  limit: number;
}

export interface ListReviewsResult {
  reviews: SanitizedReviewSummary[];
  total: number;
  page: number;
  totalPages: number;
}

export interface GetReviewResult {
  review: SanitizedReview;
}

export interface RetryReviewResult {
  review: SanitizedReviewSummary;
}

export interface GetStatsFilters {
  repoId?: string;
  days: number;
}

export interface ReviewStatsResult {
  totalReviews: number;
  totalIssues: number;
  issuesBySeverity: { critical: number; warning: number; info: number };
  issuesByCategory: {
    bug: number;
    security: number;
    style: number;
    performance: number;
    logic: number;
  };
  recentTrend: Array<{ date: string; count: number }>;
}

export type ReviewWithOwner = Review & {
  issues: ReviewIssue[];
  repo: { installation: { userId: string } };
};

export interface CreateReviewInput {
  repoId: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  headSha: string;
}

export interface UpdateReviewInput {
  status?: ReviewStatus;
  summary?: string;
  filesReviewed?: number;
  githubReviewId?: number;
  totalChunks?: number;
  truncated?: boolean;
}

export interface CreateIssueInput {
  file: string;
  line: number;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  suggestion: string;
  chunkId?: string;
}

export interface CreateChunkInput {
  filename: string;
  patch: string;
  chunkIndex: number;
}

export interface ReviewChunkRow {
  id: string;
  reviewId: string;
  filename: string;
  patch: string;
  chunkIndex: number;
  status: ChunkStatus;
  attempts: number;
}

export interface IReviewRepository {
  // Scoped to reviews under repos whose installation belongs to userId — never a bare
  // Review.findMany. Same tenant-isolation stance as modules/repos (.ai/memory/pitfalls.md #005).
  findManyForUser(
    userId: string,
    filters: ListReviewsFilters
  ): Promise<{ reviews: Review[]; total: number }>;
  // Not pre-scoped to userId — findOwnedReview (review.service.ts) checks ownership itself so
  // it can distinguish "not found" (404) from "belongs to another user" (403), same pattern as
  // modules/repos/repo.service.ts's findOwnedRepo.
  findById(reviewId: string): Promise<ReviewWithOwner | null>;
  create(input: CreateReviewInput): Promise<Review>;
  update(reviewId: string, input: UpdateReviewInput): Promise<Review>;
  countForUser(userId: string, filters: { repoId?: string; since?: Date }): Promise<number>;
  countIssuesBySeverityForUser(
    userId: string,
    filters: { repoId?: string; since?: Date }
  ): Promise<Record<string, number>>;
  countIssuesByCategoryForUser(
    userId: string,
    filters: { repoId?: string; since?: Date }
  ): Promise<Record<string, number>>;
  countIssuesByDayForUser(
    userId: string,
    filters: { repoId?: string; since: Date }
  ): Promise<Array<{ date: string; count: number }>>;
  // Consumed by BillingService.getSeats (.ai/knowledge/domains/billing.md "GET /billing/seats")
  // — review count per prAuthor login, scoped to one installation (not one user's repos across
  // installations, unlike every other method here — seats are an installation-level concept).
  countReviewsByAuthorForInstallation(
    installationId: string,
    since: Date
  ): Promise<Record<string, number>>;
  // Atomic at the DB level — safe to call from multiple chunks completing concurrently within
  // the same job (mapWithConcurrency). UI-progress only; the finalize step (review.job.ts) never
  // trusts this counter for its DONE/FAILED gating decision — it re-queries ReviewChunk rows
  // directly. See knowledge/technical/backend/review-pipeline-scaling.md.
  incrementCompletedChunks(reviewId: string): Promise<void>;
}

export interface IReviewIssueRepository {
  createMany(reviewId: string, issues: CreateIssueInput[]): Promise<void>;
  // All issues persisted for a review so far, regardless of which job run created them —
  // used at finalize time (fresh run and resumed retries alike) instead of accumulating issues
  // in memory across a retry's in-process chunk loop.
  findByReviewId(reviewId: string): Promise<Array<GeminiIssue & { file: string }>>;
}

export interface IReviewChunkRepository {
  createMany(reviewId: string, chunks: CreateChunkInput[]): Promise<ReviewChunkRow[]>;
  findByReviewId(reviewId: string): Promise<ReviewChunkRow[]>;
  // PENDING or FAILED rows — what a retry needs to re-run. DONE rows are never re-run/re-billed.
  findIncomplete(reviewId: string): Promise<ReviewChunkRow[]>;
  markRunning(chunkId: string): Promise<void>;
  markDone(chunkId: string): Promise<void>;
  markFailed(chunkId: string, error: string): Promise<void>;
}

export interface IReviewService {
  listReviews(userId: string, filters: ListReviewsFilters): Promise<ListReviewsResult>;
  getReview(userId: string, reviewId: string): Promise<GetReviewResult>;
  retryReview(userId: string, reviewId: string): Promise<RetryReviewResult>;
  getStats(userId: string, filters: GetStatsFilters): Promise<ReviewStatsResult>;
}

// One issue as returned by Gemini for a single diff chunk — see gemini.service.ts.
export interface GeminiIssue {
  line: number;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  suggestion: string;
}

export interface GeminiReviewResult {
  issues: GeminiIssue[];
  summary: string;
}

export interface DiffFile {
  filename: string;
  patch?: string;
  status: string;
  additions?: number;
  deletions?: number;
}

export interface DiffChunk {
  filename: string;
  patch: string;
  chunkIndex: number;
}

export interface IDiffService {
  filterFiles(files: DiffFile[], config: SanitizedRepoConfig): DiffFile[];
  chunkFiles(files: DiffFile[]): DiffChunk[];
  // Sorts by additions+deletions descending — decisions/007 Phase 4's MAX_CHUNKS_PER_REVIEW
  // truncation reviews the largest diffs first, since they're more likely to carry real issues
  // than a one-line version bump.
  prioritizeFiles(files: DiffFile[]): DiffFile[];
}

// Fleet-wide fair queuing (decisions/007 Phase 4) — a substitute for BullMQ Pro's paid
// per-group rate limiting. Tracks each installation's currently-in-flight chunk count in Redis;
// installations with many chunks already running get a lower BullMQ `priority` (numerically
// higher = lower priority) for their next chunk jobs, so one tenant's huge PR can't starve
// everyone else's small ones. See knowledge/technical/backend/review-pipeline-scaling.md "Why
// fairness via priority score, not BullMQ Pro groups".
export interface IFairnessService {
  priorityFor(installationId: string): Promise<number>;
  markInFlight(installationId: string, delta: number): Promise<void>;
}

export interface IGeminiService {
  reviewDiff(patch: string, config: SanitizedRepoConfig, filename: string): Promise<GeminiReviewResult>;
  summarizePR(prTitle: string, issues: Array<GeminiIssue & { file: string }>): Promise<string>;
}

// Narrow slice of `@google/generative-ai`'s GenerativeModel actually used —
// GeminiService depends on this interface rather than the concrete SDK class so unit tests
// mock a plain object instead of the SDK (same pattern as IGithubApiClient).
export interface IGeminiClient {
  generateContent(request: {
    systemInstruction?: string;
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  }): Promise<{ response: { text(): string } }>;
}

export interface PostReviewInput {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  issues: Array<GeminiIssue & { file: string }>;
  summary: string;
}

export interface ICommentService {
  postReview(octokit: import("@octokit/rest").Octokit, input: PostReviewInput): Promise<number>;
}

// BullMQ job payload for the coordinator job (review-coordinator-queue) — enqueued only by
// modules/github/webhook.service.ts, for a fresh PR review. Fetches the diff, persists
// ReviewChunk rows, and fans them out via reviewFlowProducer (decisions/007 Phase 3). Retries
// never go through this queue — see ReviewChunkJobData/ReviewFinalizeJobData below.
export interface ReviewCoordinatorJobData {
  installationId: string;
  repoId: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  headSha: string;
  repoFullName: string;
}

// BullMQ job payload for one chunk (review-chunk-queue) — a child job under a finalize-review
// Flow, added either by the coordinator (fresh review) or ReviewService.retryReview (resumed
// review). repoConfig is resolved once by whichever of those two created the Flow and threaded
// through here rather than re-fetched per chunk — see resolve-review-context.ts.
export interface ReviewChunkJobData {
  reviewId: string;
  chunkId: string;
  installationId: string;
  filename: string;
  patch: string;
  repoConfig: SanitizedRepoConfig;
}

// BullMQ job payload for the finalize job (review-finalize-queue) — the Flow parent. BullMQ
// activates it automatically once every review-chunk child has settled; failParentOnFailure:
// false on each child means one chunk failing (after its own retries) doesn't block this.
export interface ReviewFinalizeJobData {
  reviewId: string;
  installationId: string;
  owner: string;
  repo: string;
  prNumber: number;
  prTitle: string;
  headSha: string;
  // Known at Flow-creation time (coordinator: just computed; retry: already on the Review row)
  // — carried through rather than re-queried so the finalize job can note it in the summary
  // without an extra DB round trip.
  truncated: boolean;
}
