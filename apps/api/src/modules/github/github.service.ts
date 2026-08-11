import crypto from "node:crypto";
import type { Installation } from "@codeiq/db";
import type {
  IGithubApiClient,
  IGithubService,
  IInstallationRepository,
  InstallInput,
  IRepoLookupRepository,
  ListInstallationsResult,
  OAuthCallbackQuery,
  OAuthCallbackResult,
  OAuthUrlResult,
  SanitizedInstallation,
  SaveInstallationResult,
} from "./github.types";
import { encrypt } from "../../lib/crypto";
import { env } from "../../lib/env";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from "../../lib/errors";
import { redis } from "../../lib/redis";
import type { IUserRepository } from "../auth/auth.types";

const OAUTH_STATE_TTL_SECONDS = 10 * 60; // 10 min — .ai/knowledge/domains/auth.md#github-oauth-url

export class GithubService implements IGithubService {
  constructor(
    private readonly installationRepo: IInstallationRepository,
    private readonly repoRepo: IRepoLookupRepository,
    private readonly userRepo: IUserRepository,
    private readonly githubApiClient: IGithubApiClient
  ) {}

  async getOAuthUrl(userId: string): Promise<OAuthUrlResult> {
    const state = crypto.randomBytes(32).toString("hex");
    await redis.set(`oauth_state:${state}`, userId, "EX", OAUTH_STATE_TTL_SECONDS);

    const params = new URLSearchParams({
      client_id: env.GITHUB_CLIENT_ID,
      redirect_uri: env.GITHUB_OAUTH_REDIRECT_URI,
      scope: "read:user user:email",
      state,
    });
    return { url: `https://github.com/login/oauth/authorize?${params.toString()}` };
  }

  async handleOAuthCallback(query: OAuthCallbackQuery): Promise<OAuthCallbackResult> {
    const redisKey = `oauth_state:${query.state}`;
    const userId = await redis.get(redisKey);
    if (!userId) {
      throw new BadRequestError("Invalid or expired state");
    }
    await redis.del(redisKey);

    const { accessToken } = await this.githubApiClient.exchangeOAuthCode(query.code);
    const profile = await this.githubApiClient.getAuthenticatedUser(accessToken);
    const githubId = String(profile.id);

    const existing = await this.userRepo.findByGithubId(githubId);
    if (existing && existing.id !== userId) {
      throw new ConflictError("GitHub account already linked to another user");
    }

    await this.userRepo.linkGithubIdentity(userId, {
      githubId,
      githubLogin: profile.login,
      githubAccessToken: encrypt(accessToken),
    });

    return { redirectUrl: `${env.FRONTEND_URL}/install` };
  }

  async saveInstallation(userId: string, input: InstallInput): Promise<SaveInstallationResult> {
    const meta = await this.githubApiClient.getInstallation(input.installationId);

    const existing = await this.installationRepo.findByGithubId(input.installationId);
    if (existing && existing.userId !== userId) {
      throw new ConflictError("Installation already registered");
    }

    const installation = await this.installationRepo.upsert({
      githubInstallationId: input.installationId,
      accountLogin: meta.accountLogin,
      accountType: meta.accountType,
      userId,
    });

    const repoCount = await this.syncRepos(installation);

    return { installation: sanitize(installation, repoCount) };
  }

  // Best-effort: the Installation row above is already durably saved by the time this runs,
  // so a GitHub API hiccup here shouldn't fail the whole /install call. A missed sync
  // self-heals via the `installation_repositories.added` webhook (webhook.service.ts) or a
  // later re-install. See .ai/knowledge/domains/github-app.md "Repo sync".
  private async syncRepos(installation: Installation): Promise<number> {
    try {
      const repos = await this.githubApiClient.listInstallationRepos(
        installation.githubInstallationId
      );
      for (const repo of repos) {
        await this.repoRepo.upsertFromGithub({ ...repo, installationId: installation.id });
      }
      return repos.length;
    } catch {
      return 0;
    }
  }

  async listInstallations(userId: string): Promise<ListInstallationsResult> {
    const rows = await this.installationRepo.findManyActiveForUser(userId);
    return { installations: rows.map((row) => sanitize(row, row.repoCount)) };
  }

  async deleteInstallation(userId: string, installationId: string): Promise<void> {
    const installation = await this.installationRepo.findById(installationId);
    if (!installation) {
      throw new NotFoundError("Installation not found");
    }
    if (installation.userId !== userId) {
      throw new ForbiddenError("Forbidden");
    }
    await this.installationRepo.softDelete(installationId);
    await this.repoRepo.deactivateAllForInstallation(installationId);
  }
}

function sanitize(installation: Installation, repoCount: number): SanitizedInstallation {
  return {
    id: installation.id,
    githubInstallationId: installation.githubInstallationId,
    accountLogin: installation.accountLogin,
    accountType: installation.accountType,
    planTier: installation.planTier,
    repoCount,
  };
}
