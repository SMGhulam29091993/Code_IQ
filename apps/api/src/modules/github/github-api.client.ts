import { Octokit } from "@octokit/rest";
import type {
  GithubInstallationMeta,
  GithubRepoListItem,
  GithubUserProfile,
  IGithubApiClient,
  OAuthTokenExchangeResult,
} from "./github.types";
import { env } from "../../lib/env";
import { AppError, NotFoundError } from "../../lib/errors";
import { appOctokit, getInstallationOctokit } from "../../lib/octokit";

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

  // Single page, 100 repos — see github-app.md "Repo sync" for why pagination isn't handled
  // yet (no installation in this codebase's test data has ever needed a second page).
  async listInstallationRepos(githubInstallationId: number): Promise<GithubRepoListItem[]> {
    try {
      const octokit = getInstallationOctokit(githubInstallationId);
      const { data } = await octokit.rest.apps.listReposAccessibleToInstallation({
        per_page: 100,
      });
      return data.repositories.map((repo) => ({
        githubRepoId: repo.id,
        fullName: repo.full_name,
        language: repo.language ?? null,
      }));
    } catch {
      throw new AppError("GitHub API unavailable", 502);
    }
  }
}

function isOctokitNotFound(err: unknown): boolean {
  return typeof err === "object" && err !== null && "status" in err && err.status === 404;
}
