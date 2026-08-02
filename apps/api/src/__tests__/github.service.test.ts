import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation, User } from "@codeiq/db";
import * as cryptoLib from "../lib/crypto";
import { AppError, ConflictError, ForbiddenError, NotFoundError } from "../lib/errors";
import { redis } from "../lib/redis";
import type { IUserRepository } from "../modules/auth/auth.types";
import { GithubService } from "../modules/github/github.service";
import type {
  IGithubApiClient,
  IInstallationRepository,
  IRepoLookupRepository,
} from "../modules/github/github.types";

vi.mock("../lib/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

vi.mock("../lib/crypto", () => ({
  encrypt: vi.fn((s: string) => `encrypted(${s})`),
}));

const NOW = new Date("2026-01-01T00:00:00Z");

function buildInstallation(overrides: Partial<Record<string, unknown>> = {}): Installation {
  return {
    id: "install-1",
    githubInstallationId: 123,
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

function buildUser(overrides: Partial<Record<string, unknown>> = {}): User {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Ada Lovelace",
    passwordHash: "hash",
    status: "ACTIVE",
    githubId: null,
    githubLogin: null,
    githubAccessToken: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as User;
}

describe("GithubService", () => {
  let installationRepo: IInstallationRepository;
  let repoRepo: IRepoLookupRepository;
  let userRepo: IUserRepository;
  let githubApiClient: IGithubApiClient;
  let service: GithubService;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.setSystemTime(NOW);

    installationRepo = {
      findByGithubId: vi.fn(),
      findById: vi.fn(),
      upsert: vi.fn(),
      findManyActiveForUser: vi.fn(),
      softDelete: vi.fn(),
      updateActiveByGithubId: vi.fn(),
    };
    repoRepo = {
      findByGithubId: vi.fn(),
      deactivateByGithubId: vi.fn(),
      deactivateAllForInstallation: vi.fn(),
      countReviewsThisMonth: vi.fn(),
    };
    userRepo = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updateLastLogin: vi.fn(),
      lockEmail: vi.fn(),
      findByGithubId: vi.fn(),
      linkGithubIdentity: vi.fn(),
    };
    githubApiClient = {
      getInstallation: vi.fn(),
      exchangeOAuthCode: vi.fn(),
      getAuthenticatedUser: vi.fn(),
    };

    service = new GithubService(installationRepo, repoRepo, userRepo, githubApiClient);
  });

  describe("getOAuthUrl", () => {
    it("stores a CSRF state in Redis with a 10 minute TTL and returns the authorize URL", async () => {
      const result = await service.getOAuthUrl("user-1");

      expect(redis.set).toHaveBeenCalledWith(
        expect.stringMatching(/^oauth_state:/),
        "user-1",
        "EX",
        600
      );
      expect(result.url).toContain("https://github.com/login/oauth/authorize?");
      expect(result.url).toContain("scope=read%3Auser+user%3Aemail");
    });
  });

  describe("handleOAuthCallback", () => {
    it("throws BadRequestError when the state is not found in Redis", async () => {
      vi.mocked(redis.get).mockResolvedValue(null);

      await expect(
        service.handleOAuthCallback({ code: "abc", state: "unknown" })
      ).rejects.toThrow("Invalid or expired state");
    });

    it("deletes the Redis state entry after lookup", async () => {
      vi.mocked(redis.get).mockResolvedValue("user-1");
      vi.mocked(githubApiClient.exchangeOAuthCode).mockResolvedValue({ accessToken: "gh-token" });
      vi.mocked(githubApiClient.getAuthenticatedUser).mockResolvedValue({
        id: 999,
        login: "adalovelace",
      });
      vi.mocked(userRepo.findByGithubId).mockResolvedValue(null);

      await service.handleOAuthCallback({ code: "abc", state: "s1" });

      expect(redis.del).toHaveBeenCalledWith("oauth_state:s1");
    });

    it("throws ConflictError when the GitHub account is already linked to another user", async () => {
      vi.mocked(redis.get).mockResolvedValue("user-1");
      vi.mocked(githubApiClient.exchangeOAuthCode).mockResolvedValue({ accessToken: "gh-token" });
      vi.mocked(githubApiClient.getAuthenticatedUser).mockResolvedValue({
        id: 999,
        login: "adalovelace",
      });
      vi.mocked(userRepo.findByGithubId).mockResolvedValue(buildUser({ id: "someone-else" }));

      await expect(service.handleOAuthCallback({ code: "abc", state: "s1" })).rejects.toThrow(
        ConflictError
      );
    });

    it("links the GitHub identity with the encrypted access token and redirects to /install", async () => {
      vi.mocked(redis.get).mockResolvedValue("user-1");
      vi.mocked(githubApiClient.exchangeOAuthCode).mockResolvedValue({ accessToken: "gh-token" });
      vi.mocked(githubApiClient.getAuthenticatedUser).mockResolvedValue({
        id: 999,
        login: "adalovelace",
      });
      vi.mocked(userRepo.findByGithubId).mockResolvedValue(null);

      const result = await service.handleOAuthCallback({ code: "abc", state: "s1" });

      expect(cryptoLib.encrypt).toHaveBeenCalledWith("gh-token");
      expect(userRepo.linkGithubIdentity).toHaveBeenCalledWith("user-1", {
        githubId: "999",
        githubLogin: "adalovelace",
        githubAccessToken: "encrypted(gh-token)",
      });
      expect(result.redirectUrl).toBe("http://localhost:3000/install");
    });

    it("allows re-linking when the GitHub account is already linked to the same user", async () => {
      vi.mocked(redis.get).mockResolvedValue("user-1");
      vi.mocked(githubApiClient.exchangeOAuthCode).mockResolvedValue({ accessToken: "gh-token" });
      vi.mocked(githubApiClient.getAuthenticatedUser).mockResolvedValue({
        id: 999,
        login: "adalovelace",
      });
      vi.mocked(userRepo.findByGithubId).mockResolvedValue(buildUser({ id: "user-1" }));

      await expect(
        service.handleOAuthCallback({ code: "abc", state: "s1" })
      ).resolves.toBeDefined();
    });
  });

  describe("saveInstallation", () => {
    it("creates the installation on first install", async () => {
      vi.mocked(githubApiClient.getInstallation).mockResolvedValue({
        accountLogin: "acme",
        accountType: "Organization",
      });
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(null);
      vi.mocked(installationRepo.upsert).mockResolvedValue(buildInstallation());

      const result = await service.saveInstallation("user-1", { installationId: 123 });

      expect(installationRepo.upsert).toHaveBeenCalledWith({
        githubInstallationId: 123,
        accountLogin: "acme",
        accountType: "Organization",
        userId: "user-1",
      });
      expect(result.installation.id).toBe("install-1");
      expect(result.installation.repoCount).toBe(0);
    });

    it("upserts (stays idempotent) on a second install by the same user", async () => {
      vi.mocked(githubApiClient.getInstallation).mockResolvedValue({
        accountLogin: "acme",
        accountType: "Organization",
      });
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(
        buildInstallation({ userId: "user-1" })
      );
      vi.mocked(installationRepo.upsert).mockResolvedValue(buildInstallation());

      await expect(
        service.saveInstallation("user-1", { installationId: 123 })
      ).resolves.toBeDefined();
    });

    it("throws ConflictError when the installation belongs to a different user", async () => {
      vi.mocked(githubApiClient.getInstallation).mockResolvedValue({
        accountLogin: "acme",
        accountType: "Organization",
      });
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(
        buildInstallation({ userId: "someone-else" })
      );

      await expect(
        service.saveInstallation("user-1", { installationId: 123 })
      ).rejects.toThrow(ConflictError);
    });

    it("propagates NotFoundError when GitHub returns 404 for the installation", async () => {
      vi.mocked(githubApiClient.getInstallation).mockRejectedValue(
        new NotFoundError("Installation not found on GitHub")
      );

      await expect(
        service.saveInstallation("user-1", { installationId: 123 })
      ).rejects.toThrow(NotFoundError);
    });

    it("propagates a 502 AppError when the GitHub API is unreachable", async () => {
      vi.mocked(githubApiClient.getInstallation).mockRejectedValue(
        new AppError("GitHub API unavailable", 502)
      );

      await expect(
        service.saveInstallation("user-1", { installationId: 123 })
      ).rejects.toMatchObject({ statusCode: 502 });
    });

    it("links the installation to the correct userId", async () => {
      vi.mocked(githubApiClient.getInstallation).mockResolvedValue({
        accountLogin: "acme",
        accountType: "User",
      });
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(null);
      vi.mocked(installationRepo.upsert).mockResolvedValue(buildInstallation());

      await service.saveInstallation("user-1", { installationId: 123 });

      expect(installationRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1" })
      );
    });
  });

  describe("listInstallations", () => {
    it("returns installations mapped with repo count", async () => {
      vi.mocked(installationRepo.findManyActiveForUser).mockResolvedValue([
        { ...buildInstallation(), repoCount: 3 },
      ]);

      const result = await service.listInstallations("user-1");

      expect(result.installations).toEqual([
        {
          id: "install-1",
          githubInstallationId: 123,
          accountLogin: "acme",
          accountType: "Organization",
          planTier: "FREE",
          repoCount: 3,
        },
      ]);
    });

    it("returns an empty array when the user has no installations", async () => {
      vi.mocked(installationRepo.findManyActiveForUser).mockResolvedValue([]);

      const result = await service.listInstallations("user-1");

      expect(result.installations).toEqual([]);
    });
  });

  describe("deleteInstallation", () => {
    it("soft-deletes the installation and deactivates its repos", async () => {
      vi.mocked(installationRepo.findById).mockResolvedValue(buildInstallation());

      await service.deleteInstallation("user-1", "install-1");

      expect(installationRepo.softDelete).toHaveBeenCalledWith("install-1");
      expect(repoRepo.deactivateAllForInstallation).toHaveBeenCalledWith("install-1");
    });

    it("throws NotFoundError for an unknown installationId", async () => {
      vi.mocked(installationRepo.findById).mockResolvedValue(null);

      await expect(service.deleteInstallation("user-1", "missing")).rejects.toThrow(
        NotFoundError
      );
    });

    it("throws ForbiddenError when the installation belongs to another user", async () => {
      vi.mocked(installationRepo.findById).mockResolvedValue(
        buildInstallation({ userId: "someone-else" })
      );

      await expect(service.deleteInstallation("user-1", "install-1")).rejects.toThrow(
        ForbiddenError
      );
    });

    it("stays idempotent when the installation is already inactive", async () => {
      vi.mocked(installationRepo.findById).mockResolvedValue(
        buildInstallation({ isActive: false })
      );

      await expect(service.deleteInstallation("user-1", "install-1")).resolves.toBeUndefined();
    });
  });
});
