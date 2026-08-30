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
- **Revisited 2026-08-23:** `refresh-token.repository.ts` moved from Postgres to Redis
  (`RefreshToken` Prisma model dropped, migration `20260823105451_drop_refresh_token_table`) —
  see `decisions/006-redis-for-refresh-tokens.md` and `knowledge/domains/auth.md`'s
  `POST /auth/logout` implementation note. Test counts unchanged (mock shapes updated, no
  cases added/removed); full suite re-verified clean, plus a live end-to-end run (register →
  login → refresh → logout → refresh-after-logout correctly rejected) against real
  Postgres/Redis, both via `tsx` and inside the rebuilt Docker container.

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
- [x] Dockerfile for apps/api — multi-stage (`turbo prune` → build stage (full install + `tsc`/
  `prisma generate`) → separate `installer` stage (fresh prod-only install, never touches
  devDependencies) → non-root runtime), built and run-verified against the compose network,
  317MB
- [x] Migrated `packages/db` from Prisma 5 (Rust-engine client, `env("DATABASE_URL")` in
  schema) to Prisma 7 (`pg` driver adapter via `@prisma/adapter-pg`, `prisma.config.ts`) — see
  `memory/pitfalls.md` #013–#015. Not originally scoped for this step, but the reference
  pattern (TeamPulse, a sibling project) made the case for adopting it now rather than
  carrying the older setup forward.
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
- `apps/api`'s alpine stages need `python3 make g++` (bcrypt's native addon, built via
  node-pre-gyp/node-gyp — no prebuilt musl/arm64 binary is fetched). `openssl` was needed for
  Prisma 5's Rust query engine but is no longer required after the Prisma 7 driver-adapter
  migration (no native engine binary ships anymore) — see `memory/pitfalls.md` #013.
- `pnpm install --prod --frozen-lockfile`, run in the *same* directory as an earlier full
  install, does not shrink the image — it only removes `node_modules/` symlinks, not the
  already-fetched devDependency content sitting in the local `.pnpm` virtual store. Needed a
  dedicated `installer` stage with a fresh install instead — see `memory/pitfalls.md` #015.
  (Also still needs `ENV CI=true` in that stage — pnpm refuses to purge `node_modules`
  non-interactively otherwise, `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.)
- Prisma Client's generated output is pinned to `packages/db/generated/client` (`generator
  client { output = ... }`) instead of the default hashed `node_modules/.pnpm/...` path — lets
  the Dockerfile copy it between stages by a stable path. Matches a pre-existing (previously
  unused) `packages/db/generated/` entry in the root `.gitignore`.
- `apps/web` has no `public/` directory yet — the Dockerfile doesn't copy one; add that `COPY` back
  if/when one is added.
- AWS provisioning is out of scope for local tooling — real infra, needs separate access/authorization.

## Step 8 — Scalable review pipeline (chunk-level fan-out) [ in-progress ]

> Design: `decisions/007-chunk-level-fanout-review-pipeline.md` +
> `knowledge/technical/backend/review-pipeline-scaling.md` (full HLD/LLD). Raised because the
> current single-BullMQ-job-per-PR pipeline head-of-line-blocks other tenants behind a large PR,
> can't scale one PR's chunk parallelism past a single process, and re-does all Gemini calls on
> retry. Ships in 4 phases, each independently verifiable, per the design doc.

- [x] Phase 1 — `ReviewChunk` model + `Review.totalChunks/completedChunks/truncated` +
  `ReviewIssue.chunkId`, migration only, no behavior change. Migration
  `20260830063948_add_review_chunk_phase1`, applied to the live compose Postgres. Purely
  additive (new nullable/defaulted columns + new table) — nothing reads/writes `ReviewChunk`
  yet, `ReviewJobProcessor` unchanged. Two existing test fixtures (`review.job.test.ts`,
  `review.service.test.ts`) updated to include the new `Review` fields Prisma's generated type
  now requires. Also removed a stray empty `prisma/migrations/20260823095713_init 2` directory
  (untracked, not part of git history — a leftover duplicate that was blocking `prisma migrate
  dev` with a P3015 error unrelated to this change).
  Verified: `pnpm --filter @codeiq/db build`, `pnpm --filter @codeiq/api typecheck`, `lint`, and
  `test` (322/322) all pass clean; migration applied live via `prisma migrate dev`.
- [x] Phase 2 — `ReviewJobProcessor` persists `ReviewChunk` rows around each chunk's Gemini call
  (still single-job execution); `retryReview` only re-runs non-`DONE` chunks. New
  `ReviewChunkRepository` (`createMany`/`findByReviewId`/`findIncomplete`/`markRunning`/
  `markDone`/`markFailed`), `IReviewRepository.incrementCompletedChunks` (atomic DB increment),
  `IReviewIssueRepository.findByReviewId`. `ReviewJobData` gained an optional `reviewId` —
  `ReviewService.retryReview` now passes the existing review's id so the job resumes it (no new
  Review row, no diff re-fetch) instead of starting over; the finalize step always re-queries
  real `ReviewChunk` rows for its DONE/FAILED gate, never the denormalized `completedChunks`
  counter. `knowledge/domains/review.md`'s pipeline pseudocode/edge-case table/test list updated
  to match.
  Verified: `pnpm --filter @codeiq/db build`, `pnpm --filter @codeiq/api typecheck`, `lint`,
  `build`, and `test` (326/326, 4 new retry-resume cases) all pass clean. Not yet
  live-verified against a real GitHub PR retry (needs Docker/ngrok — see `state/current.md`).
- [x] Phase 3 — Split into `review-chunk-queue` + `review-finalize-queue` via BullMQ
  `FlowProducer`; fleet-wide Gemini rate limit via `Worker.limiter`. The single
  `ReviewJobProcessor`/`jobs/review.job.ts` from Phase 1/2 is gone, replaced by 3 processors:
  `ReviewCoordinatorJobProcessor` (`jobs/review-coordinator.job.ts`, `review-coordinator-queue` —
  same queue `webhook.service.ts` enqueues into, renamed from `review-queue`), `ReviewChunkJobProcessor`
  (`jobs/review-chunk.job.ts`, `review-chunk-queue`, `Worker.limiter: { max: 5, duration: 60_000 }`
  — still the free tier's 5 RPM), and `ReviewFinalizeJobProcessor` (`jobs/review-finalize.job.ts`,
  `review-finalize-queue`, the Flow parent). New `reviewFlowProducer` singleton (`jobs/queue.ts`)
  and `modules/reviews/resolve-review-context.ts` (installation octokit + effective repoConfig,
  resolved once and shared by the coordinator and `ReviewService.retryReview` — never re-fetched
  per chunk). `retryReview` now calls `reviewFlowProducer.add` directly with the review's
  incomplete chunks as Flow children instead of enqueueing into the coordinator queue.
  `knowledge/domains/review.md`'s "Core pipeline" section rewritten for the 3-processor
  architecture (this doc's own Phase 3 section here now points there for current behavior).
  Verified: `pnpm --filter @codeiq/api typecheck`, `lint`, `build`, and `test` (328/328 — 3 new
  processor test files replacing the old single-job one) all pass clean. **Not yet load-tested
  against a real large PR** — that and confirming `failParentOnFailure: false` under real
  partial-chunk-failure conditions are still open before trusting this at scale in production
  (see `knowledge/technical/backend/review-pipeline-scaling.md` Phase 3 note).
- [ ] Phase 4 — Per-installation fairness (`fairnessService`, priority scoring),
  `MAX_CHUNKS_PER_REVIEW` truncation + prioritization, live progress wired into the dashboard
- `knowledge/domains/review.md` gets updated to match actual behavior after each phase ships —
  not before.
