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

## Step 4 — Repos module [ not-started ]
- [ ] `repo.repository.ts`, `repo-config.repository.ts`
- [ ] `config.service.ts` (effective config resolution)
- [ ] `repo.service.ts` (list, activate, deactivate, config CRUD, stats)
- [ ] `repo.controller.ts`, `repo.routes.ts`
- [ ] Unit + integration tests (all cases from `knowledge/domains/repos.md`)
- Domain: `knowledge/domains/repos.md` ✓

## Step 5 — Review pipeline [ not-started ]
- [ ] `src/jobs/queue.ts`: BullMQ review-queue init
- [ ] `src/jobs/worker.ts`: register workers + concurrency config
- [ ] `diff.service.ts`: filterFiles + chunkFiles
- [ ] `src/lib/gemini.ts`: Gemini client singleton
- [ ] `gemini.service.ts`: reviewDiff + summarizePR
- [ ] `comment.service.ts`: postReview
- [ ] `review.repository.ts`, `review-issue.repository.ts`
- [ ] `review.service.ts`: list, get, retry, stats
- [ ] `src/jobs/review.job.ts`: full pipeline (steps 1–12 from `knowledge/domains/review.md`)
- [ ] `review.controller.ts`, `review.routes.ts`
- [ ] Unit tests: all cases from `knowledge/domains/review.md`
- Domain: `knowledge/domains/review.md` ✓

## Step 6 — Billing module [ not-started ]
- [ ] `src/lib/stripe.ts`: Stripe client singleton
- [ ] `billing.service.ts` (plans, checkout, portal, webhook handler)
- [ ] `billing.controller.ts`, `billing.routes.ts` (Stripe route uses express.raw)
- [ ] Stripe webhook: idempotency via ProcessedEvent table
- [ ] Unit tests: all cases from `knowledge/domains/billing.md`
- Domain: `knowledge/domains/billing.md` ✓

## Step 7 — Deploy [ not-started ]
- [ ] Dockerfile for apps/api
- [ ] docker-compose.yml (postgres + redis + api + web)
- [ ] AWS EC2 + RDS + ElastiCache setup
- [ ] GitHub App webhook URL → production domain
- [ ] Env vars loaded from AWS Secrets Manager
- [ ] Health check endpoint: `GET /health`
