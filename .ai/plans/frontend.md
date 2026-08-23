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

## Step 3 — Install flow [ not-started ]
- [ ] `(dashboard)/install/page.tsx`: "Install GitHub App" CTA → redirect to GitHub
- [ ] GitHub OAuth callback handler
- [ ] Installation saved via `POST /github/install`
- Domain: `knowledge/domains/github-app.md`

## Step 4 — Dashboard overview [ not-started ]
- [ ] `(dashboard)/overview/page.tsx`
- [ ] `components/dashboard/StatsGrid.tsx`: 4 stat cards (meetings, hours, action items, queries)
- [ ] `components/dashboard/IssuesTrendChart.tsx`: recharts LineChart
- [ ] Recent reviews list (last 5)
- [ ] Pending action items widget
- [ ] loading.tsx + error.tsx + empty state

## Step 5 — Repos screens [ not-started ]
- [ ] `(dashboard)/repos/page.tsx`: repo list with activate/deactivate toggles
- [ ] `components/repos/RepoCard.tsx`
- [ ] `(dashboard)/repos/[repoId]/page.tsx`: repo detail + review history
- [ ] `(dashboard)/repos/[repoId]/settings/page.tsx`: per-repo config form
- [ ] All edge cases: loading, error, empty, plan limit warning
- Domain: `knowledge/domains/repos.md`

## Step 6 — Reviews screens [ not-started ]
- [ ] `(dashboard)/reviews/page.tsx`: full review list with filters + pagination
- [ ] `components/reviews/ReviewCard.tsx`
- [ ] `(dashboard)/reviews/[reviewId]/page.tsx`: review detail
- [ ] `components/reviews/DiffViewer.tsx`: syntax highlighted
- [ ] `components/reviews/CommentThread.tsx`: issues grouped by file
- [ ] `components/reviews/SeverityBadge.tsx`, `CategoryBadge.tsx`
- [ ] Retry button for FAILED reviews
- [ ] Polling for PENDING/RUNNING reviews (`refetchInterval: 5000`)
- Domain: `knowledge/domains/review.md`

## Step 7 — Billing screen [ not-started ]
- [ ] `(dashboard)/billing/page.tsx`: plan cards, current plan banner, seat manager
- [ ] Checkout redirect flow
- [ ] Billing portal redirect
- Domain: `knowledge/domains/billing.md`

## Step 8 — Polish [ not-started ]
- [ ] Framer Motion page transitions
- [ ] Keyboard navigation audit
- [ ] axe-core accessibility pass on every page
- [ ] Mobile responsiveness (min-width: 375px)
- [ ] Error boundary at root layout
