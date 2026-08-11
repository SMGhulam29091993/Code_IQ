import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoConfig } from "@codeiq/db";
import { ConfigService } from "../modules/repos/config.service";
import type { IRepoConfigRepository } from "../modules/repos/repo.types";

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

function base64Yaml(yaml: string) {
  return Buffer.from(yaml, "utf-8").toString("base64");
}

function buildOctokit(getContentImpl: () => Promise<unknown>) {
  return { rest: { repos: { getContent: getContentImpl } } } as unknown as import("@octokit/rest").Octokit;
}

describe("ConfigService", () => {
  let repoConfigRepo: IRepoConfigRepository;
  let service: ConfigService;

  beforeEach(() => {
    vi.clearAllMocks();
    repoConfigRepo = {
      findByRepoId: vi.fn(),
      createDefault: vi.fn(),
      upsertPartial: vi.fn(),
    };
    service = new ConfigService(repoConfigRepo);
  });

  it("returns DB config when no .codeiq.yml exists (404)", async () => {
    vi.mocked(repoConfigRepo.findByRepoId).mockResolvedValue(
      buildConfig({ severityThreshold: "CRITICAL" })
    );
    const octokit = buildOctokit(() => Promise.reject({ status: 404 }));

    const result = await service.getEffectiveConfig("repo-1", octokit, "acme", "widgets");

    expect(result.severityThreshold).toBe("CRITICAL");
  });

  it("returns default config when no DB config and no .codeiq.yml", async () => {
    vi.mocked(repoConfigRepo.findByRepoId).mockResolvedValue(null);
    const octokit = buildOctokit(() => Promise.reject({ status: 404 }));

    const result = await service.getEffectiveConfig("repo-1", octokit, "acme", "widgets");

    expect(result.ignorePatterns).toEqual(["*.test.ts", "*.spec.ts", "dist/**", "node_modules/**"]);
  });

  it("merges .codeiq.yml over DB config when the file exists", async () => {
    vi.mocked(repoConfigRepo.findByRepoId).mockResolvedValue(
      buildConfig({ severityThreshold: "WARNING", reviewOnDraft: false })
    );
    const octokit = buildOctokit(() =>
      Promise.resolve({
        data: { content: base64Yaml("severityThreshold: CRITICAL\nreviewOnDraft: true\n") },
      })
    );

    const result = await service.getEffectiveConfig("repo-1", octokit, "acme", "widgets");

    expect(result.severityThreshold).toBe("CRITICAL");
    expect(result.reviewOnDraft).toBe(true);
    // untouched by the yaml file — stays as the DB value
    expect(result.postSummaryComment).toBe(true);
  });

  it(".codeiq.yml values win on conflict with DB config", async () => {
    vi.mocked(repoConfigRepo.findByRepoId).mockResolvedValue(
      buildConfig({ postSummaryComment: true })
    );
    const octokit = buildOctokit(() =>
      Promise.resolve({ data: { content: base64Yaml("postSummaryComment: false\n") } })
    );

    const result = await service.getEffectiveConfig("repo-1", octokit, "acme", "widgets");

    expect(result.postSummaryComment).toBe(false);
  });

  it("returns DB config when .codeiq.yml has an invalid schema (logs a warning)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(repoConfigRepo.findByRepoId).mockResolvedValue(
      buildConfig({ severityThreshold: "WARNING" })
    );
    const octokit = buildOctokit(() =>
      Promise.resolve({ data: { content: base64Yaml("severityThreshold: NOT_A_REAL_LEVEL\n") } })
    );

    const result = await service.getEffectiveConfig("repo-1", octokit, "acme", "widgets");

    expect(result.severityThreshold).toBe("WARNING");
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("returns DB config when .codeiq.yml has malformed YAML syntax", async () => {
    vi.mocked(repoConfigRepo.findByRepoId).mockResolvedValue(buildConfig());
    const octokit = buildOctokit(() =>
      Promise.resolve({ data: { content: base64Yaml("severityThreshold: [unterminated\n") } })
    );

    await expect(
      service.getEffectiveConfig("repo-1", octokit, "acme", "widgets")
    ).resolves.toBeDefined();
  });

  it("returns DB config when the GitHub API is unreachable for a non-404 reason", async () => {
    vi.mocked(repoConfigRepo.findByRepoId).mockResolvedValue(
      buildConfig({ severityThreshold: "INFO" })
    );
    const octokit = buildOctokit(() => Promise.reject(new Error("ECONNRESET")));

    const result = await service.getEffectiveConfig("repo-1", octokit, "acme", "widgets");

    expect(result.severityThreshold).toBe("INFO");
  });
});
