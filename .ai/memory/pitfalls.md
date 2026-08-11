# Pitfalls
> Specific technical traps with root causes. Add when caught in review or production.

## 001 — Stripe raw body parsed before signature verification
**Symptom:** `stripe.webhooks.constructEvent` throws "No signatures found matching the expected signature for payload".
**Root cause:** `express.json()` middleware ran before the Stripe webhook route, converting the raw buffer to a parsed object. Stripe's signature is computed over the raw bytes.
**Fix:** Mount `express.raw({ type: 'application/json' })` specifically on `/billing/webhook` BEFORE the global `express.json()` middleware. See `rules/security.md`.

## 002 — GitHub App private key newlines lost in env var
**Symptom:** `error:0909006C:PEM routines:get_name:no start line` from Octokit.
**Root cause:** PEM file stored directly in `.env` — shell or dotenv strips or mangles newlines.
**Fix:** Base64-encode the PEM file (`base64 -i private-key.pem`) and decode at runtime. Documented in `rules/security.md`.

## 003 — bcrypt timing attack on login
**Symptom:** N/A (security concern, not a bug).
**Root cause:** If you short-circuit on "user not found" before calling `bcrypt.compare`, attackers can distinguish "email not registered" from "wrong password" by timing the response.
**Fix:** Always run `bcrypt.compare` even when the user is not found, using a dummy hash. See pseudocode in `knowledge/domains/auth.md#login`.

## 004 — BullMQ duplicate jobs without jobId
**Symptom:** Same PR reviewed twice when GitHub retries a webhook delivery.
**Root cause:** Job enqueued without `jobId` — BullMQ treats each `add()` as unique.
**Fix:** Pass `{ jobId: req.headers['x-github-delivery'] }` as the BullMQ job options. Second enqueue with same `jobId` is a no-op.

## 005 — Tenant isolation missing on review query
**Symptom:** User A can fetch User B's reviews by guessing reviewId.
**Root cause:** `reviewRepo.findById(reviewId)` without scoping to `installationId`.
**Fix:** Every repo query that returns user data must join through `installationId` and verify ownership. The `installationMiddleware` attaches `req.installation` for this purpose.

## 006 — `authRateLimit` is one shared instance across /register, /verify-otp, /login
**Symptom:** A client hitting `/auth/register` a few times then `/auth/login` gets 429'd sooner than expected — the 10-request budget looks like it belongs to `/login` alone but is actually exhausted by earlier `/register` calls.
**Root cause:** `rate-limit.middleware.ts` exports a single `authRateLimit` middleware instance, and `auth.routes.ts` mounts that *same* instance on all three routes. express-rate-limit's default in-memory store keys by IP only (not by route), so all three endpoints share one 10-req/15-min counter per IP.
**Fix:** This is intentional per `rules/security.md` #8 (rate limiting is IP-based, not per-endpoint), but it matters for integration tests: `__tests__/auth.routes.test.ts` keeps its total request count across register/verify-otp/login well under 10 within a single test file, since they all draw from the same budget. If per-endpoint limits are ever wanted, switch to `rateLimit({ ... })` called separately per route instead of reusing one instance.

## 007 — `@octokit/rest`/`@octokit/auth-app` v20+/v7+ are pure ESM, this repo builds CJS
**Symptom:** `tsc` throws `TS1479` ("cannot be imported with require") on `import { Octokit } from "@octokit/rest"` / `import { createAppAuth } from "@octokit/auth-app"`.
**Root cause:** Octokit dropped CommonJS support starting `@octokit/rest@20`/`@octokit/auth-app@7`. `apps/api` has no `"type": "module"` and builds via `tsc` with `module: Node16` (CJS), so any pure-ESM package fails at import, not at runtime.
**Fix:** Pinned to the last CJS-compatible majors: `@octokit/rest@^19.0.13`, `@octokit/auth-app@^6.1.4`. Re-check this pin (or convert the API to ESM) before ever bumping either package.

## 008 — Express 5's `req.query` has no setter
**Symptom:** `TypeError: Cannot set property query of #<IncomingMessage> which has only a getter` thrown synchronously inside any middleware that does `req.query = parsedData`.
**Root cause:** Express 5 defines `req.query` as a getter computed from the parsed URL; unlike Express 4, there's no setter, so reassigning the property throws (caught by Express's own sync-error handling, surfacing as a 500 via `error.middleware.ts`).
**Fix:** `validate.middleware.ts`'s `validateQuery` mutates the existing object in place — `Object.assign(req.query as object, result.data)` — instead of reassigning `req.query`. `validate` (body) is unaffected since `req.body` is a plain writable property.

## 009 — `import yaml from "js-yaml"` gives `undefined`, not the module
**Symptom:** `TypeError: Cannot read properties of undefined (reading 'load')` on `yaml.load(...)`, even though `js-yaml` typechecks fine (`@types/js-yaml` resolves the default export).
**Root cause:** `js-yaml` is CJS (`module.exports = { load, dump, ... }`, no `default` key). Under Vite/Vitest's ESM interop (used to run this repo's tests), a bare default import doesn't get synthesized the way Node's own CJS-interop does under `tsc`/`ts-node` — it silently resolves to `undefined` at runtime instead of erroring at either compile or import time.
**Fix:** Use a namespace import — `import * as yaml from "js-yaml"` — for third-party CJS packages with no real default export. See `config.service.ts`. (Node built-ins like `node:crypto` don't have this problem — they get a real default export.)

## 010 — schema.prisma column `@default` can silently drift from the documented default
**Symptom:** N/A yet (caught in review, not production) — `RepoConfig.ignorePatterns`'s Prisma column default (`["*.test.ts", "*.spec.ts", "dist/**"]`) is missing `"node_modules/**"`, which `.ai/knowledge/domains/repos.md` documents as part of the default config.
**Root cause:** The domain doc's default config (used by `repo.types.ts`'s `DEFAULT_REPO_CONFIG`) was written after the schema, and the schema's own `@default` was never updated to match.
**Fix:** Never rely on a Prisma column `@default` to enforce a documented default — always pass every field explicitly from a single source of truth (`DEFAULT_REPO_CONFIG`) on create, as `repo-config.repository.ts` does. The schema-level default is currently dead code but should still be fixed in a migration before something bypasses the repository layer.
