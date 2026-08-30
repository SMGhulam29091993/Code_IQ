import type { Octokit } from "@octokit/rest";
import { getInstallationOctokit } from "../../lib/octokit";
import type { IInstallationRepository } from "../github/github.types";
import type { ConfigService } from "../repos/config.service";
import type { SanitizedRepoConfig } from "../repos/repo.types";

export interface ReviewContext {
  octokit: Octokit;
  owner: string;
  repo: string;
  repoConfig: SanitizedRepoConfig;
}

// Resolves everything the review pipeline needs from GitHub before any chunk runs: an
// installation-scoped Octokit and the effective repo config. Shared by the coordinator job
// (fresh reviews) and ReviewService.retryReview (resumed reviews) so both resolve repoConfig
// exactly once and thread it through every chunk job's data — decisions/007 Phase 3 — instead of
// each chunk re-fetching `.codeiq.yml` from GitHub itself, which would multiply GitHub API calls
// by chunk count on a large PR (the whole scaling problem this ADR exists to fix).
export async function resolveReviewContext(
  repoId: string,
  repoFullName: string,
  installationId: string,
  installationRepo: IInstallationRepository,
  configService: ConfigService
): Promise<ReviewContext> {
  const installation = await installationRepo.findById(installationId);
  if (!installation) {
    throw new Error(`Installation not found: ${installationId}`);
  }
  const octokit = getInstallationOctokit(installation.githubInstallationId);

  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid repoFullName: ${repoFullName}`);
  }

  const repoConfig = await configService.getEffectiveConfig(repoId, octokit, owner, repo);
  return { octokit, owner, repo, repoConfig };
}
