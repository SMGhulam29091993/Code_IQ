# Completed
> Append-only. Newest at top.

## 2026-08-11 (Step 4)
- Backend Step 4 (Repos module) complete, in two parts:
  1. **Repo sync from GitHub** (resolves the open question flagged at the end of Step 3 — no
     mechanism previously created `Repo` rows, so `pull_request` webhooks for genuinely new
     repos always resolved to "Repo not active"). Added `IGithubApiClient.listInstallationRepos`
     (Octokit `apps.listReposAccessibleToInstallation`, single page) and
     `IRepoLookupRepository.upsertFromGithub`; wired into `GithubService.saveInstallation`
     (best-effort, non-blocking) and `WebhookService.handle`'s new
     `installation_repositories.added` branch (mirrors the existing `.removed` handler).
  2. **`modules/repos/`**: `repo.repository.ts` + `repo-config.repository.ts`,
     `config.service.ts` (`.codeiq.yml` effective-config merge — built and unit-tested, not
     yet called from a route; first real caller is Step 5), `repo.service.ts` (list/
     activate/deactivate/config CRUD/stats — FREE tier 3-repo limit enforced on activate,
     stats returns real-but-zero aggregates pending Step 5's Review data), `repo.controller.ts`/
     `repo.routes.ts` mounted at `/repos`, wired through `container.ts`.
  91 new tests (55 unit + 36 integration, including repo-sync coverage added to the Step 3
  github/webhook test files) — `pnpm typecheck`, `pnpm lint`, `pnpm test` (162/162) all pass
  clean. Added `js-yaml` dependency for `.codeiq.yml` parsing (hit and fixed a CJS/ESM default-
  export pitfall — see `memory/pitfalls.md` #009). `knowledge/domains/github-app.md` (repo-sync
  resolved) and `knowledge/domains/repos.md` (implementation notes, including a documented
  schema.prisma default-value drift — `memory/pitfalls.md` #010) updated.

## 2026-08-02 (Step 3)
- Backend Step 3 (GitHub App module) complete: `lib/octokit.ts` (App + installation Octokit
  factory, pinned to `@octokit/rest@19`/`@octokit/auth-app@6` for CJS compatibility — v20+/v7+
  are ESM-only), `lib/crypto.ts` (AES-256-GCM encryption for `User.githubAccessToken` at rest),
  `jobs/queue.ts` (BullMQ `review-queue` producer, pulled forward from Step 5 since the webhook
  needs to enqueue). `modules/github/`: `github.types.ts`/`github.validator.ts`,
  `installation.repository.ts`, `repo.repository.ts` (narrow Repo-table lookups),
  `github-api.client.ts` (Octokit + OAuth token-exchange wrapper), `github.service.ts`
  (oauth/url, oauth/callback, saveInstallation, listInstallations, deleteInstallation),
  `installation.middleware.ts` (tenant-isolation gate, reserved for Step 4/5 routes),
  `github.controller.ts`/`github.routes.ts` mounted at `/github`, `webhook.middleware.ts`
  (HMAC-SHA256 signature verification), `webhook.service.ts`/`webhook.controller.ts`
  (pull_request/installation/installation_repositories event routing),
  `webhook.routes.ts` mounted at `/webhooks`. `IUserRepository` extended with
  `findByGithubId`/`linkGithubIdentity` for identity linking. Added `validateQuery` middleware
  (Express 5's `req.query` has no setter, so it mutates in place rather than reassigning —
  a real bug caught by the route tests). `app.ts` mounts `express.raw()` on `/api/webhooks`
  ahead of the global `express.json()`. 65 new tests (42 unit + 23 integration via supertest) —
  `pnpm typecheck`, `pnpm lint`, `pnpm test` (106/106) all pass clean.
  `knowledge/domains/github-app.md` updated with implementation notes: Octokit CJS pin, the
  `isOverPlanLimit` FREE-tier review-count implementation, and an open question flagged for
  Step 4 (no documented mechanism yet creates/syncs `Repo` rows from GitHub).

## 2026-08-02 (Step 2)
- Backend Step 2 (Auth module) complete: `auth.types.ts`/`auth.validator.ts`, `user.repository.ts`/
  `refresh-token.repository.ts`/`otp.repository.ts`, `services/otp.service.ts` (ADR 003),
  `services/mail/` factory (ADR 004), `lib/jwt.ts`, `auth.service.ts` (register/verify-otp/login/
  refresh/logout), `auth.controller.ts`/`auth.routes.ts`, wired through `container.ts` and mounted
  at `/auth` in `routes/index.ts`. 41 tests (29 unit + 12 integration via supertest, DB/Redis/mail
  mocked at the module boundary) — `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass clean.
  `knowledge/technical/backend/api-guidelines.md` updated for `/register`'s new OTP response shape
  and the new `/verify-otp` endpoint.

## 2026-07-19
- `knowledge/domains/auth.md` updated with the OTP-based registration flow (Otp service schema, register/verify-otp endpoints, mail service factory).
- Backend Step 1 (Foundation) complete: Turborepo monorepo scaffolded (apps/api, apps/web, packages/db, packages/types, packages/config); Prisma schema incl. new `Otp` model + `User.status`; env/prisma/redis/errors/response libs; error/auth/validate/rate-limit middlewares; app.ts/container.ts/server.ts wired. `pnpm install`, typecheck, build, and lint all pass.
- Frontend Step 1 (Foundation) complete: Next.js 14 App Router scaffold, Tailwind config with design-system tokens, hand-written shadcn-style Button/Input primitives, lib/api.ts + query-keys.ts, auth.store.ts + installation.store.ts, Sidebar/ErrorBanner/LoadingSkeleton, (auth) and (dashboard) layouts. Typecheck, build, and lint all pass.

## 2025-07-19
- AI-POS structure created. All domain knowledge, rules, workflows, plans, and state files populated.
