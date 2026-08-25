# Completed
> Append-only. Newest at top.

## 2026-08-25 (Frontend Step 9 — Polish)
- User asked to verify the dashboard UI + APIs were complete, then to "start building" — Step 9
  (Polish) was the one remaining `not-started` item in `plans/frontend.md`, so built it in full:
  root error boundaries, Framer Motion page transitions, a keyboard-nav audit, an axe-core
  accessibility pass, and mobile responsiveness at 375px. Frontend-only — no backend changes.
  1. **`app/error.tsx` + `app/global-error.tsx`** — no route segment above the individual
     `(dashboard)/*` pages had an error boundary before this, so (auth)/login,
     (auth)/register, and root "/" had none. `global-error.tsx` renders its own `<html>/<body>`
     (Next.js requirement — it replaces the root layout on error) with inline styles, since
     next/font variables and Tailwind classes aren't available at that point.
  2. **`components/providers/PageTransition.tsx`** — framer-motion fade+rise keyed by pathname,
     wraps `(dashboard)/layout.tsx`'s `{children}`; respects `prefers-reduced-motion` via
     `useReducedMotion` (collapses to an instant, motion-free swap rather than skipping the
     wrapper, so layout stays identical either way). `framer-motion` was already a dependency,
     unused until now.
  3. **Mobile responsiveness** — `Sidebar.tsx` gained an optional `onNavigate` prop;
     `(dashboard)/layout.tsx` rebuilt around it: below `lg`, the sidebar becomes a fixed
     off-canvas drawer (slide-in, backdrop, Escape-to-close, auto-closes on navigation) behind a
     hamburger button in a mobile-only top bar, replacing the always-visible 224px column that
     made every screen unusable under ~1024px. Repos List and Reviews List's 5-column tables
     wrapped in `overflow-x-auto` + `min-w-[640px]` so they scroll instead of crushing
     illegibly. Every two-column panel built in Steps 4–7 (StatsGrid, RepoConfigPanel,
     ReviewDetailContent's file rail, BillingContent, PlanCards, RepoInsightsPanel) already had
     a `grid-cols-1` mobile fallback — nothing to change there.
  4. **Keyboard-nav audit** — found `DangerZone`'s inline confirm dialog (a plain div, not a
     native `<dialog>`) had no focus management: added focus-on-open (moves to Cancel) and
     Escape-to-close; the new mobile drawer got the same Escape handling. Everything else
     audited was already keyboard-operable from Steps 3–7 (custom row components use
     `role="button"` + `tabIndex` + Enter-to-activate + `aria-label`; `Button` already had a
     visible `focus-visible` ring).
  5. **axe-core pass** — registered `jest-axe`'s `toHaveNoViolations` matcher globally in
     `vitest.setup.ts`, added one `axe(container)` test to each of the 9 screen-level test
     files. Found 2 real violations, not just passing tests: `RepoConfigPanel`'s two toggle
     switches had no accessible name (`aria-label` added); `RepoCard`'s row was `role="button"`
     wrapping a real `<button>` toggle — a "nested-interactive" violation. Fixed by wrapping only
     the navigable cells in a `<button className="contents">` (drops out of the CSS Grid box
     model so its children still lay out as direct grid items) so the toggle is a sibling, not a
     descendant — updated the one `ReposList.test.tsx` case that queried the toggle as a DOM
     descendant of the row to match. New dev dependency: `@types/jest-axe` (`jest-axe` itself
     had no type declarations, which broke `next build`'s type-check step once
     `vitest.setup.ts` imported it — invisible to `vitest` itself, which doesn't type-check).
  96/96 `@codeiq/web` tests, monorepo-wide `pnpm turbo run typecheck lint build test` clean
  (311/311 `@codeiq/api` unaffected). **Live browser verification**: found the running
  `api-api-1` Docker container predated Step 8 (404 on `/auth/me`, 500 on `/reviews/stats`),
  stopped it and ran `apps/api` via its own `pnpm dev` instead (same pattern as prior sessions);
  seeded a second throwaway user directly into Postgres (`verify@codeiq.dev`'s password was
  changed by Step 8's own live test and is no longer `TestPass123!`); drove the app with a fresh
  Playwright install (scratchpad, not the repo) at 375px and 1440px — mobile drawer open/close/
  Escape/auto-close-on-nav, tables scrolling instead of crushing, desktop layout unchanged, a
  temporary throwing test route (added, screenshotted, then deleted) confirming `app/error.tsx`
  renders correctly, and the DangerZone focus/Escape behavior. Also hit and diagnosed a Next.js
  14 dev-server flake unrelated to this change (rapid client-side navigation right after a fresh
  `.next` boot intermittently 404s a route that compiles and serves fine on retry after a clean
  `.next` rebuild) — not a regression, just dev-mode route-cache flakiness. No console/page
  errors beyond the two already-documented sandbox-credential gaps (`GET /billing/subscription`
  400s with no real Stripe subscription; `GET /billing/seats` 502s with no real GitHub App
  installation to query). `.ai/plans/frontend.md` Step 9 marked complete; `state/current.md`
  updated, including the stale-password correction above.

## 2026-08-23 (Mockup-fidelity pass — sidebar, headers, tables, real Overview widgets)
- User pushback ("you are still missing a lot of details") after Step 8, with a screenshot of
  the mockup's Design Notes screen — its sidebar showing a footer (installation switcher + user
  row) that Step 1's original scaffold never built. Re-read the mockup's raw HTML directly
  (still cached in the scratchpad from the original import) rather than relying on memory, and
  found several real structural gaps across every screen, not just the sidebar:
  1. **Sidebar** (`components/layout/Sidebar.tsx`): added the footer (installation switcher
     linking to `/account?tab=workspace`, user row from the new `GET /auth/me`) and real nav
     badge counts (repo count, review total — not the mockup's static 6/48).
  2. **Every dashboard page was missing its breadcrumb + header CTA.** New shared
     `components/layout/PageHeader.tsx` (breadcrumb + h1 + optional action), wired into all six
     pages: Overview (no CTA), Repos ("Add repositories" → `/onboarding`), Reviews ("Export CSV"
     — real client-side export via new `lib/csv.ts`, no backend endpoint needed), Billing
     ("Update payment method" → the existing billing-portal mutation), Review Detail ("Open pull
     request", moved out of an ad hoc flex row into the shared header), Account, Repo Detail,
     Onboarding (both already had one-off breadcrumbs, replaced with the shared component).
  3. **Repos List and Reviews List were plain card lists; the mockup is a real table** (header
     row + grid columns). Rebuilt both: `RepoCard`/`RepoTableHeader` share `REPO_GRID_COLS`,
     new `ReviewTableRow`/`ReviewTableHeader` for the dedicated Reviews List screen specifically
     (the flex-row `ReviewCard` stays for Overview's "Recent reviews" and Repo Detail's Reviews
     tab, which use the mockup's simpler embedded-list style, not the full table).
  4. **`GET /repos` gained a real `lastReviewAt` field** — the mockup's repo table has a "Last
     review" column that the original response shape had no data for. Backend:
     `repo.repository.ts`'s `findManyForUser`/`findByIdForUser` now select the latest review's
     `createdAt` in the same query (`reviews: { take: 1, orderBy: createdAt desc }`), not a
     second round trip. `SanitizedRepo`/`@codeiq/types` `Repo` both gained the field.
  5. **Overview gained the mockup's two remaining widgets**: `RunningReviewsBanner` (real
     `GET /reviews?status=RUNNING` query, not mock state) and `SeatsCard` ("N of M seats",
     needs a real subscription — omitted entirely rather than shown broken when unsubscribed).
  6. **Repo Detail's tab order fixed** to match the mockup (Reviews, Configuration, Insights —
     Configuration stays the default *active* tab, but its position in the tab bar was wrong).
  Backend repo-lookup shape change broke 17 existing route tests that mocked `prisma.repo.*`
  directly without a `reviews` field — fixed by adding `reviews: []` to both files' `buildRepo`
  fixtures. 311/311 `@codeiq/api`, 86/86 `@codeiq/web` tests still pass (no test needed
  meaningful rewrites — most query by text/role, not DOM structure, so the table/card swap
  didn't break them). Verified live in a browser again (same seeded data): this pass found zero
  new bugs — the only console noise was the same two expected sandbox-credential gaps already
  known (no real Stripe subscription, no real GitHub App installation for the seats call).
  `knowledge/screens/dashboard-screens.md`, `knowledge/domains/repos.md`, and
  `knowledge/technical/frontend/design-system.md` updated to match.

## 2026-08-23 (Frontend Step 8 — Account & Workspace settings)
- User asked "you forgot to include the account management of user" after Step 7 — not part of
  the mockup, which has no account/settings screen at all. Clarified scope via AskUserQuestion:
  user meant **both** personal profile management (nothing existed — no docs, no API) and
  workspace/installation settings (already spec'd as `/workspace` in `billing-screens.md`,
  backend already existed via `DELETE /github/installations/:id`, just never built).
  Built both as two tabs of one `/account` route (`knowledge/screens/account-screens.md`, new),
  same tabbed-page pattern as Repo Detail — not two separate top-level sidebar entries.
  **Backend**: `GET /auth/me`, `PATCH /auth/me` (name only — email is deliberately not
  editable, documented as a real gap tied to the OTP-verification identity flow),
  `POST /auth/change-password` (rejects GitHub-only accounts with no `passwordHash`, doesn't
  revoke other sessions — also documented gaps, not silently done). 298 → 311 `@codeiq/api`
  tests.
  **Frontend**: `ProfileForm`, `ChangePasswordForm` (hidden entirely for GitHub-only accounts),
  `WorkspacePanel`, `DangerZone` (inline confirm dialog, not a shared Modal — only caller so
  far). Fixed `billing-screens.md`'s stale `/install` redirect target to the real `/onboarding`
  route along the way. 77 → 86 `@codeiq/web` tests.
  **Live browser verification** (same seeded Postgres data from Step 3–7's session): edited the
  profile name, tried a change-password with a wrong current password (got the correct inline
  error), then the correct one (form cleared, success message), viewed the Workspace tab, and
  opened + cancelled the danger-zone confirm dialog — all worked correctly on the first pass,
  zero console/page errors. No bugs found this round.

## 2026-08-23 (Frontend Steps 3–7 — CodeIQ Dashboard mockup implementation)
- Imported the Claude Design mockup `CodeIQ Dashboard.dc.html` (+ `support.js`) via the
  `claude_design` MCP and implemented it end to end in one session, committing after each part.
  Full detail lives in `plans/frontend.md` Steps 3–7 and the rewritten `knowledge/screens/
  {onboarding,dashboard,billing}-screens.md` — not duplicating it here. Headline items:
  1. **Docs first**: rewrote Repo Detail (one tabbed page, not two routes) and Review Detail
     (file-rail/issue-panel split, not an accordion) in `dashboard-screens.md`; new
     `onboarding-screens.md`; rewrote `billing-screens.md` around plan cards/seats/invoices;
     added 3 new endpoints to `knowledge/domains/billing.md` and 1 to `repos.md`; flagged the
     mockup's own three open product questions (Insights tab, issue Dismiss button, seat
     source) in `state/blockers.md` with the pragmatic default taken for each.
  2. **Backend**: `GET /billing/{subscription,seats,invoices}` (seats resolve via GitHub org
     membership, not a locally-invited list) and `GET /repos/:repoId`. Stripe SDK v22 renamed
     `retrieveUpcoming` → `createPreview` and moved `current_period_start` from the subscription
     onto its line items — both real API-surface facts discovered via typecheck, not assumed.
     296/296 `@codeiq/api` tests pass.
  3. **Frontend**: Onboarding (3-step install flow), Overview (stats/recent-reviews/category
     breakdown), Repos (list + tabbed detail), Reviews (list + split-layout detail, polling),
     Billing (plan cards/seats/invoices) — 5 screens, ~40 new components/hooks/pages. Reused
     `ReviewCard`/`StatusBadge` across 3 screens rather than duplicating row rendering. Found
     and fixed a real MSW handler-ordering bug (`/api/reviews/:reviewId` was greedily matching
     `/api/reviews/stats`). 77/77 `@codeiq/web` tests pass; every screen individually
     `typecheck`/`lint`/`build`/`test` verified before moving to the next.
  Several mockup-vs-reality gaps resolved by building against what's real rather than what the
  mockup's mock data showed: Overview's stat cards use real `GET /reviews/stats` fields (no
  week-over-week delta — no historical data exists); list-view review rows show status only (no
  per-review severity counts — `GET /reviews` doesn't return them); `IssueCard` has no diff
  snippet (`ReviewIssue` has no diff column); Billing plan cards render real pricing from
  `GET /billing/plans`, not the mockup's placeholder numbers (which conflict with the actually-
  configured Stripe prices).
  4. **Live browser verification** (CLAUDE.md's "test in a browser" rule) — seeded a real user +
     installation + repos + reviews + issues directly into the local Postgres via a throwaway
     script (registration needs an emailed OTP this sandbox can't receive), ran `apps/api` and
     `apps/web` via `pnpm dev` against it, and drove every new screen with a fresh Playwright
     install (browser binary was already cached from Step 2's session; the `playwright` npm
     package was installed into the scratchpad, not the repo). Found and fixed two real bugs
     neither typecheck nor the 373 mocked tests caught, because every mock already matched what
     the code assumed rather than what the server actually returns:
     - **`validateQuery` middleware silently discarded all `z.coerce` results.** Express 5's
       `req.query` is a non-caching getter — it re-parses `req.url` on every access, so
       `Object.assign(req.query, coerced)` mutated a throwaway object and every numeric/boolean
       query param (`page`/`limit`/`days`/`isActive`) reached Prisma as a raw string, crashing
       `GET /reviews` with a `PrismaClientValidationError` the instant a real page/limit param
       was sent — which no prior screen had ever done. Fixed by replacing the getter with
       `Object.defineProperty(req, "query", { value: result.data, ... })` instead of mutating
       it; added `validate.middleware.test.ts` (2 tests, exercises a real Express app, not a
       mocked `req.query` object) since this exact bug shape is invisible to every existing
       route/service test.
     - **`useReview`/`useRetryReview` didn't unwrap the `{ review: ... }` envelope.**
       `GetReviewResult`/`RetryReviewResult` wrap the review in a `review` key (unlike the
       `/reviews` list, which doesn't) — the hooks read `r.data.data` directly, so
       `fileGroups`'s `for (const issue of review.issues)` crashed with "filtered is not
       iterable" on every Review Detail page. Fixed the two hooks and the MSW mocks that had
       matched the same wrong shape (`mocks/handlers.ts` and both review test files).
     - Also fixed a real (if minor) cosmetic bug while looking at the Overview screen for real:
       `RecentReviewsList` showed the raw repo `cuid` instead of its full name (`ReviewCard`'s
       `repoName` prop was only ever wired up on the Reviews List screen).
     All 5 screens re-verified clean (no console/page errors) after the fixes; Billing correctly
     shows its FREE-tier empty state (real 400) and Seats correctly shows a failed-fetch state
     (real 502 — this sandbox has no real GitHub App installation to query), which is the
     designed behavior for missing credentials, not a bug. 298/298 `@codeiq/api` and 77/77
     `@codeiq/web` tests pass after the fixes. Seed data (`verify@codeiq.dev` / a fake `acme-corp`
     installation with 3 repos and 4 reviews) was left in the local dev Postgres — harmless, and
     useful for exploring the new screens; the stale `api-api-1` Docker container (built before
     this session, superseded by `pnpm dev` for this verification) was stopped, not restarted —
     rebuild it (`docker compose build api`) to pick up this session's backend changes before
     relying on it again.

## 2026-08-23 (Frontend Step 2 — Auth screens)
- Built login and register screens end to end: `(auth)/login/page.tsx` + `LoginForm.tsx`,
  `(auth)/register/page.tsx` + `RegisterForm.tsx`, `components/providers/AuthProvider.tsx`,
  `hooks/useAuth.ts`, `lib/password-strength.ts`, an `auth.store.ts` `rehydrate` action, and 42
  new tests (store, hook, AuthProvider, both forms) — full detail and every discovered bug is in
  `plans/frontend.md` Step 2 and `knowledge/screens/auth-screens.md`; not duplicating it here.
  Headline items: `knowledge/screens/auth-screens.md`'s Register spec assumed `POST
  /auth/register` returns tokens directly — it doesn't (two-step OTP flow) — so that pseudocode
  would have shipped a screen that's broken against the real API; built the correct two-step
  flow instead and fixed the doc. Actually ran the app in a headless browser (Playwright,
  installed fresh — no `chromium-cli` in this environment) against the real backend, not just
  the mocked test suite, which caught two real bugs neither typecheck nor mocks would have:
  `apps/web/.env` never existed (only `.env.example`), and `lib/api.ts`'s response interceptor
  was retrying-and-redirecting on *any* 401 including a failed login attempt itself, silently
  turning "wrong password" into a hard navigation to `/login?reason=session_expired` that wiped
  the form and the intended error banner. Also found the same root bug (react-hook-form's
  `isSubmitting` not reflecting an un-awaited `mutation.mutate()` call) independently in both
  forms via the component tests actually failing, not by inspection.
  Not committed on its own branch yet — sitting in the working tree as of this entry. Full
  `pnpm typecheck`/`lint`/`build`/`test` (42/42) clean for `@codeiq/web`, and the whole
  monorepo's `build`/`typecheck`/`lint` + `@codeiq/api` test suite (274/274) re-verified clean
  after the `packages/types` addition (`AuthTokensResult`, `RegisterResult`).

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
