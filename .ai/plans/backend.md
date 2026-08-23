# Backend Plan
> Step-by-step implementation order. One step reaches `completed` before the next begins.

## Step 1 — Foundation [ complete ]
- [x] Turborepo scaffold (apps/api, apps/web, packages/db, packages/types, packages/config)
- [x] packages/db: Prisma schema (User, RefreshToken, Otp, Installation, Repo, RepoConfig, Review, ReviewIssue, ProcessedStripeEvent) — Otp model + User.status added per `knowledge/domains/auth.md` OTP update
- [x] `src/lib/env.ts`: validate all env vars at startup (fail fast) — only vars Step 1/2 consume (GitHub/Stripe/Gemini vars land with their own steps)
- [x] `src/lib/prisma.ts`: singleton PrismaClient (re-exported from `packages/db`, which owns the actual singleton)
- [x] `src/lib/redis.ts`: singleton Redis client
- [x] `src/lib/errors.ts`: AppError + subclasses
- [x] `src/lib/response.ts`: `ok()` + `fail()` helpers
- [x] `src/middlewares/error.middleware.ts`: global error handler
- [x] `src/middlewares/auth.middleware.ts`: JWT verify + req.user attach
- [x] `src/middlewares/validate.middleware.ts`: Zod validator
- [x] `src/middlewares/rate-limit.middleware.ts`: auth routes limiter
- [x] Helmet, CORS setup in `app.ts`
- [x] `src/container.ts`: DI wiring (empty — populated starting Step 2)
- [x] `src/server.ts`: startup sequence (env → DB → Redis → workers → listen)
- Note: `GET /health` is Step 7 (Deploy), not built here — see that step below.
- Verified: `pnpm install`, `typecheck`, `build`, and `lint` all pass clean for `@codeiq/api`, `@codeiq/db`, `@codeiq/types`.

## Step 2 — Auth module [ complete ]
- [x] `auth.types.ts`, `auth.validator.ts`
- [x] `user.repository.ts` + `refresh-token.repository.ts` + `otp.repository.ts`
- [x] `services/otp.service.ts` (5-min OTP + Redis identifier, ADR 003) + `services/mail/` factory (ADR 004)
- [x] `lib/jwt.ts` (access/refresh token signing)
- [x] `auth.service.ts` (register, verify-otp, login, refresh, logout)
- [x] `auth.controller.ts`
- [x] `auth.routes.ts` + mount in `routes/index.ts` + wired through `container.ts`
- [x] Unit tests: `__tests__/auth.service.test.ts` (29 tests, all cases from `knowledge/domains/auth.md`)
- [x] Integration tests: `__tests__/auth.routes.test.ts` (12 tests, real Express app via supertest, DB/Redis/mail mocked at module boundary)
- Verified: `pnpm typecheck`, `pnpm lint`, and `pnpm test` (41/41) all pass clean for `@codeiq/api`.
- Domain: `knowledge/domains/auth.md` ✓

## Step 3 — GitHub App module [ complete ]
- [x] `src/lib/octokit.ts`: App + installation Octokit factory (pinned to CJS-compatible
  `@octokit/rest@19` / `@octokit/auth-app@6` — see github-app.md implementation notes)
- [x] `src/lib/crypto.ts`: AES-256-GCM encryption for `User.githubAccessToken` at rest
- [x] `src/jobs/queue.ts`: BullMQ `review-queue` producer (pulled forward from Step 5 — the
  webhook needs to enqueue; the worker/processor still lands in Step 5)
- [x] `github.types.ts`, `github.validator.ts`
- [x] `installation.repository.ts`, `repo.repository.ts` (narrow Repo-table lookups the
  webhook needs — see github-app.md notes), `github-api.client.ts` (Octokit + OAuth wrapper)
- [x] `IUserRepository` extended with `findByGithubId`/`linkGithubIdentity` (auth module)
- [x] `github.service.ts` (OAuth URL, callback, saveInstallation, list, delete)
- [x] `installation.middleware.ts`: attach req.installation (reserved for Step 4/5 routes —
  see github-app.md notes for why Step 3's own DELETE route doesn't mount it)
- [x] `github.controller.ts`
- [x] `github.routes.ts` + mounted at `/github` in `routes/index.ts`
- [x] `webhook.middleware.ts`: HMAC-SHA256 signature verification
- [x] `webhook.service.ts` + `webhook.controller.ts`: event routing + job enqueue
- [x] `webhook.routes.ts` (mounted at `/webhooks`; raw body parser mounted in `app.ts` on the
  `/api/webhooks` prefix ahead of the global `express.json()`)
- [x] `validateQuery` middleware added (query-string counterpart to `validate`)
- [x] Unit tests: `github.service.test.ts` (18), `webhook.service.test.ts` (16),
  `installation.middleware.test.ts` (4), `webhook.middleware.test.ts` (4)
- [x] Integration tests: `github.routes.test.ts` (14), `webhook.routes.test.ts` (9)
- Verified: `pnpm typecheck`, `pnpm lint`, and `pnpm test` (106/106) all pass clean for
  `@codeiq/api`.
- Domain: `knowledge/domains/github-app.md` ✓ (updated with implementation notes/open
  questions discovered during this step)

## Step 4 — Repos module [ complete ]
- [x] Repo sync from GitHub (resolves the Step 3 open question): `IGithubApiClient.listInstallationRepos`
  + `IRepoLookupRepository.upsertFromGithub`, called from `GithubService.saveInstallation`
  (best-effort, on `POST /github/install`) and `WebhookService.handle` (`installation_repositories.added`)
- [x] `modules/repos/repo.repository.ts`, `repo-config.repository.ts`
- [x] `modules/repos/config.service.ts` (effective config resolution — `.codeiq.yml` merge;
  built and unit-tested, not yet called from any route — first real caller is Step 5)
- [x] `modules/repos/repo.service.ts` (list, activate, deactivate, config CRUD, stats — stats
  returns real-but-always-zero aggregates until Step 5 ships Review data)
- [x] `modules/repos/repo.controller.ts`, `repo.routes.ts` + mounted at `/repos` in `routes/index.ts`
  + wired through `container.ts`
- [x] Unit tests: `repo.service.test.ts` (24), `config.service.test.ts` (7), plus repo-sync
  coverage added to `github.service.test.ts`/`webhook.service.test.ts`
- [x] Integration tests: `repo.routes.test.ts` (19), plus repo-sync coverage added to
  `github.routes.test.ts`/`webhook.routes.test.ts`
- Verified: `pnpm typecheck`, `pnpm lint`, and `pnpm test` (162/162) all pass clean for `@codeiq/api`.
- Domain: `knowledge/domains/repos.md` ✓ (Implementation notes section added) and
  `knowledge/domains/github-app.md` ✓ (repo-sync open question resolved)

## Step 5 — Review pipeline [ complete ]
- [x] `src/jobs/queue.ts`: BullMQ review-queue init (producer existed since Step 3; added
  `defaultJobOptions` — 3 attempts, exponential backoff — per this doc's pipeline pseudocode)
- [x] `src/jobs/worker.ts`: register workers + concurrency config (`startReviewWorker`, called
  from `server.ts`'s startup sequence)
- [x] `modules/reviews/diff.service.ts`: filterFiles + chunkFiles
- [x] `src/lib/gemini.ts`: Gemini client singleton (`@google/generative-ai`, `gemini-1.5-pro`,
  typed against the narrow `IGeminiClient` interface, not the SDK's own type)
- [x] `modules/reviews/gemini.service.ts`: reviewDiff + summarizePR
- [x] `modules/reviews/comment.service.ts`: postReview
- [x] `modules/reviews/review.repository.ts`, `review-issue.repository.ts`
- [x] `modules/reviews/review.service.ts`: list, get, retry, stats
- [x] `src/jobs/review.job.ts`: `ReviewJobProcessor` class, full pipeline (steps 1–12 from
  `knowledge/domains/review.md`)
- [x] `modules/reviews/review.controller.ts`, `review.routes.ts` + mounted at `/reviews` in
  `routes/index.ts` + wired through `container.ts`
- [x] First real caller of `modules/repos/config.service.ts`'s `getEffectiveConfig` (built in
  Step 4, unwired until now) and of `GET /repos/:repoId/stats`'s real aggregation (`RepoService`
  given a fourth `IReviewRepository` dependency)
- [x] Unit tests: `diff.service.test.ts` (11), `gemini.service.test.ts` (9),
  `comment.service.test.ts` (7), `review.service.test.ts` (22), `review.job.test.ts` (11)
- [x] Integration tests: `review.routes.test.ts` (15), plus repo-stats coverage added to
  `repo.routes.test.ts`/`repo.service.test.ts`
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` (238/238) all pass
  clean for `@codeiq/api`.
- Domain: `knowledge/domains/review.md` ✓ (Implementation notes section added) and
  `knowledge/domains/repos.md` ✓ (config.service.ts wiring + real stats aggregation noted)

## Step 6 — Billing module [ complete ]
- [x] `src/lib/stripe.ts`: Stripe client singleton (typed against a narrow `IStripeClient`,
  not the `stripe` SDK's own type — same stance as `lib/gemini.ts`'s `IGeminiClient`)
- [x] `billing.service.ts` (plans, checkout, portal, webhook handler)
- [x] `billing.controller.ts`, `billing.routes.ts` (Stripe route uses express.raw) + mounted
  at `/billing` in `routes/index.ts` + wired through `container.ts`
- [x] Stripe webhook: idempotency via `ProcessedStripeEvent` table
  (`processed-event.repository.ts`)
- [x] `RepoService.enforceFreeTierLimit` (new) — called from `customer.subscription.deleted`,
  deactivates active repos beyond the FREE tier's 3-most-recent; new `IRepoRepository` methods
  `findActiveIdsForInstallationByRecency`/`setActiveMany`
- [x] `InstallationRepository` extended with `findByUserId`/`findByStripeSubId`/`updateBilling`
- [x] Unit tests: `billing.service.test.ts` (23, all cases from `knowledge/domains/billing.md`),
  plus `enforceFreeTierLimit` coverage added to `repo.service.test.ts`
- [x] Integration tests: `billing.routes.test.ts` (11)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` (274/274) all pass
  clean for `@codeiq/api`.
- Domain: `knowledge/domains/billing.md` ✓ (Implementation notes section added)

## Step 7 — Deploy [ in-progress ]
- [x] Dockerfile for apps/api — multi-stage (`turbo prune` → pnpm install → build → prod-only
  install → non-root runtime), built and run-verified against the compose network
- [x] Dockerfile for apps/web — same `turbo prune` pattern, Next.js `output: "standalone"`
  (added to `next.config.js`), built and run-verified
- [x] docker-compose.yml (postgres + redis + api + web) — `api`/`web` build from the Dockerfiles
  above; `api` gets DB/Redis URLs pointed at the compose service hostnames, everything else
  from `.env` via `env_file`
- [x] Health check endpoint: `GET /health` — outside `/api`, pings both Prisma (`SELECT 1`) and
  Redis (`ping()`), 200/503
- [ ] AWS EC2 + RDS + ElastiCache setup
- [ ] GitHub App webhook URL → production domain
- [ ] Env vars loaded from AWS Secrets Manager

**Implementation notes (discovered during this step):**
- Fixed a real production-build bug surfaced by actually running `pnpm build && node dist/server.js`
  for the first time (dev always used `tsx watch`, which never hit it): `packages/db` and
  `packages/types` compiled to ESM while `apps/api` compiles to CJS, and had no `build` script —
  see `memory/pitfalls.md` #012. Both packages now build to `dist/` (CJS, matching `apps/api`) and
  `main`/`types` point there instead of `./src/index.ts`.
- `apps/api/Dockerfile` needs `node:22-alpine` (not `20-alpine`) — the pinned `packageManager:
  pnpm@11.1.2` in the root `package.json` requires Node ≥22.13 and fails under corepack on Node 20.
- `apps/api`'s alpine build stage needs `python3 make g++` (bcrypt's native addon, built via
  node-pre-gyp/node-gyp — no prebuilt musl/arm64 binary is fetched) and `openssl` (Prisma's query
  engine on Alpine). The runtime stage only needs `openssl`.
- `pnpm install --prod --frozen-lockfile` (dropping dev deps in the final `api` build stage) needs
  `ENV CI=true` — pnpm refuses to purge `node_modules` non-interactively otherwise
  (`ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`).
- `apps/web` has no `public/` directory yet — the Dockerfile doesn't copy one; add that `COPY` back
  if/when one is added.
- AWS provisioning is out of scope for local tooling — real infra, needs separate access/authorization.
