import type { Repo, RepoConfig } from "@codeiq/db";

// Exact defaults from .ai/knowledge/domains/repos.md "POST /repos/:repoId/activate".
export const DEFAULT_REPO_CONFIG: SanitizedRepoConfig = {
  severityThreshold: "WARNING",
  enabledCategories: ["bug", "security", "performance", "logic"],
  ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**", "node_modules/**"],
  reviewOnDraft: false,
  postSummaryComment: true,
};

export interface SanitizedRepoConfig {
  severityThreshold: string;
  enabledCategories: string[];
  ignorePatterns: string[];
  reviewOnDraft: boolean;
  postSummaryComment: boolean;
}

export interface SanitizedRepo {
  id: string;
  fullName: string;
  language: string | null;
  isActive: boolean;
  reviewCount: number;
  config: SanitizedRepoConfig;
}

export interface ListReposFilters {
  installationId?: string;
  isActive?: boolean;
}

export interface ListReposResult {
  repos: SanitizedRepo[];
}

export interface ActivateRepoResult {
  repo: SanitizedRepo;
}

export interface GetRepoResult {
  repo: SanitizedRepo;
}

export interface GetConfigResult {
  config: SanitizedRepoConfig;
}

export interface UpdateConfigInput {
  severityThreshold?: "CRITICAL" | "WARNING" | "INFO";
  enabledCategories?: Array<"bug" | "security" | "style" | "performance" | "logic">;
  ignorePatterns?: string[];
  reviewOnDraft?: boolean;
  postSummaryComment?: boolean;
}

export interface UpdateConfigResult {
  config: SanitizedRepoConfig;
}

export interface RepoStatsResult {
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

export type RepoWithOwner = Repo & { installation: { userId: string; planTier: string } };
export type RepoWithConfigAndOwner = RepoWithOwner & { config: RepoConfig | null };

export interface IRepoRepository {
  // Scoped to repos under installations owned by userId — never a bare Repo.findMany.
  findManyForUser(
    userId: string,
    filters: ListReposFilters
  ): Promise<Array<Repo & { config: RepoConfig | null; reviewCount: number }>>;
  findByIdForUser(repoId: string): Promise<RepoWithConfigAndOwner | null>;
  setActive(repoId: string, isActive: boolean): Promise<void>;
  // FREE tier "3 repos max" limit (.ai/knowledge/domains/repos.md activate edge cases).
  countActiveForInstallation(installationId: string): Promise<number>;
  countReviews(repoId: string): Promise<number>;
  // Active repo ids for an installation, most-recently-created first — feeds
  // enforceFreeTierLimit's "keep 3 most recent" rule
  // (.ai/knowledge/domains/billing.md "customer.subscription.deleted").
  findActiveIdsForInstallationByRecency(installationId: string): Promise<string[]>;
  setActiveMany(repoIds: string[], isActive: boolean): Promise<void>;
}

export interface IRepoConfigRepository {
  findByRepoId(repoId: string): Promise<RepoConfig | null>;
  createDefault(repoId: string): Promise<RepoConfig>;
  // Upsert — creates with (defaults + patch) if no row exists yet, matching
  // "PATCH creates config row if none exists" (repos.md).
  upsertPartial(repoId: string, patch: UpdateConfigInput): Promise<RepoConfig>;
}

export interface IRepoService {
  listRepos(userId: string, filters: ListReposFilters): Promise<ListReposResult>;
  // New 2026-08-23 — .ai/knowledge/domains/repos.md "GET /repos/:repoId". Needed now that Repo
  // Detail is one tabbed page rather than a list-filter (knowledge/screens/dashboard-screens.md).
  getRepo(userId: string, repoId: string): Promise<GetRepoResult>;
  activateRepo(userId: string, repoId: string): Promise<ActivateRepoResult>;
  deactivateRepo(userId: string, repoId: string): Promise<ActivateRepoResult>;
  getConfig(userId: string, repoId: string): Promise<GetConfigResult>;
  updateConfig(
    userId: string,
    repoId: string,
    input: UpdateConfigInput
  ): Promise<UpdateConfigResult>;
  getStats(userId: string, repoId: string): Promise<RepoStatsResult>;
  // Called from BillingService on `customer.subscription.deleted` — deactivates every active
  // repo beyond the FREE tier's 3-most-recent (.ai/knowledge/domains/billing.md).
  enforceFreeTierLimit(installationId: string): Promise<void>;
}
