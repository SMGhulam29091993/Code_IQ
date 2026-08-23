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

## 011 — micromatch's `{ basename: true }` breaks matching for slash-containing patterns
**Symptom:** `diff.service.ts`'s `filterFiles` unit test expected `ignorePatterns: ["dist/**"]` to exclude `"dist/out.js"`, but the file was kept — `micromatch.isMatch("dist/out.js", "dist/**", { basename: true })` returns `false`, even though the same call without the option returns `true`.
**Root cause:** The `basename` option was added so slash-less patterns like `"*.test.ts"` match at any directory depth (`.gitignore`-style), matching `DEFAULT_REPO_CONFIG.ignorePatterns`'s intent. It was assumed to apply conditionally — "only affects patterns without a slash" — but empirically it changes matching behavior for every pattern passed with that option set, including ones that already contain a slash.
**Fix:** Branch on `pattern.includes("/")` per-pattern instead of setting the option globally: patterns with a slash call `micromatch.isMatch(filename, pattern)` (no options); slash-less patterns call it with `{ basename: true }`. See `diff.service.ts`'s `matchesIgnorePattern` helper.

## 012 — `packages/db`/`packages/types` compiled as ESM, silently broke `apps/api`'s CJS `require()`
**Symptom:** `node dist/server.js` (the compiled production build — never exercised before Step 7, since `pnpm dev` uses `tsx watch`) throws `TypeError: Cannot read properties of undefined (reading '$connect')`. `require("@codeiq/db")`'s returned object was missing the `prisma` named export even though `Object.keys()` showed the `export * from "@prisma/client"` re-exports.
**Root cause:** `packages/db` and `packages/types` had no `module`/`moduleResolution` override in their own `tsconfig.json`, so they inherited `module: "ESNext"` from `@codeiq/config/tsconfig.base.json` and compiled to `export const ...` syntax. `apps/api`'s own `tsconfig.json` overrides to `module: "Node16"` (CJS) — see pitfall #007, same ADR. Node 22+'s `require()`-of-ESM interop loaded the file but only surfaced re-exported bindings, not the package's own top-level `const`. Neither package had a `build` script either — `main`/`types` pointed straight at `./src/index.ts`, so this was invisible until something actually ran `dist/server.js` instead of `tsx`.
**Fix:** Both packages now: (1) have a `"build": "tsc -p tsconfig.json"` script (`packages/db`'s also runs `prisma generate` first), (2) `package.json` `main`/`types` point at `./dist/index.js`/`./dist/index.d.ts`, (3) `tsconfig.json` overrides `module`/`moduleResolution` to `Node16`, matching `apps/api`. Any future workspace package meant to be `require()`d from `apps/api` must use the same CJS override — the base config's ESM default is a trap for this specific repo.

## 013 — Prisma 7 removed `datasource.url` from schema.prisma; classic Rust-engine client replaced by driver adapters
**Symptom:** `prisma generate`/`migrate` throws `Error: Prisma schema validation - (get-config wasm) ... The datasource property 'url' is no longer supported in schema files` after upgrading `prisma`/`@prisma/client` from `^5.20.0` to `^7.9.1`.
**Root cause:** Prisma 6+ moved the connection URL out of `schema.prisma` entirely — it belongs in `prisma.config.ts` (for the CLI: migrate/studio/generate) and is passed explicitly to the `PrismaClient` constructor via a driver adapter (for the runtime), not resolved from `env("DATABASE_URL")` inside the schema anymore.
**Fix:** `packages/db/prisma/schema.prisma`'s `datasource db` block now has only `provider = "postgresql"`, no `url`. `packages/db/prisma.config.ts` (new) loads `apps/api/.env` and passes `datasource.url` to `defineConfig()` for CLI commands. `packages/db/src/index.ts` constructs `new PrismaPg({ connectionString: process.env.DATABASE_URL })` (from `@prisma/adapter-pg`) and passes it as `PrismaClient({ adapter })`. This also means `process.env.DATABASE_URL` must already be populated by the time `@codeiq/db` is first imported (module-evaluation time, not lazily at `$connect()` like before) — `apps/api/src/server.ts` imports `"dotenv/config"` as its very first statement, ahead of everything else, to guarantee this.

## 014 — `prisma.config.ts` must not hard-fail when `DATABASE_URL` is absent, or Docker builds break
**Symptom:** `docker build` fails at the `pnpm turbo run build` step with `Failed to load config file ... Error: DATABASE_URL is required`, even though the same build worked fine locally.
**Root cause:** `apps/api/.env` is deliberately excluded from the Docker build context (`.dockerignore` — never bake secrets into an image layer), so `prisma.config.ts`'s `dotenv.config({ path: '../../apps/api/.env' })` finds nothing inside Docker. `prisma generate` (part of `@codeiq/db`'s `build` script, which every Docker build runs) doesn't actually need a live database connection — only `migrate`/`studio`/`db push` do — but an eager `if (!databaseUrl) throw ...` at the top of the config file fails regardless of which subcommand is running.
**Fix:** Fall back to a syntactically-valid-but-unusable placeholder URL (`postgresql://unset:unset@localhost:5432/unset`) instead of throwing when `DATABASE_URL` isn't resolvable. `generate` never touches it; `migrate`/`studio` run with a real `apps/api/.env` present locally and get Postgres's own connection-refused error if they don't — a clear enough signal without needing a custom guard.

## 015 — `pnpm install --prod` in the same directory as a prior full install doesn't shrink the Docker image
**Symptom:** Removing `@prisma/client` from runtime dependencies (after switching to the driver-adapter client, pitfall #013) had zero effect on the final image size — stayed at 964MB. `docker run ... sh -c "du -sh node_modules/.pnpm/*"` showed `prisma` (CLI, 42MB), `@prisma/studio-core` (42MB), `turbo` (35MB), `typescript` (22MB) and other devDependencies still physically present, even though their top-level `node_modules/<pkg>` symlinks were correctly gone.
**Root cause:** `pnpm install --prod --frozen-lockfile`, run in a directory that already has a full (dev+prod) `node_modules/.pnpm` from an earlier `pnpm install`, only updates which packages are *symlinked* into `node_modules/` — it doesn't garbage-collect package contents already fetched into the local virtual store. The orphaned content still gets copied into the image by a later `COPY --from=builder /app .`.
**Fix:** `apps/api/Dockerfile` now has a separate `installer` stage that runs `pnpm install --prod --frozen-lockfile` in a *fresh* directory (only `out/json/` + `pnpm-lock.yaml` copied in, never the full dev install) — devDependency content is never fetched there in the first place. Compiled output (`dist/`, and `packages/db/generated/` — see pitfall #013's fixed Prisma Client output path) is copied in separately from the `builder` stage. Dropped the image from 964MB to 317MB — smaller than the original Prisma 5 image (664MB), since driver adapters also eliminate the native query-engine binary.
