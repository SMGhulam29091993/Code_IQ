# Backend Architecture — Technical Reference
> Explains the *why* behind every rule in `rules/architecture-rules.md`.

## Why interfaces cross layer boundaries instead of concrete classes

If `ReviewController` imports `ReviewService` (the concrete class), the controller is now coupled to the exact implementation. You can't test the controller in isolation — every test spins up the real service, which needs a real DB. When you want to swap PostgreSQL for a different store, you have to touch the controller too.

With `IReviewService`, the controller only knows what methods exist. Tests inject a mock that satisfies the interface. The service is swappable. The controller stays unchanged.

This is Dependency Inversion (the D in SOLID). It costs one interface file per module. It's worth it on any project that needs tests.

## Why the singleton pattern for Prisma and Redis

Next.js hot-reload and nodemon both re-require modules on file change. Without the global cache, every reload creates a new `PrismaClient` — each one holds its own connection pool. 10 reloads = 10 × pool size connections, exhausting the DB quickly in dev.

The `globalThis` cache means the second require returns the same instance. In production there's no hot-reload so the guard (`!== 'production'`) means we always get a clean client on restart.

## Why startup order matters

Connecting Prisma and Redis before `app.listen()` gives you a clean failure mode: if the DB is unreachable, the process exits with a clear error message before accepting any traffic. If you call `app.listen()` first and then try to connect, real traffic hits routes that immediately fail — worse user experience, harder to diagnose.

`error.middleware.ts` must be registered last in Express. It catches errors thrown from every route registered before it. Registering it first means it catches nothing.

## Why BullMQ for review jobs

GitHub expects a 200 response to a webhook within 10 seconds. Gemini review for a large PR can take 60+ seconds. If you await the review in the webhook handler, GitHub marks the delivery failed and retries — causing duplicate reviews.

BullMQ gives you:
1. Immediate 200 (job enqueued in milliseconds)
2. Async processing with retries and backoff
3. Deduplication via `jobId` (X-GitHub-Delivery header)
4. Visibility into queue state for debugging

## Why `event: 'COMMENT'` not `'REQUEST_CHANGES'`

`REQUEST_CHANGES` blocks the PR from merging until dismissed. For an AI reviewer that may flag style issues alongside critical bugs, blocking on every PR frustrates developers and leads to the GitHub App being uninstalled. `COMMENT` posts all the same inline notes without creating a merge block. Developers can still see every issue; they choose what to act on.

## Why `.codeiq.yml` overrides dashboard config

The dashboard config is a fallback for repos without committed config. Once a team commits `.codeiq.yml`, their review rules travel with the code — they're version-controlled, code-reviewed, and consistent across branches. The dashboard setting becomes the default for new repos only.

## Current reality vs. intended target (for new contributors)

| Area | Current state | Target |
|------|---------------|--------|
| API spec location | `knowledge/technical/backend/api-guidelines.md` | OpenAPI YAML (future) |
| Auth token storage | JWT in `Authorization` header | Same (no plan to change) |
| DB client | Prisma | Same |
| Queue | BullMQ + Redis | Same |
| AI model | Gemini 2.5 Flash (`src/lib/gemini.ts`) — was Gemini 1.5 Pro until Google fully retired it; Pro-tier models (2.5-pro, 3.1-pro-preview) have a hard 0 free-tier quota without billing enabled, so Flash was chosen to work without a paid plan (found/decided 2026-08-26, see `plans/backend.md` Step 5) | Configurable per installation (future); revisit Pro tier if billing gets enabled |
