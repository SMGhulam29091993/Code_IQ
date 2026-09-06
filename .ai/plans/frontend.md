# Frontend Plan
> Screen-by-screen build order. One screen reaches `completed` before the next begins.

## Step 1 — Foundation [ complete ]
- [x] Next.js 14 App Router scaffold
- [x] Tailwind config with design tokens from `knowledge/technical/frontend/design-system.md`
- [x] shadcn/ui primitives — hand-written `Button.tsx`/`Input.tsx` (cva + `components.json`), not run via the interactive CLI; swap in real `shadcn add` output later if desired
- [x] `lib/api.ts`: axios instance + auth interceptor (see `knowledge/technical/frontend/state-conventions.md`)
- [x] `lib/query-keys.ts`: centralised query key factory
- [x] `store/auth.store.ts`: Zustand auth store, persisted as two discrete localStorage keys (`auth-token`, `auth-refresh`) per the state-conventions doc, not a single `persist()` blob — rehydrating them on load is the Step 2 AuthProvider's job
- [x] `store/installation.store.ts`: active installation
- [x] `components/layout/Sidebar.tsx`
- [x] `components/ui/ErrorBanner.tsx`, `LoadingSkeleton.tsx`
- [x] `(dashboard)/layout.tsx`: auth guard + sidebar (guard bounces to `/login` until Step 2's AuthProvider rehydrates a persisted session)
- [x] `(auth)/layout.tsx`: unauthenticated layout
- Note: no root `app/page.tsx` yet — actual screens start Step 2.
- Verified: `pnpm install`, `typecheck`, `build`, and `lint` all pass clean for `@codeiq/web`.

## Step 2 — Auth screens [ complete ]
- [x] `(auth)/login/page.tsx` + `LoginForm.tsx` (react-hook-form + Zod)
- [x] `(auth)/register/page.tsx` + `RegisterForm.tsx` — two-step (register → OTP verify), not
  one-step as `knowledge/screens/auth-screens.md` originally (incorrectly) documented; see that
  file's "Two-step flow, not one" note
- [x] `hooks/useAuth.ts` — thin pass-through hook per `knowledge/technical/frontend/
  hooks-and-utils.md`; `(dashboard)/layout.tsx` now uses it instead of `useAuthStore` directly
- [x] `components/providers/AuthProvider.tsx`: rehydrates `token`/`refreshToken` from
  localStorage on mount (no `user` — no `GET /auth/me` endpoint exists to refetch it), gates
  rendering of `children` until hydration completes (avoids a race with `(dashboard)/layout.tsx`'s
  own mount-time guard effect), listens for `storage` events for multi-tab logout. The
  `hooks-and-utils.md` sketch for this component never actually implemented the rehydration —
  fixed there too.
- [x] `store/auth.store.ts`: added a `rehydrate(token, refreshToken)` action (rehydrate is
  read-from-localStorage → store; `login` is store → localStorage — different directions,
  different action)
- [x] `lib/password-strength.ts`: visual-only weak/medium/strong heuristic for Register
- [x] Unit tests: `store/__tests__/auth.store.test.ts` (7), `hooks/__tests__/useAuth.test.ts`
  (3), `components/providers/__tests__/AuthProvider.test.tsx` (5)
- [x] Component tests: `LoginForm.test.tsx` (14), `RegisterForm.test.tsx` (13) — MSW handlers
  added to `mocks/handlers.ts`/`mocks/fixtures.ts`
- [x] `vitest.config.ts`: added the `@` → repo-root path alias (existed in `tsconfig.json` but
  not wired into Vite, so `@/...` imports failed at test-run time) and
  `NEXT_PUBLIC_API_URL: ""` (unset in the test env otherwise, which broke MSW handler matching
  — axios built literal `"undefined/api/..."` request URLs)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, and `pnpm test` (42/42) all pass clean
  for `@codeiq/web`. Also actually run in a browser (Playwright, headless — no `chromium-cli`
  available in this environment) against the real backend API, not just tested against mocks —
  this caught two real bugs neither typecheck nor the mocked tests would have: (1) `apps/web/.env`
  never existed, only `.env.example`, so `NEXT_PUBLIC_API_URL` was `undefined` at runtime; (2)
  `lib/api.ts`'s response interceptor retried-and-redirected on *any* 401, including a failed
  `/auth/login` call itself — a wrong-password attempt got silently rewritten into a hard
  navigation to `/login?reason=session_expired`, wiping the form and the intended error banner.
  Fixed by excluding `/auth/{login,register,verify-otp,refresh}` from the interceptor's
  refresh-and-retry logic. Separately, found and fixed the same root bug (react-hook-form's
  `formState.isSubmitting` only reflects the `onSubmit` handler's own promise, not an
  un-awaited `mutation.mutate()` call inside it) in both `LoginForm` and `RegisterForm` —
  submit buttons re-enabled instantly instead of staying disabled through the request; both now
  key off the mutation's own `isPending`.
- Domain: `knowledge/domains/auth.md` (frontend section) — unchanged, contract already matched
  what got built. `knowledge/screens/auth-screens.md` and
  `knowledge/technical/frontend/hooks-and-utils.md` updated (see notes above).

> Steps 3–7 rewritten 2026-08-23 against the Claude Design mockup `CodeIQ Dashboard.dc.html` —
> screen set, IA (tabs vs. separate routes), and layouts below now match it; see
> `knowledge/screens/{onboarding,dashboard,billing}-screens.md` for full AC/pseudocode/tests per
> screen and `knowledge/domains/billing.md` for the 3 new endpoints Step 7 now depends on.

## Step 3 — Onboarding [ complete ]
- [x] `(dashboard)/onboarding/page.tsx`: 3-step flow (Install App → Choose repos → Open a PR)
- [x] `components/onboarding/{OnboardingSteps,InstallStep,ChooseReposStep,OpenPrStep,StepShell}.tsx`
- [x] Installation saved via existing `POST /github/install`; repo activation via existing
  `POST /repos/:id/activate`
- [x] `NEXT_PUBLIC_GITHUB_APP_SLUG` added (`.env`/`.env.example`) — needed to build the
  `github.com/apps/<slug>/installations/new` install link; no App slug env var existed before
- [x] `hooks/{useInstallations,useRepos,useReviews,useBilling}.ts` implemented for real (were
  pseudocode-only in `hooks-and-utils.md`); `@codeiq/types` grew `Repo`/`RepoConfig`/`Review`/
  `ReviewIssue`/billing shapes; `lib/utils.ts` grew `getErrorMessage`/`formatTimeAgo`/`groupBy`/
  `getSeverityColor`/`isValidGlob` (all documented in `hooks-and-utils.md` but unimplemented)
- [x] Component test: `OnboardingSteps.test.tsx` (4)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all pass for `@codeiq/web`
- Domain: `knowledge/domains/github-app.md`, `knowledge/domains/repos.md`
- Screen: `knowledge/screens/onboarding-screens.md`

## Step 4 — Dashboard overview [ complete ]
- [x] `(dashboard)/overview/page.tsx`
- [x] `components/dashboard/StatsGrid.tsx`: 4 stat cards (Total Reviews/Issues Found/Critical
  Issues/Active Repos — **not** the mockup's Reviews-this-week/Median-review/Failed-reviews set;
  see the screen doc's mockup note for why — no delta badges either, no historical comparison
  data exists)
- [x] `components/dashboard/RecentReviewsList.tsx`: last 5 reviews, own empty/error state
- [x] `components/dashboard/IssuesByCategory.tsx`: category breakdown bars (replaces the
  originally-planned `PendingActionItems.tsx`, cut — no mockup reference, no distinct data)
- [x] `components/reviews/{ReviewCard,StatusBadge}.tsx`: shared row component, reused by Steps
  5 and 6 too — `GET /reviews` (list) has no per-review severity counts, so list rows show
  status only, not the mockup's crit/warn/info chips (those need `GET /reviews/:id`)
- [x] loading.tsx + error.tsx; each section (stats/recent/category) loads and fails independently
- [x] Component test: `OverviewContent.test.tsx` (4) — caught and fixed an MSW handler-ordering
  bug (`/api/reviews/:reviewId` was swallowing `/api/reviews/stats`)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all pass for `@codeiq/web`
- Domain: `knowledge/domains/review.md`
- Screen: `knowledge/screens/dashboard-screens.md` ("Screen: Overview")
- Note: mockup's "editorial" overview treatment is documented but not built — "standard" only

## Step 5 — Repos screens [ complete ]
- [x] `(dashboard)/repos/page.tsx`: repo list with active/inactive/search filters, optimistic
  activate/deactivate toggle, proactive + reactive (403) plan-limit banner
- [x] `components/repos/{RepoCard,PlanLimitBanner,ReposList}.tsx`
- [x] `(dashboard)/repos/[repoId]/page.tsx`: **one page, 3 tabs** (Configuration/Reviews/
  Insights) — replaces the old two-route (`/settings`) design
- [x] `components/repos/{RepoDetailTabs,RepoConfigPanel,RepoReviewsPanel,RepoInsightsPanel}.tsx`
- [x] Insights tab ships only what's real: issues-per-PR (derived) + severity/category
  breakdown — the mockup's "most flagged path"/"fix rate" have no schema backing (see the
  screen doc's Insights-tab note)
- [x] All edge cases: loading, error (403/404), empty, plan limit warning
- [x] Component tests: `ReposList.test.tsx` (6), `RepoConfigPanel.test.tsx` (4)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all pass for `@codeiq/web`
- Domain: `knowledge/domains/repos.md` (includes new `GET /repos/:repoId`, added same session)
- Screen: `knowledge/screens/dashboard-screens.md` ("Screen: Repo Detail")

## Step 6 — Reviews screens [ complete ]
- [x] `(dashboard)/reviews/page.tsx`: full review list, status+repo filters and pagination
  reflected in the URL, Retry on FAILED
- [x] `(dashboard)/reviews/[reviewId]/page.tsx`: **Split layout** (file rail + issue panel) —
  Stream layout stays documented but unbuilt this pass
- [x] `components/reviews/{ReviewFiltersBar,Pagination,ReviewsList,ReviewHeader,FileRail,
  IssueCard,ProcessingState,ReviewDetailContent}.tsx`
- [x] No `DiffSnippet.tsx`/`SeverityBadge.tsx`/`CategoryBadge.tsx` — `ReviewIssue` has no diff
  field in the schema (dropped, see `IssueCard`'s inline note), severity/category render as
  plain labelled pills inline rather than as separate components (no reuse need beyond IssueCard)
- [x] Polling for PENDING/RUNNING reviews (`useReview`'s `refetchInterval`)
- [x] Dismiss button rendered inert (no API — schema gap, see `knowledge/domains/review.md`)
- [x] Client-side severity filter on the detail page
- [x] Component tests: `ReviewsList.test.tsx` (5), `ReviewDetailContent.test.tsx` (5)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all pass for `@codeiq/web`
- Domain: `knowledge/domains/review.md`
- Screen: `knowledge/screens/dashboard-screens.md` ("Screen: Review Detail")

## Step 7 — Billing screen [ complete ]
- [x] Backend first: `GET /billing/{subscription,seats,invoices}` (`knowledge/domains/
  billing.md`) — added same session, `apps/api` Part B, 296/296 API tests passing
- [x] `(dashboard)/billing/page.tsx`: `PlanCards`, `SeatsPanel`, `NextInvoiceCard`, `InvoicesList`
- [x] Checkout redirect flow (existing `POST /billing/checkout`); Billing portal redirect
  (existing `POST /billing/portal`)
- [x] FREE-tier empty state when `GET /billing/subscription` 400s; `?success=true` banner
- [x] Plan pricing/limits render from `GET /billing/plans` (real numbers) — not the mockup's
  placeholder pricing, see the screen doc's pricing note
- [x] Component test: `BillingContent.test.tsx` (7)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all pass for `@codeiq/web`
- Domain: `knowledge/domains/billing.md`
- Screen: `knowledge/screens/billing-screens.md`
- **This completes the CodeIQ Dashboard mockup implementation** (2026-08-23) — Steps 3–7 all
  shipped in one session, screen by screen, each committed separately. 77/77 frontend tests,
  296/296 backend tests, clean typecheck/lint/build on both apps.

## Step 8 — Account & Workspace settings [ complete ]
> Not part of the mockup — added per explicit user request for "account management" after
> Step 7. Covers both meanings raised: personal profile (new) and workspace/installation
> settings (previously spec'd as `/workspace` in `billing-screens.md`, never built — see
> `knowledge/screens/account-screens.md`, which now owns both as tabs of one `/account` route).
- [x] Backend first: `GET /auth/me`, `PATCH /auth/me`, `POST /auth/change-password`
  (`knowledge/domains/auth.md`) — nothing exposed a user's own profile before this
- [x] `(dashboard)/account/page.tsx`: 2 tabs (Profile / Workspace), same tabbed-page pattern as
  Repo Detail
- [x] `components/account/{AccountTabs,ProfileForm,ChangePasswordForm,WorkspacePanel,
  DangerZone}.tsx`
- [x] `ChangePasswordForm` hidden entirely for GitHub-only accounts (`user.githubId` set) —
  matches the backend's own rejection of that case
- [x] Workspace tab reuses `DELETE /github/installations/:id` (already existed, never had a
  frontend) — redirects to `/onboarding` on delete, not the old placeholder `/install`
- [x] `components/layout/Sidebar.tsx`: add "Account" nav item
- [x] Component test: `AccountTabs.test.tsx` (9)
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` all pass for `@codeiq/web`;
  live browser verification (profile edit, wrong/correct change-password, Workspace tab,
  danger-zone confirm dialog) — see `state/completed.md` 2026-08-23 entry
- Domain: `knowledge/domains/auth.md`, `knowledge/domains/github-app.md`
- Screen: `knowledge/screens/account-screens.md`

## Step 9 — Polish [ complete ]
- [x] `app/error.tsx` (catches (auth) screens + root "/" — every (dashboard) screen already had
  its own per-route error.tsx since Step 3–7) + `app/global-error.tsx` (catches errors inside
  `app/layout.tsx` itself; must render its own `<html>/<body>` and can't rely on next/font
  variables or Tailwind classes, so it's plain inline styles)
- [x] `components/providers/PageTransition.tsx`: framer-motion fade+rise keyed by pathname,
  wraps `{children}` inside `(dashboard)/layout.tsx`'s `<main>`; respects
  `prefers-reduced-motion` via `useReducedMotion` (collapses to an instant swap, same layout)
- [x] Mobile responsiveness (375px): `(dashboard)/layout.tsx` + `Sidebar.tsx` — sidebar becomes
  an off-canvas drawer below `lg` (fixed, slide-in, backdrop, Escape-to-close, auto-closes on
  navigation) behind a hamburger button in a mobile-only top bar, instead of the always-visible
  224px column. Repos List and Reviews List's 5-column tables wrapped in `overflow-x-auto` +
  `min-w-[640px]` so they scroll instead of crushing illegibly. Every two-column panel
  (StatsGrid, RepoConfigPanel, ReviewDetailContent's file rail, BillingContent, PlanCards,
  RepoInsightsPanel) already had a `grid-cols-1` mobile fallback from Steps 4–7 — no changes
  needed there.
- [x] Keyboard navigation audit: `DangerZone`'s inline confirm dialog now moves focus to Cancel
  when it opens and closes on Escape (it's a plain div, not a native `<dialog>`, so neither was
  automatic); the mobile nav drawer also closes on Escape. Everything else audited was already
  keyboard-operable (custom row components use `role="button"` + `tabIndex` + Enter-to-activate
  + `aria-label`; `Button` has a visible `focus-visible` ring) — see the axe pass below for what
  the audit actually turned up beyond that.
- [x] axe-core accessibility pass: `jest-axe`'s `toHaveNoViolations` matcher registered globally
  in `vitest.setup.ts`; one `axe(container)` test added to each of the 9 screen-level test files
  (Overview, Repos List, Reviews List, Review Detail, Billing, Account, Repo Config, Onboarding,
  Login/Register forms). Found and fixed 2 real violations, not just added passing tests:
  1. `RepoConfigPanel`'s two toggle switches (`role="switch"`) had no accessible name —
     added `aria-label={s.label}`.
  2. `RepoCard`'s row was `role="button"` wrapping a real `<button>` toggle — an axe
     "nested-interactive" violation (screen readers can't sensibly represent a control inside a
     control). Restructured: only the navigable cells are now wrapped in a `<button>` styled
     with `contents` (drops out of the CSS Grid box model, so its children still lay out as
     direct grid items) — the toggle button is a sibling, not a descendant. Updated the one
     `ReposList.test.tsx` case that queried the toggle as a DOM descendant of the row.
  New dev dependency: `@types/jest-axe` (`jest-axe` itself already existed but had no type
  declarations, which broke `next build`'s type-check step once `vitest.setup.ts` imported it).
- Verified: `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm test` (96/96) all pass for
  `@codeiq/web`; monorepo-wide `pnpm turbo run typecheck lint build test` clean (all 5
  packages). Live browser verification (Playwright, against a local `pnpm dev` API + a fresh
  seeded user/installation/repos/reviews — the running `api-api-1` Docker container predated
  Step 8 and 404'd on `/auth/me` and 500'd on `/reviews/stats`, so it was stopped for this pass,
  same as prior sessions' pattern): mobile drawer open/close/Escape/auto-close-on-nav at 375px,
  desktop sidebar unchanged at 1440px, repos/reviews tables scroll instead of crushing at 375px,
  a temporary throwing test route confirmed `app/error.tsx` renders correctly (then deleted),
  and the DangerZone focus-on-open + Escape-to-close behavior. No console/page errors beyond the
  same two documented sandbox-credential gaps from prior sessions (no real Stripe subscription →
  `GET /billing/subscription` 400s; no real GitHub App installation → `GET /billing/seats` 502s).
