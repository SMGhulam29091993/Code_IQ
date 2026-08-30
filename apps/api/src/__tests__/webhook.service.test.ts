import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation } from "@codeiq/db";
import { reviewCoordinatorQueue } from "../jobs/queue";
import type {
  IInstallationRepository,
  IRepoLookupRepository,
  RepoWithConfig,
} from "../modules/github/github.types";
import { WebhookService } from "../modules/github/webhook.service";

vi.mock("../jobs/queue", () => ({
  reviewCoordinatorQueue: { add: vi.fn() },
}));

const NOW = new Date("2026-01-01T00:00:00Z");

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

function buildRepo(overrides: Partial<Record<string, unknown>> = {}): RepoWithConfig {
  return {
    id: "repo-1",
    githubRepoId: 222,
    fullName: "acme/widgets",
    language: "TypeScript",
    installationId: "install-1",
    isActive: true,
    config: { reviewOnDraft: false },
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as unknown as RepoWithConfig;
}

function buildPullRequestBody(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    action: "opened",
    installation: { id: 111 },
    repository: { id: 222, full_name: "acme/widgets" },
    pull_request: {
      number: 42,
      title: "Add feature",
      draft: false,
      user: { login: "octocat" },
      head: { sha: "abc123" },
    },
    ...overrides,
  };
}

describe("WebhookService", () => {
  let installationRepo: IInstallationRepository;
  let repoRepo: IRepoLookupRepository;
  let service: WebhookService;

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
      upsertFromGithub: vi.fn(),
    };

    service = new WebhookService(installationRepo, repoRepo);
  });

  describe("pull_request", () => {
    it("enqueues a review job for action=opened", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo());
      vi.mocked(repoRepo.countReviewsThisMonth).mockResolvedValue(0);

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "delivery-1",
        body: buildPullRequestBody({ action: "opened" }),
      });

      expect(message).toBe("OK");
      expect(reviewCoordinatorQueue.add).toHaveBeenCalledWith(
        "review-pr",
        expect.objectContaining({
          installationId: "install-1",
          repoId: "repo-1",
          prNumber: 42,
          prTitle: "Add feature",
          prAuthor: "octocat",
          headSha: "abc123",
          repoFullName: "acme/widgets",
        }),
        { jobId: "delivery-1" }
      );
    });

    it("enqueues for synchronize and reopened too", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo());
      vi.mocked(repoRepo.countReviewsThisMonth).mockResolvedValue(0);

      for (const action of ["synchronize", "reopened"]) {
        await service.handle({
          event: "pull_request",
          deliveryId: "d",
          body: buildPullRequestBody({ action }),
        });
      }

      expect(reviewCoordinatorQueue.add).toHaveBeenCalledTimes(2);
    });

    it("uses X-GitHub-Delivery as the BullMQ job idempotency key", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo());
      vi.mocked(repoRepo.countReviewsThisMonth).mockResolvedValue(0);

      await service.handle({
        event: "pull_request",
        deliveryId: "delivery-xyz",
        body: buildPullRequestBody(),
      });

      expect(reviewCoordinatorQueue.add).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        { jobId: "delivery-xyz" }
      );
    });

    it("does not enqueue for action=closed (ignored)", async () => {
      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody({ action: "closed" }),
      });

      expect(message).toBe("Action ignored");
      expect(reviewCoordinatorQueue.add).not.toHaveBeenCalled();
    });

    it("does not enqueue when the installation is inactive", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(
        buildInstallation({ isActive: false })
      );

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody(),
      });

      expect(message).toBe("Installation not active");
      expect(reviewCoordinatorQueue.add).not.toHaveBeenCalled();
    });

    it("does not enqueue when the repo is inactive", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo({ isActive: false }));

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody(),
      });

      expect(message).toBe("Repo not active");
      expect(reviewCoordinatorQueue.add).not.toHaveBeenCalled();
    });

    it("does not enqueue when the repo is unknown (never synced)", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(null);

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody(),
      });

      expect(message).toBe("Repo not active");
    });

    it("skips draft PRs when reviewOnDraft is false", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(
        buildRepo({ config: { reviewOnDraft: false } })
      );

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody({ pull_request: { ...buildPullRequestBody().pull_request, draft: true } }),
      });

      expect(message).toBe("Draft PR skipped");
      expect(reviewCoordinatorQueue.add).not.toHaveBeenCalled();
    });

    it("reviews draft PRs when reviewOnDraft is true", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(
        buildRepo({ config: { reviewOnDraft: true } })
      );
      vi.mocked(repoRepo.countReviewsThisMonth).mockResolvedValue(0);

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody({ pull_request: { ...buildPullRequestBody().pull_request, draft: true } }),
      });

      expect(message).toBe("OK");
      expect(reviewCoordinatorQueue.add).toHaveBeenCalled();
    });

    it("treats a missing RepoConfig row as reviewOnDraft=false", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo({ config: null }));

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody({ pull_request: { ...buildPullRequestBody().pull_request, draft: true } }),
      });

      expect(message).toBe("Draft PR skipped");
    });

    it("does not enqueue when the FREE tier installation is over its monthly review limit", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(
        buildInstallation({ planTier: "FREE" })
      );
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo());
      vi.mocked(repoRepo.countReviewsThisMonth).mockResolvedValue(50);

      const message = await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody(),
      });

      expect(message).toBe("Plan limit reached");
      expect(reviewCoordinatorQueue.add).not.toHaveBeenCalled();
    });

    it("never checks plan limits for non-FREE tiers", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(
        buildInstallation({ planTier: "PRO" })
      );
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo());

      await service.handle({
        event: "pull_request",
        deliveryId: "d",
        body: buildPullRequestBody(),
      });

      expect(repoRepo.countReviewsThisMonth).not.toHaveBeenCalled();
      expect(reviewCoordinatorQueue.add).toHaveBeenCalled();
    });

    it("throws a 503 AppError when the queue is unreachable", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());
      vi.mocked(repoRepo.findByGithubId).mockResolvedValue(buildRepo());
      vi.mocked(repoRepo.countReviewsThisMonth).mockResolvedValue(0);
      vi.mocked(reviewCoordinatorQueue.add).mockRejectedValue(new Error("ECONNREFUSED"));

      await expect(
        service.handle({ event: "pull_request", deliveryId: "d", body: buildPullRequestBody() })
      ).rejects.toMatchObject({ statusCode: 503 });
    });
  });

  describe("installation.deleted", () => {
    it("marks the installation inactive", async () => {
      const message = await service.handle({
        event: "installation",
        deliveryId: "d",
        body: { action: "deleted", installation: { id: 111 } },
      });

      expect(installationRepo.updateActiveByGithubId).toHaveBeenCalledWith(111, false);
      expect(message).toBe("Installation deactivated");
    });
  });

  describe("installation_repositories.removed", () => {
    it("deactivates all removed repos", async () => {
      const message = await service.handle({
        event: "installation_repositories",
        deliveryId: "d",
        body: {
          action: "removed",
          repositories_removed: [{ id: 1 }, { id: 2 }],
        },
      });

      expect(repoRepo.deactivateByGithubId).toHaveBeenCalledWith(1);
      expect(repoRepo.deactivateByGithubId).toHaveBeenCalledWith(2);
      expect(message).toBe("Repos deactivated");
    });
  });

  describe("installation_repositories.added", () => {
    it("creates Repo rows for added repos when the installation is known", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(buildInstallation());

      const message = await service.handle({
        event: "installation_repositories",
        deliveryId: "d",
        body: {
          action: "added",
          installation: { id: 111 },
          repositories_added: [
            { id: 1, full_name: "acme/one" },
            { id: 2, full_name: "acme/two" },
          ],
        },
      });

      expect(repoRepo.upsertFromGithub).toHaveBeenCalledWith({
        githubRepoId: 1,
        fullName: "acme/one",
        language: null,
        installationId: "install-1",
      });
      expect(repoRepo.upsertFromGithub).toHaveBeenCalledWith({
        githubRepoId: 2,
        fullName: "acme/two",
        language: null,
        installationId: "install-1",
      });
      expect(message).toBe("Repos synced");
    });

    it("no-ops when the installation is unknown", async () => {
      vi.mocked(installationRepo.findByGithubId).mockResolvedValue(null);

      const message = await service.handle({
        event: "installation_repositories",
        deliveryId: "d",
        body: {
          action: "added",
          installation: { id: 999 },
          repositories_added: [{ id: 1, full_name: "acme/one" }],
        },
      });

      expect(repoRepo.upsertFromGithub).not.toHaveBeenCalled();
      expect(message).toBe("Installation unknown");
    });
  });

  describe("unhandled events", () => {
    it("gracefully ignores unknown event types", async () => {
      const message = await service.handle({
        event: "star",
        deliveryId: "d",
        body: { action: "created" },
      });

      expect(message).toBe("Event ignored");
    });
  });
});
