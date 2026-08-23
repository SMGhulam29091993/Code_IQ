import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation, Repo, RepoConfig } from "@codeiq/db";
import { ForbiddenError, NotFoundError } from "../lib/errors";
import type { IInstallationRepository } from "../modules/github/github.types";
import { RepoService } from "../modules/repos/repo.service";
import type { IRepoConfigRepository, IRepoRepository, RepoWithConfigAndOwner } from "../modules/repos/repo.types";
import type { IReviewRepository } from "../modules/reviews/review.types";

const NOW = new Date("2026-01-01T00:00:00Z");

function buildConfig(overrides: Partial<RepoConfig> = {}): RepoConfig {
  return {
    id: "config-1",
    repoId: "repo-1",
    severityThreshold: "WARNING",
    enabledCategories: ["bug", "security", "performance", "logic"],
    ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**"],
    reviewOnDraft: false,
    postSummaryComment: true,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildRepo(overrides: Partial<Record<string, unknown>> = {}): RepoWithConfigAndOwner {
  return {
    id: "repo-1",
    githubRepoId: 222,
    fullName: "acme/widgets",
    language: "TypeScript",
    installationId: "install-1",
    isActive: false,
    createdAt: NOW,
    updatedAt: NOW,
    config: null,
    installation: { userId: "user-1", planTier: "FREE" },
    ...overrides,
  } as unknown as RepoWithConfigAndOwner;
}

function buildInstallation(overrides: Partial<Record<string, unknown>> = {}): Installation {
  return {
    id: "install-1",
    githubInstallationId: 111,
    accountLogin: "acme",
    accountType: "Organization",
    userId: "user-1",
    stripeCustomerId: null,
    stripeSubId: null,
    planTier: "FREE",
    seatCount: 0,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as Installation;
}

describe("RepoService", () => {
  let repoRepo: IRepoRepository;
  let repoConfigRepo: IRepoConfigRepository;
  let installationRepo: IInstallationRepository;
  let reviewRepo: IReviewRepository;
  let service: RepoService;

  beforeEach(() => {
    vi.clearAllMocks();

    repoRepo = {
      findManyForUser: vi.fn(),
      findByIdForUser: vi.fn(),
      setActive: vi.fn(),
      countActiveForInstallation: vi.fn(),
      countReviews: vi.fn(),
      findActiveIdsForInstallationByRecency: vi.fn(),
      setActiveMany: vi.fn(),
    };
    repoConfigRepo = {
      findByRepoId: vi.fn(),
      createDefault: vi.fn(),
      upsertPartial: vi.fn(),
    };
    installationRepo = {
      findByGithubId: vi.fn(),
      findById: vi.fn(),
      upsert: vi.fn(),
      findManyActiveForUser: vi.fn(),
      softDelete: vi.fn(),
      updateActiveByGithubId: vi.fn(),
    };
    reviewRepo = {
      findManyForUser: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      countForUser: vi.fn().mockResolvedValue(0),
      countIssuesBySeverityForUser: vi.fn().mockResolvedValue({}),
      countIssuesByCategoryForUser: vi.fn().mockResolvedValue({}),
      countIssuesByDayForUser: vi.fn().mockResolvedValue([]),
      countReviewsByAuthorForInstallation: vi.fn().mockResolvedValue({}),
    };

    service = new RepoService(repoRepo, repoConfigRepo, installationRepo, reviewRepo);
  });

  describe("listRepos", () => {
    it("returns repos for all of the current user's installations", async () => {
      vi.mocked(repoRepo.findManyForUser).mockResolvedValue([
        { ...buildRepo(), reviewCount: 3, lastReviewAt: NOW } as unknown as Repo & {
          config: RepoConfig | null;
          reviewCount: number;
          lastReviewAt: Date | null;
        },
      ]);

      const result = await service.listRepos("user-1", {});

      expect(result.repos).toHaveLength(1);
      expect(result.repos[0]!.reviewCount).toBe(3);
      expect(result.repos[0]!.lastReviewAt).toEqual(NOW);
      expect(result.repos[0]!.config).toEqual({
        severityThreshold: "WARNING",
        enabledCategories: ["bug", "security", "performance", "logic"],
        ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**", "node_modules/**"],
        reviewOnDraft: false,
        postSummaryComment: true,
      });
    });

    it("throws NotFoundError when installationId filter does not exist", async () => {
      vi.mocked(installationRepo.findById).mockResolvedValue(null);

      await expect(
        service.listRepos("user-1", { installationId: "missing" })
      ).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError when installationId filter belongs to another user", async () => {
      vi.mocked(installationRepo.findById).mockResolvedValue(
        buildInstallation({ userId: "someone-else" })
      );

      await expect(
        service.listRepos("user-1", { installationId: "install-1" })
      ).rejects.toThrow(ForbiddenError);
    });

    it("returns an empty array when the user has no repos", async () => {
      vi.mocked(repoRepo.findManyForUser).mockResolvedValue([]);

      const result = await service.listRepos("user-1", {});

      expect(result.repos).toEqual([]);
    });
  });

  describe("getRepo", () => {
    it("returns the repo for an authorized user", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildRepo());
      vi.mocked(repoRepo.countReviews).mockResolvedValue(5);

      const result = await service.getRepo("user-1", "repo-1");

      expect(result.repo.id).toBe("repo-1");
      expect(result.repo.reviewCount).toBe(5);
    });

    it("throws NotFoundError for unknown repoId", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(null);

      await expect(service.getRepo("user-1", "missing")).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError when repo belongs to another user", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      await expect(service.getRepo("user-1", "repo-1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("activateRepo", () => {
    it("sets isActive = true and creates a default RepoConfig", async () => {
      vi.mocked(repoRepo.findByIdForUser)
        .mockResolvedValueOnce(buildRepo({ isActive: false, config: null }))
        .mockResolvedValueOnce(buildRepo({ isActive: true, config: buildConfig() }));
      vi.mocked(repoRepo.countActiveForInstallation).mockResolvedValue(0);
      vi.mocked(repoRepo.countReviews).mockResolvedValue(0);

      const result = await service.activateRepo("user-1", "repo-1");

      expect(repoRepo.setActive).toHaveBeenCalledWith("repo-1", true);
      expect(repoConfigRepo.createDefault).toHaveBeenCalledWith("repo-1");
      expect(result.repo.isActive).toBe(true);
    });

    it("does not overwrite an existing RepoConfig on re-activation", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ isActive: false, config: buildConfig() })
      );
      vi.mocked(repoRepo.countActiveForInstallation).mockResolvedValue(0);
      vi.mocked(repoRepo.countReviews).mockResolvedValue(0);

      await service.activateRepo("user-1", "repo-1");

      expect(repoConfigRepo.createDefault).not.toHaveBeenCalled();
    });

    it("is idempotent when already active (skips the plan-limit check)", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ isActive: true, config: buildConfig() })
      );
      vi.mocked(repoRepo.countReviews).mockResolvedValue(0);

      await service.activateRepo("user-1", "repo-1");

      expect(repoRepo.setActive).not.toHaveBeenCalled();
      expect(repoRepo.countActiveForInstallation).not.toHaveBeenCalled();
    });

    it("throws NotFoundError for an unknown repoId", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(null);

      await expect(service.activateRepo("user-1", "missing")).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError when the repo belongs to another user", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      await expect(service.activateRepo("user-1", "repo-1")).rejects.toThrow(ForbiddenError);
    });

    it("throws ForbiddenError with the plan-limit message when the FREE tier's 3-repo limit is reached", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ isActive: false, config: null })
      );
      vi.mocked(repoRepo.countActiveForInstallation).mockResolvedValue(3);

      await expect(service.activateRepo("user-1", "repo-1")).rejects.toThrow(
        "Plan limit: upgrade to activate more repos"
      );
      expect(repoRepo.setActive).not.toHaveBeenCalled();
    });

    it("does not enforce the plan limit for non-FREE tiers", async () => {
      vi.mocked(repoRepo.findByIdForUser)
        .mockResolvedValueOnce(
          buildRepo({ isActive: false, config: null, installation: { userId: "user-1", planTier: "PRO" } })
        )
        .mockResolvedValueOnce(buildRepo({ isActive: true, config: buildConfig() }));
      vi.mocked(repoRepo.countReviews).mockResolvedValue(0);

      await service.activateRepo("user-1", "repo-1");

      expect(repoRepo.countActiveForInstallation).not.toHaveBeenCalled();
      expect(repoRepo.setActive).toHaveBeenCalledWith("repo-1", true);
    });
  });

  describe("deactivateRepo", () => {
    it("sets isActive = false", async () => {
      vi.mocked(repoRepo.findByIdForUser)
        .mockResolvedValueOnce(buildRepo({ isActive: true }))
        .mockResolvedValueOnce(buildRepo({ isActive: false }));
      vi.mocked(repoRepo.countReviews).mockResolvedValue(0);

      const result = await service.deactivateRepo("user-1", "repo-1");

      expect(repoRepo.setActive).toHaveBeenCalledWith("repo-1", false);
      expect(result.repo.isActive).toBe(false);
    });

    it("is idempotent when already inactive", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildRepo({ isActive: false }));
      vi.mocked(repoRepo.countReviews).mockResolvedValue(0);

      await service.deactivateRepo("user-1", "repo-1");

      expect(repoRepo.setActive).not.toHaveBeenCalled();
    });

    it("does not delete the RepoConfig", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ isActive: true, config: buildConfig() })
      );
      vi.mocked(repoRepo.countReviews).mockResolvedValue(0);

      await service.deactivateRepo("user-1", "repo-1");

      expect(repoConfigRepo.createDefault).not.toHaveBeenCalled();
    });
  });

  describe("getConfig", () => {
    it("returns the RepoConfig for the repo", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ config: buildConfig({ severityThreshold: "CRITICAL" }) })
      );

      const result = await service.getConfig("user-1", "repo-1");

      expect(result.config.severityThreshold).toBe("CRITICAL");
    });

    it("returns default config values when no RepoConfig row exists", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildRepo({ config: null }));

      const result = await service.getConfig("user-1", "repo-1");

      expect(result.config).toEqual({
        severityThreshold: "WARNING",
        enabledCategories: ["bug", "security", "performance", "logic"],
        ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**", "node_modules/**"],
        reviewOnDraft: false,
        postSummaryComment: true,
      });
    });

    it("throws ForbiddenError when the repo belongs to another user", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      await expect(service.getConfig("user-1", "repo-1")).rejects.toThrow(ForbiddenError);
    });
  });

  describe("updateConfig", () => {
    it("partially updates only provided fields", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildRepo());
      vi.mocked(repoConfigRepo.upsertPartial).mockResolvedValue(
        buildConfig({ severityThreshold: "CRITICAL" })
      );

      const result = await service.updateConfig("user-1", "repo-1", {
        severityThreshold: "CRITICAL",
      });

      expect(repoConfigRepo.upsertPartial).toHaveBeenCalledWith("repo-1", {
        severityThreshold: "CRITICAL",
      });
      expect(result.config.severityThreshold).toBe("CRITICAL");
    });

    it("returns a no-op 200 for an empty body", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildRepo());
      vi.mocked(repoConfigRepo.upsertPartial).mockResolvedValue(buildConfig());

      await expect(service.updateConfig("user-1", "repo-1", {})).resolves.toBeDefined();
    });

    it("throws ForbiddenError when the repo belongs to another user", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      await expect(service.updateConfig("user-1", "repo-1", {})).rejects.toThrow(ForbiddenError);
    });

    it("throws NotFoundError for an unknown repoId", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(null);

      await expect(service.updateConfig("user-1", "missing", {})).rejects.toThrow(NotFoundError);
    });
  });

  describe("getStats", () => {
    it("throws NotFoundError for an unknown repoId", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(null);

      await expect(service.getStats("user-1", "missing")).rejects.toThrow(NotFoundError);
    });

    it("throws ForbiddenError when the repo belongs to another user", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(
        buildRepo({ installation: { userId: "someone-else", planTier: "FREE" } })
      );

      await expect(service.getStats("user-1", "repo-1")).rejects.toThrow(ForbiddenError);
    });

    it("returns zeroed stats when the repo has no reviews yet", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildRepo());

      const result = await service.getStats("user-1", "repo-1");

      expect(result.totalReviews).toBe(0);
      expect(result.issuesBySeverity).toEqual({ critical: 0, warning: 0, info: 0 });
      expect(result.issuesByCategory).toEqual({
        bug: 0,
        security: 0,
        style: 0,
        performance: 0,
        logic: 0,
      });
      expect(result.recentTrend).toEqual([]);
    });

    it("aggregates real Review/ReviewIssue data scoped to the repo", async () => {
      vi.mocked(repoRepo.findByIdForUser).mockResolvedValue(buildRepo());
      vi.mocked(reviewRepo.countForUser).mockResolvedValue(5);
      vi.mocked(reviewRepo.countIssuesBySeverityForUser).mockResolvedValue({
        critical: 2,
        warning: 3,
      });
      vi.mocked(reviewRepo.countIssuesByCategoryForUser).mockResolvedValue({ bug: 4, security: 1 });
      vi.mocked(reviewRepo.countIssuesByDayForUser).mockResolvedValue([
        { date: "2026-01-01", count: 2 },
      ]);

      const result = await service.getStats("user-1", "repo-1");

      expect(reviewRepo.countForUser).toHaveBeenCalledWith("user-1", { repoId: "repo-1" });
      expect(result.totalReviews).toBe(5);
      expect(result.totalIssues).toBe(5);
      expect(result.issuesBySeverity).toEqual({ critical: 2, warning: 3, info: 0 });
      expect(result.issuesByCategory).toEqual({
        bug: 4,
        security: 1,
        style: 0,
        performance: 0,
        logic: 0,
      });
      expect(result.recentTrend).toEqual([{ date: "2026-01-01", count: 2 }]);
    });
  });

  describe("enforceFreeTierLimit", () => {
    it("deactivates active repos beyond the 3 most recent", async () => {
      vi.mocked(repoRepo.findActiveIdsForInstallationByRecency).mockResolvedValue([
        "repo-1",
        "repo-2",
        "repo-3",
        "repo-4",
        "repo-5",
      ]);

      await service.enforceFreeTierLimit("install-1");

      expect(repoRepo.findActiveIdsForInstallationByRecency).toHaveBeenCalledWith("install-1");
      expect(repoRepo.setActiveMany).toHaveBeenCalledWith(["repo-4", "repo-5"], false);
    });

    it("does nothing when active repo count is within the limit", async () => {
      vi.mocked(repoRepo.findActiveIdsForInstallationByRecency).mockResolvedValue([
        "repo-1",
        "repo-2",
      ]);

      await service.enforceFreeTierLimit("install-1");

      expect(repoRepo.setActiveMany).toHaveBeenCalledWith([], false);
    });
  });
});
