import type { Installation, Repo, RepoConfig } from "@codeiq/db";

// Sanitized installation shape returned over HTTP — matches
// .ai/knowledge/technical/backend/api-guidelines.md "GET /api/github/installations".
export interface SanitizedInstallation {
  id: string;
  githubInstallationId: number;
  accountLogin: string;
  accountType: string;
  planTier: string;
  repoCount: number;
}

export interface InstallInput {
  installationId: number;
}

export interface SaveInstallationResult {
  installation: SanitizedInstallation;
}

export interface ListInstallationsResult {
  installations: SanitizedInstallation[];
}

export interface OAuthUrlResult {
  url: string;
}

export interface OAuthCallbackQuery {
  code: string;
  state: string;
}

export interface OAuthCallbackResult {
  redirectUrl: string;
}

export type RepoWithConfig = Repo & { config: RepoConfig | null };

export interface IInstallationRepository {
  findByGithubId(githubInstallationId: number): Promise<Installation | null>;
  findById(id: string): Promise<Installation | null>;
  // Upsert keyed on githubInstallationId — same install flow run twice by the same user
  // must stay idempotent (.ai/knowledge/domains/github-app.md POST /github/install).
  upsert(data: {
    githubInstallationId: number;
    accountLogin: string;
    accountType: string;
    userId: string;
  }): Promise<Installation>;
  findManyActiveForUser(userId: string): Promise<Array<Installation & { repoCount: number }>>;
  softDelete(id: string): Promise<void>;
  updateActiveByGithubId(githubInstallationId: number, isActive: boolean): Promise<void>;
}

// Narrow, Repo-table-only accessor scoped to what the Step 3 webhook + installation-delete
// flows need (.ai/knowledge/domains/github-app.md). The full CRUD-facing repo management
// module (list/activate/deactivate/config) is `.ai/plans/backend.md` Step 4's own
// modules/repos/repo.repository.ts — this one stays narrow and keeps serving the github
// module's own routes/webhook.
export interface IRepoLookupRepository {
  findByGithubId(githubRepoId: number): Promise<RepoWithConfig | null>;
  deactivateByGithubId(githubRepoId: number): Promise<void>;
  deactivateAllForInstallation(installationId: string): Promise<void>;
  // Calendar-month count, for the FREE tier "50 reviews/mo" limit (.ai/knowledge/domains/billing.md).
  countReviewsThisMonth(installationId: string): Promise<number>;
  // Upsert keyed on githubRepoId — same repo synced twice (re-install, or install followed by
  // an installation_repositories.added webhook for the same repo) must stay idempotent.
  // Does not update installationId on conflict, matching IInstallationRepository.upsert's
  // stance on not silently transferring ownership. See github-app.md "Repo sync".
  upsertFromGithub(data: {
    githubRepoId: number;
    fullName: string;
    language: string | null;
    installationId: string;
  }): Promise<void>;
}

export interface GithubInstallationMeta {
  accountLogin: string;
  accountType: string;
}

export interface OAuthTokenExchangeResult {
  accessToken: string;
}

export interface GithubUserProfile {
  id: number;
  login: string;
}

export interface GithubRepoListItem {
  githubRepoId: number;
  fullName: string;
  language: string | null;
}

// Thin wrapper around Octokit + the GitHub OAuth endpoints — injected into GithubService so
// unit tests mock this instead of hitting the network (same pattern as IMailServiceFactory
// in the auth module).
export interface IGithubApiClient {
  getInstallation(githubInstallationId: number): Promise<GithubInstallationMeta>;
  exchangeOAuthCode(code: string): Promise<OAuthTokenExchangeResult>;
  getAuthenticatedUser(accessToken: string): Promise<GithubUserProfile>;
  // First 100 repos accessible to the installation (single page) — see github-app.md
  // "Repo sync" for the pagination caveat.
  listInstallationRepos(githubInstallationId: number): Promise<GithubRepoListItem[]>;
}

export interface IGithubService {
  getOAuthUrl(userId: string): Promise<OAuthUrlResult>;
  handleOAuthCallback(query: OAuthCallbackQuery): Promise<OAuthCallbackResult>;
  saveInstallation(userId: string, input: InstallInput): Promise<SaveInstallationResult>;
  listInstallations(userId: string): Promise<ListInstallationsResult>;
  deleteInstallation(userId: string, installationId: string): Promise<void>;
}

// GitHub webhook payload — only the fields .ai/knowledge/domains/github-app.md#webhook
// actually reads. Real payloads carry far more; the rest is intentionally untyped here.
export interface GithubWebhookBody {
  action?: string;
  installation?: { id: number };
  repository?: { id: number; full_name: string };
  pull_request?: {
    number: number;
    title: string;
    draft: boolean;
    user: { login: string };
    head: { sha: string };
  };
  repositories_removed?: Array<{ id: number }>;
  repositories_added?: Array<{ id: number; full_name: string }>;
}

export interface WebhookEventInput {
  event: string;
  deliveryId: string | undefined;
  body: GithubWebhookBody;
}

export interface IWebhookService {
  handle(input: WebhookEventInput): Promise<string>;
}
