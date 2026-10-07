import { Octokit } from "@octokit/rest";
import type {
  GithubInstallationMeta,
  GithubOrgMember,
  GithubRepoListItem,
  GithubUserProfile,
  IGithubApiClient,
  OAuthTokenExchangeResult,
} from "./github.types";
import { env } from "../../lib/env";
import { AppError, NotFoundError } from "../../lib/errors";
import { appOctokit, getInstallationOctokit } from "../../lib/octokit";

const REPO_PAGE_SIZE = 100;
// 100 pages × 100 = 10,000 repos — far beyond any real installation; only a runaway guard.
const MAX_REPO_PAGES = 100;

const GITHUB_OAUTH_TOKEN_URL = "https://github.com/login/oauth/access_token";

export class GithubApiClient implements IGithubApiClient {
  async getInstallation(githubInstallationId: number): Promise<GithubInstallationMeta> {
    try {
      const { data } = await appOctokit.rest.apps.getInstallation({
        installation_id: githubInstallationId,
      });
      if (!data.account || !("login" in data.account)) {
        throw new AppError("GitHub API unavailable", 502);
      }
      return {
        accountLogin: data.account.login,
        accountType: "type" in data.account ? (data.account.type ?? "User") : "User",
      };
    } catch (err) {
      if (err instanceof AppError) throw err;
      if (isOctokitNotFound(err)) {
        throw new NotFoundError("Installation not found on GitHub");
      }
      throw new AppError("GitHub API unavailable", 502);
    }
  }

  async exchangeOAuthCode(code: string): Promise<OAuthTokenExchangeResult> {
    let response: Response;
    try {
      response = await fetch(GITHUB_OAUTH_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: env.GITHUB_CLIENT_ID,
          client_secret: env.GITHUB_CLIENT_SECRET,
          code,
          redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI,
        }),
      });
    } catch {
      throw new AppError("GitHub authentication failed", 502);
    }

    const data = (await response.json().catch(() => null)) as
      | { access_token?: string; error?: string }
      | null;
    if (!response.ok || !data?.access_token) {
      throw new AppError("GitHub authentication failed", 502);
    }
    return { accessToken: data.access_token };
  }

  async getAuthenticatedUser(accessToken: string): Promise<GithubUserProfile> {
    try {
      const client = new Octokit({ auth: accessToken });
      const { data } = await client.rest.users.getAuthenticated();
      return { id: data.id, login: data.login };
    } catch {
      throw new AppError("GitHub authentication failed", 502);
    }
  }

  // Every repo the installation can access — all pages, 100 per page. Was a single page until
  // 2026-10-08, so an installation with more than 100 repos never got Repo rows for the rest
  // (their pull_request webhooks then resolved to "Repo not active"). Manual page loop for the
  // same reason as modules/reviews/pr-files.ts (octokit.paginate doesn't typecheck under the
  // pinned Octokit v19). Stops on a short page, once total_count is reached, or at
  // MAX_REPO_PAGES as a guard against a response that never ends.
  async listInstallationRepos(githubInstallationId: number): Promise<GithubRepoListItem[]> {
    try {
      const octokit = getInstallationOctokit(githubInstallationId);
      const repos: GithubRepoListItem[] = [];
      for (let page = 1; page <= MAX_REPO_PAGES; page++) {
        const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
          per_page: REPO_PAGE_SIZE,
          page,
        });
        for (const repo of data.repositories) {
          repos.push({
            githubRepoId: repo.id,
            fullName: repo.full_name,
            language: repo.language ?? null,
          });
        }
        if (data.repositories.length < REPO_PAGE_SIZE || repos.length >= data.total_count) break;
      }
      return repos;
    } catch {
      throw new AppError("GitHub API unavailable", 502);
    }
  }

  // GitHub's org-membership API exposes exactly two roles — no "owner" distinct from "admin" —
  // fetched with two role-filtered calls rather than one unfiltered call + a per-member lookup.
  async listOrgMembers(githubInstallationId: number, org: string): Promise<GithubOrgMember[]> {
    try {
      const octokit = getInstallationOctokit(githubInstallationId);
      const [admins, members] = await Promise.all([
        octokit.rest.orgs.listMembers({ org, role: "admin", per_page: 100 }),
        octokit.rest.orgs.listMembers({ org, role: "member", per_page: 100 }),
      ]);
      return [
        ...admins.data.map((m) => ({ login: m.login, role: "admin" as const })),
        ...members.data.map((m) => ({ login: m.login, role: "member" as const })),
      ];
    } catch {
      throw new AppError("GitHub API unavailable", 502);
    }
  }
}

function isOctokitNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && err.status === 404;
}
