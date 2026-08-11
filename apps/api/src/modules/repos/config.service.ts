import type { Octokit } from "@octokit/rest";
import * as yaml from "js-yaml";
import { DEFAULT_REPO_CONFIG } from "./repo.types";
import type { IRepoConfigRepository, SanitizedRepoConfig } from "./repo.types";
import { YamlConfigSchema } from "./repo.validator";

const CONFIG_FILE_PATH = ".codeiq.yml";

// Effective config for a review = DB config merged with `.codeiq.yml` from the repo root;
// `.codeiq.yml` wins on overlap. Consumed by the review pipeline (.ai/plans/backend.md Step 5)
// — not wired into any Step 4 route (GET/PATCH /repos/:repoId/config only read/write the raw
// DB row). See .ai/knowledge/domains/repos.md "config.service.ts".
export class ConfigService {
  constructor(private readonly repoConfigRepo: IRepoConfigRepository) {}

  async getEffectiveConfig(
    repoId: string,
    octokit: Octokit,
    owner: string,
    repo: string
  ): Promise<SanitizedRepoConfig> {
    const dbConfig = await this.dbConfigFor(repoId);

    try {
      const { data } = await octokit.rest.repos.getContent({
        owner,
        repo,
        path: CONFIG_FILE_PATH,
      });
      if (!("content" in data) || typeof data.content !== "string") {
        return dbConfig;
      }

      const raw = Buffer.from(data.content, "base64").toString("utf-8");
      const parsed = YamlConfigSchema.safeParse(yaml.load(raw));
      if (!parsed.success) {
        console.warn(`${owner}/${repo}: .codeiq.yml has invalid schema — using DB config`);
        return dbConfig;
      }
      return { ...dbConfig, ...parsed.data };
    } catch (err) {
      if (isOctokitNotFound(err)) {
        return dbConfig;
      }
      // Malformed YAML syntax (yaml.load throws) or a network error — same fallback as an
      // invalid schema: never block the review over a broken .codeiq.yml.
      console.warn(`${owner}/${repo}: failed to read .codeiq.yml — using DB config`);
      return dbConfig;
    }
  }

  private async dbConfigFor(repoId: string): Promise<SanitizedRepoConfig> {
    const row = await this.repoConfigRepo.findByRepoId(repoId);
    if (!row) return DEFAULT_REPO_CONFIG;
    return {
      severityThreshold: row.severityThreshold,
      enabledCategories: row.enabledCategories,
      ignorePatterns: row.ignorePatterns,
      reviewOnDraft: row.reviewOnDraft,
      postSummaryComment: row.postSummaryComment,
    };
  }
}

function isOctokitNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && err.status === 404;
}
