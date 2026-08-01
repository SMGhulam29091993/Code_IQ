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

## Step 2 — Auth screens [ not-started ]
- [ ] `(auth)/login/page.tsx` + form (react-hook-form + Zod)
- [ ] `(auth)/register/page.tsx` + form
- [ ] `AuthProvider` component: rehydrate token on mount, listen to storage event for multi-tab logout
- [ ] Unit tests for auth store
- [ ] Component tests for login + register forms
- Domain: `knowledge/domains/auth.md` (frontend section)

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
