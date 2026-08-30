import type { RepoConfig } from "@codeiq/db";
import { DEFAULT_REPO_CONFIG } from "./repo.types";
import type {
  ActivateRepoResult,
  GetConfigResult,
  GetRepoResult,
  IRepoConfigRepository,
  IRepoRepository,
  IRepoService,
  ListReposFilters,
  ListReposResult,
  RepoStatsResult,
  RepoWithConfigAndOwner,
  SanitizedRepo,
  SanitizedRepoConfig,
  UpdateConfigInput,
  UpdateConfigResult,
} from "./repo.types";
import { ForbiddenError, NotFoundError } from "../../lib/errors";
import type { IInstallationRepository } from "../github/github.types";
import type { IReviewRepository } from "../reviews/review.types";

// FREE tier "3 repos max" limit — .ai/knowledge/domains/repos.md
// "POST /repos/:repoId/activate" edge cases.
const FREE_TIER_ACTIVE_REPO_LIMIT = 3;

// Trend window for GET /repos/:repoId/stats's recentTrend — .ai/knowledge/domains/repos.md
// "GET /repos/:repoId/stats" (fixed 30 days; totalReviews/totalIssues/breakdowns are all-time).
const STATS_TREND_DAYS = 30;

export class RepoService implements IRepoService {
  constructor(
    private readonly repoRepo: IRepoRepository,
    private readonly repoConfigRepo: IRepoConfigRepository,
    private readonly installationRepo: IInstallationRepository,
    private readonly reviewRepo: IReviewRepository
  ) {}

  async listRepos(userId: string, filters: ListReposFilters): Promise<ListReposResult> {
    if (filters.installationId) {
      const installation = await this.installationRepo.findById(filters.installationId);
      if (!installation) {
        throw new NotFoundError("Installation not found");
      }
      if (installation.userId !== userId) {
        throw new ForbiddenError("Forbidden");
      }
    }

    const rows = await this.repoRepo.findManyForUser(userId, filters);
    return { repos: rows.map((row) => sanitizeRepo(row, row.reviewCount)) };
  }

  async getRepo(userId: string, repoId: string): Promise<GetRepoResult> {
    const repo = await this.findOwnedRepo(userId, repoId);
    const reviewCount = await this.repoRepo.countReviews(repoId);
    return { repo: sanitizeRepo(repo, reviewCount) };
  }

  async activateRepo(userId: string, repoId: string): Promise<ActivateRepoResult> {
    const repo = await this.findOwnedRepo(userId, repoId);

    if (!repo.isActive) {
      if (repo.installation.planTier === "FREE") {
        const activeCount = await this.repoRepo.countActiveForInstallation(repo.installationId);
        if (activeCount >= FREE_TIER_ACTIVE_REPO_LIMIT) {
          throw new ForbiddenError("Plan limit: upgrade to activate more repos");
        }
      }
      await this.repoRepo.setActive(repoId, true);
    }
    if (!repo.config) {
      await this.repoConfigRepo.createDefault(repoId);
    }

    return { repo: await this.rebuildSanitizedRepo(repoId) };
  }

  async deactivateRepo(userId: string, repoId: string): Promise<ActivateRepoResult> {
    const repo = await this.findOwnedRepo(userId, repoId);

    if (repo.isActive) {
      await this.repoRepo.setActive(repoId, false);
    }

    return { repo: await this.rebuildSanitizedRepo(repoId) };
  }

  async getConfig(userId: string, repoId: string): Promise<GetConfigResult> {
    const repo = await this.findOwnedRepo(userId, repoId);
    return { config: repo.config ? sanitizeConfig(repo.config) : DEFAULT_REPO_CONFIG };
  }

  async updateConfig(
    userId: string,
    repoId: string,
    input: UpdateConfigInput
  ): Promise<UpdateConfigResult> {
    await this.findOwnedRepo(userId, repoId);

    const updated = await this.repoConfigRepo.upsertPartial(repoId, input);
    return { config: sanitizeConfig(updated) };
  }

  async getStats(userId: string, repoId: string): Promise<RepoStatsResult> {
    await this.findOwnedRepo(userId, repoId);

    const trendSince = new Date(Date.now() - STATS_TREND_DAYS * 24 * 60 * 60 * 1000);
    const [totalReviews, bySeverity, byCategory, recentTrend] = await Promise.all([
      this.reviewRepo.countForUser(userId, { repoId }),
      this.reviewRepo.countIssuesBySeverityForUser(userId, { repoId }),
      this.reviewRepo.countIssuesByCategoryForUser(userId, { repoId }),
      this.reviewRepo.countIssuesByDayForUser(userId, { repoId, since: trendSince }),
    ]);
    const totalIssues = Object.values(bySeverity).reduce((sum, n) => sum + n, 0);

    return {
      totalReviews,
      totalIssues,
      issuesBySeverity: {
        critical: bySeverity.critical ?? 0,
        warning: bySeverity.warning ?? 0,
        info: bySeverity.info ?? 0,
      },
      issuesByCategory: {
        bug: byCategory.bug ?? 0,
        security: byCategory.security ?? 0,
        style: byCategory.style ?? 0,
        performance: byCategory.performance ?? 0,
        logic: byCategory.logic ?? 0,
      },
      recentTrend,
    };
  }

  async enforceFreeTierLimit(installationId: string): Promise<void> {
    const activeIds = await this.repoRepo.findActiveIdsForInstallationByRecency(installationId);
    const excess = activeIds.slice(FREE_TIER_ACTIVE_REPO_LIMIT);
    await this.repoRepo.setActiveMany(excess, false);
  }

  private async findOwnedRepo(userId: string, repoId: string): Promise<RepoWithConfigAndOwner> {
    const repo = await this.repoRepo.findByIdForUser(repoId);
    if (!repo) {
      throw new NotFoundError("Repo not found");
    }
    if (repo.installation.userId !== userId) {
      throw new ForbiddenError("Forbidden");
    }
    return repo;
  }

  private async rebuildSanitizedRepo(repoId: string): Promise<SanitizedRepo> {
    // Re-read after mutation rather than patching the in-memory object, so the response
    // always reflects what's actually in the DB.
    const repo = await this.repoRepo.findByIdForUser(repoId);
    if (!repo) {
      throw new NotFoundError("Repo not found");
    }
    const reviewCount = await this.repoRepo.countReviews(repoId);
    return sanitizeRepo(repo, reviewCount);
  }
}

function sanitizeConfig(config: RepoConfig): SanitizedRepoConfig {
  return {
    severityThreshold: config.severityThreshold,
    enabledCategories: config.enabledCategories,
    ignorePatterns: config.ignorePatterns,
    reviewOnDraft: config.reviewOnDraft,
    postSummaryComment: config.postSummaryComment,
  };
}

function sanitizeRepo(
  repo: {
    id: string;
    fullName: string;
    language: string | null;
    isActive: boolean;
    config: RepoConfig | null;
    lastReviewAt: Date | null;
  },
  reviewCount: number
): SanitizedRepo {
  return {
    id: repo.id,
    fullName: repo.fullName,
    language: repo.language,
    isActive: repo.isActive,
    reviewCount,
    lastReviewAt: repo.lastReviewAt,
    config: repo.config ? sanitizeConfig(repo.config) : DEFAULT_REPO_CONFIG,
  };
}
