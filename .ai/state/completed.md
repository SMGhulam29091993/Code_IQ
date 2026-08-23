# Completed
> Append-only. Newest at top.

## 2026-08-23 (Auth: refresh tokens moved from Postgres to Redis)
- Migrated `apps/api/src/modules/auth/refresh-token.repository.ts` off the Postgres
  `RefreshToken` table onto Redis — `refresh_token:<token>` → owning `userId`, TTL from
  `refreshTokenExpiry()` (7 days) instead of a manually-checked `expiresAt` column. Same
  `<domain>:<opaque-id>` key convention already used by `otp:` and `oauth_state:`. New ADR:
  `decisions/006-redis-for-refresh-tokens.md`.
  Prompted by the user asking why the table existed at all, then asking to move that logic to
  Redis — the table was purely a revocation check (`findByToken` on refresh, `deleteByToken`
  on logout) with an `expiresAt` column that was written but never read (expiry was always
  enforced by the JWT's own `exp` claim), so it was a natural fit for the same TTL-based Redis
  pattern the OTP flow already used.
  `IRefreshTokenRepository.findByToken` narrowed from `{ id, userId }` to `{ userId }` — the
  synthetic row id was carried over from the Postgres shape but never consumed by any caller.
  Dropped the `RefreshToken` Prisma model (migration `20260823105451_drop_refresh_token_table`)
  and its `idx_refresh_token_user` entry from `plans/database.md`'s indexes list.
  `apps/api/src/__tests__/auth.service.test.ts` and `auth.routes.test.ts` updated to match (mock
  shapes only — no test cases added or removed, 274/274 still pass). Verified for real: a live
  register → login → refresh → logout → refresh-after-logout sequence against actual
  Postgres/Redis, both via `tsx` and inside the rebuilt Docker container — confirmed the
  `refresh_token:` key's TTL is exactly 604800s and that logout genuinely revokes it (post-logout
  refresh correctly returns 401 "Refresh token revoked").
  `knowledge/domains/auth.md`, `plans/backend.md` (Step 2), `plans/database.md` updated.

## 2026-08-23 (packages/db: Prisma 5 → 7 migration)
- Migrated `packages/db` off Prisma 5's Rust-engine client onto Prisma 7's `pg` driver-adapter
  pattern, on `docs/readme` (ad hoc fix mid-branch, not its own feature branch — see the
  session's actual branch history for the real split). Prompted by two things: (1) the user
  flagged the two-`.env` duplication (`apps/api/.env` + a new `packages/db/.env`) added to fix
  `pnpm db:migrate`'s `DATABASE_URL not found` error (Prisma CLI runs with `packages/db` as its
  cwd and never saw `apps/api/.env`), and (2) a reference implementation in a sibling project
  (TeamPulse) already on Prisma 7 with a `prisma.config.ts` that solves exactly that
  duplication.
  Changes: `packages/db/prisma/schema.prisma`'s `datasource` block no longer has `url` (Prisma
  7 removed it — hard schema-validation error otherwise); new `packages/db/prisma.config.ts`
  loads `apps/api/.env` directly for CLI commands (migrate/studio) — no second `.env` needed
  anymore, `packages/db/.env`/`.env.example` removed; `packages/db/src/index.ts` constructs the
  client via `new PrismaPg({ connectionString: process.env.DATABASE_URL })` passed as the
  `adapter` option, instead of a bare `new PrismaClient()`; `apps/api/src/server.ts` now
  imports `"dotenv/config"` as its literal first statement (env must be loaded before anything
  that transitively imports `@codeiq/db`, which now reads `process.env.DATABASE_URL`
  synchronously at import time, not lazily at `$connect()` like before); Prisma Client's
  generated output moved to a fixed path (`packages/db/generated/client`) instead of the
  default hashed `node_modules/.pnpm/...` location.
  Also created the actual first migration for this database (`20260823095713_init`) — the
  schema had never been migrated against a real Postgres before this session, since the local
  compose Postgres only recently became reachable (unrelated Docker Desktop port-forwarding
  issue, fixed earlier this session).
  Found two more real bugs verifying the Dockerfile still worked against Prisma 7: `generate`
  doesn't need a live DB, but `prisma.config.ts` was throwing unconditionally on a missing
  `DATABASE_URL`, which broke Docker builds (`apps/api/.env` is dockerignored on purpose) — see
  `memory/pitfalls.md` #014; and `pnpm install --prod` doesn't garbage-collect devDependency
  content already fetched into `node_modules/.pnpm` by an earlier full install in the same
  directory, so the image hadn't actually shrunk (964MB) despite `--prod` reporting
  devDependencies removed — fixed with a dedicated fresh-install stage, `memory/pitfalls.md`
  #015. Net result: 317MB, down from the original Prisma-5 image's 664MB.
  Full `pnpm turbo run build/typecheck/lint` and `pnpm --filter @codeiq/api test` (274/274)
  clean throughout. Verified for real, not just typechecked: live `/health` through the
  rebuilt Docker container over the compose network, and a real `POST /api/auth/register`
  round-trip that wrote a `User` row to Postgres through the new adapter-based client.
  `.ai/plans/database.md`, `.ai/plans/backend.md`, `.ai/memory/pitfalls.md` updated.

## 2026-08-23 (Step 7, partial)
- Backend Step 7 (Deploy) local-tooling pieces complete, on `feat/billing-module`.
  `apps/api/Dockerfile` and `apps/web/Dockerfile`: multi-stage `turbo prune @codeiq/<app>
  --docker` builds (pnpm install of the pruned subset → `pnpm turbo run build` → prod-only
  install for `api` / Next.js `output: "standalone"` for `web`) → minimal non-root runtime
  stage. Both built and run-verified for real, not just typechecked: `api` connects to
  Postgres+Redis over the compose network and `GET /health` returns 200; `web` builds and
  serves (its only route so far is the framework's own `/404` — no home page yet, expected
  given frontend Step 2 hasn't started). `apps/api/docker-compose.yml` extended from
  postgres+redis-only to all four services (`api`/`web` build from the new Dockerfiles; `api`
  gets `DATABASE_URL`/`REDIS_URL` pointed at compose service hostnames, everything else from
  `.env` via `env_file`). New `GET /health` route in `app.ts` (outside `/api`, pings Prisma +
  Redis, 200/503) — unauthenticated, no module scaffolding, since it's infra plumbing, not a
  domain endpoint.
  Found and fixed a real production-build bug in the process (dev's `tsx watch` never surfaces
  it): `packages/db` and `packages/types` had no `build` script and compiled as ESM
  (inherited from the shared base tsconfig) while `apps/api` compiles CJS — `node dist/server.js`
  crashed with `prisma` undefined. Both packages now have a `build` script, `main`/`types`
  pointing at `dist/` instead of `src/`, and a `module`/`moduleResolution: Node16` override
  matching `apps/api`. Full `pnpm turbo run build typecheck` and `pnpm --filter @codeiq/api
  test` (274/274) re-verified clean after the fix. See `memory/pitfalls.md` #012.
  AWS EC2/RDS/ElastiCache, Secrets Manager, and the production webhook URL remain — real cloud
  provisioning, out of scope without separate access/authorization.

## 2026-08-17 (Step 6)
- Backend Step 6 (Billing module) complete, on feature branch `feat/billing-module`. Added
  `stripe` dependency, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`/`STRIPE_PRICE_ID_PRO`/
  `STRIPE_PRICE_ID_TEAM` to `env.ts`/`.env`/`.env.example`. `src/lib/stripe.ts` (Stripe client
  singleton, typed against a narrow `IStripeClient` — same stance as `lib/gemini.ts`'s
  `IGeminiClient`, not the SDK's own type). `modules/billing/`: `billing.types.ts`/
  `billing.validator.ts`, `processed-event.repository.ts` (`ProcessedStripeEvent` idempotency),
  `billing.service.ts` (getPlans/createCheckout/createPortal/handleStripeWebhook — all edge
  cases from `knowledge/domains/billing.md`), `billing.controller.ts`/`billing.routes.ts`
  mounted at `/billing`, wired through `container.ts`. `app.ts`'s raw-body mount generalized
  from a single `/api/webhooks` prefix to a list (`RAW_BODY_PATHS`) covering
  `/api/billing/webhook` too, ahead of the global `express.json()` (pitfall #001 applies here
  too). `InstallationRepository` extended with `findByUserId` (billing treats installation as
  one-per-user — see billing.md implementation notes for the multi-installation caveat this
  creates), `findByStripeSubId`, `updateBilling`. `RepoService` gained `enforceFreeTierLimit`
  (called on `customer.subscription.deleted`, deactivates active repos beyond the FREE tier's
  3-most-recent), backed by two new `IRepoRepository` methods
  (`findActiveIdsForInstallationByRecency`/`setActiveMany`). 34 new tests (23 unit in
  `billing.service.test.ts` + 2 `enforceFreeTierLimit` cases in `repo.service.test.ts` + 11
  integration in `billing.routes.test.ts`) — `pnpm typecheck`, `pnpm lint`, `pnpm build`, and
  `pnpm test` (274/274) all pass clean. `knowledge/domains/billing.md` (implementation notes
  added) and `knowledge/technical/backend/api-guidelines.md` (`GET /billing/plans`'s actual
  response shape, which deviates from the doc's original sketch) updated.

## 2026-08-16 (Step 5)
- Backend Step 5 (Review pipeline) complete, on feature branch `feat/review-pipeline` (first
  step built off a branch rather than directly on `Dev`). `modules/reviews/`: `review.types.ts`/
  `review.validator.ts`, `diff.service.ts` (filterFiles/chunkFiles — 300-line chunks with
  20-line overlap), `gemini.service.ts` (reviewDiff/summarizePR against a narrow `IGeminiClient`
  interface, not the `@google/generative-ai` SDK type directly), `comment.service.ts`
  (postReview — single batched GitHub review, `event: COMMENT`), `review.repository.ts`/
  `review-issue.repository.ts`, `review.service.ts` (list/get/retry/stats),
  `review.controller.ts`/`review.routes.ts` mounted at `/reviews`. `src/lib/gemini.ts` (Gemini
  1.5 Pro client singleton), `src/jobs/review.job.ts` (`ReviewJobProcessor` class, full 12-step
  pipeline), `src/jobs/worker.ts` (`startReviewWorker`, registered in `server.ts`'s startup
  sequence). `jobs/queue.ts` gained `defaultJobOptions` (3 attempts, exponential backoff).
  `RepoService.getStats` (Step 4) rewired from placeholder zeros to real aggregation via a new
  `IReviewRepository` dependency; `config.service.ts`'s `getEffectiveConfig` (built in Step 4,
  unwired since) got its first real caller. Added `@google/generative-ai` and `micromatch`
  dependencies plus `GEMINI_API_KEY` to `env.ts`/`.env.example`. 75 new tests (60 unit + 15
  integration) — `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (238/238) all pass
  clean. Along the way: found and fixed that micromatch's `{ basename: true }` option breaks
  matching for slash-containing ignore patterns like `"dist/**"` — `diff.service.ts` branches on
  whether the pattern contains a slash instead. `knowledge/domains/review.md` (implementation
  notes added) and `knowledge/domains/repos.md` (config.service.ts wiring + real stats
  aggregation noted) updated.

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
