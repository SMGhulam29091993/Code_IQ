# Screens: Dashboard (Overview, Repos, Reviews)
> Acceptance criteria, component breakdown, pseudocode, edge cases, test cases.
> API contract: `knowledge/domains/review.md`, `knowledge/domains/repos.md`
> Source: Claude Design mockup `CodeIQ Dashboard.dc.html` (imported 2026-08-23) — the first
> concrete visual/interaction spec for these screens. The Repo Detail and Review Detail sections
> below were rewritten against it (see the two notes inline); Overview and Reviews List already
> matched. The mockup's own "Design notes" screen states its assumptions and three open product
> questions verbatim — carried into this doc where they land (Insights tab, Dismiss button,
> seats source) rather than silently resolved.

---

## Screen: Overview `/overview`

> **Mockup note (2026-08-23):** the mockup's 4 stat cards are "Reviews this week" (+12%),
> "Issues found" (+31), "Median review" (47s, -6s), "Failed reviews" (3, "2 retried") — none of
> which `GET /reviews/stats` can answer (no week-over-week delta, no review duration field, no
> retry count). Keeping this doc's original 4 cards below (Total Reviews / Issues Found /
> Critical Issues / Active Repos) since they map directly onto the real response shape
> (`knowledge/domains/review.md`) plus `GET /repos`'s active count — no delta badges, since
> there's no historical comparison data to show one honestly (not a placeholder "--").
> `PendingActionItems` and `QuickAsk` below aren't in the mockup at all; `QuickAsk` stays
> documented-but-not-built ("future"), `PendingActionItems` is cut from this pass (no mockup
> reference and no distinct data source beyond what `RecentReviewsList` already shows) — replaced
> by `IssuesByCategory` (mockup's category-breakdown panel, backed by the real
> `issuesByCategory` field).

### Components
```
(dashboard)/overview/
├── page.tsx                         ← server component shell
├── loading.tsx                      ← <OverviewSkeleton />
├── error.tsx                        ← <ErrorBanner />
└── _components/
    ├── StatsGrid.tsx                ← 4 stat cards, no delta (see mockup note above)
    ├── RecentReviewsList.tsx        ← last 5 reviews
    └── IssuesByCategory.tsx         ← category breakdown bars, from issuesByCategory
```

### Acceptance criteria
- [ ] **StatsGrid:** shows 4 cards — Total Reviews, Issues Found, Critical Issues, Active Repos
- [ ] **StatsGrid:** each card shows current value + delta vs. last 30 days
- [ ] **RecentReviewsList:** shows last 5 reviews with status badge, PR title, repo name, time ago
- [ ] **RecentReviewsList:** clicking a review navigates to `/reviews/[reviewId]`
- [ ] **PendingActionItems:** lists CRITICAL + WARNING issues from last 7 days without linked resolution
- [ ] All sections have loading skeletons
- [ ] All sections handle empty state individually (not a single empty page)
- [ ] Stats auto-refresh every 60s (`refetchInterval: 60_000`)

### Pseudocode
```
StatsGrid:
  { data: stats } = useQuery({
    queryKey: queryKeys.reviewStats({}),
    queryFn: () => api.get('/reviews/stats').then(r => r.data.data),
    refetchInterval: 60_000,
  })

  render:
    <div className="grid grid-cols-4 gap-4">
      <StatCard label="Total Reviews" value={stats.totalReviews} delta={stats.delta.reviews} />
      <StatCard label="Issues Found" value={stats.totalIssues} delta={stats.delta.issues} />
      <StatCard label="Critical Issues" value={stats.issuesBySeverity.critical} accent="red" />
      <StatCard label="Active Repos" value={stats.activeRepos} />
    </div>

RecentReviewsList:
  { data } = useQuery({
    queryKey: queryKeys.reviews({ limit: 5, page: 1 }),
    queryFn: () => api.get('/reviews', { params: { limit: 5, page: 1 } }).then(r => r.data.data),
  })

  if data.reviews.length === 0:
    render: <EmptyState icon="🔍" message="No reviews yet. Connect a repo and open a PR." />
  else:
    data.reviews.map(r => <ReviewCard review={r} onClick={() => router.push(`/reviews/${r.id}`)} />)
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| User has no installations | Overview shows empty states in all sections + "Connect GitHub" banner at top |
| Stats API fails | StatsGrid section shows `<ErrorBanner onRetry={refetch} />` (not full page error) |
| Reviews API fails | RecentReviewsList shows its own error state independently |
| All stats are 0 (new user) | Shows 0 values, no delta badge (not "--") |
| Network offline | Each section independently shows offline state |

### Test cases
```typescript
describe('StatsGrid', () => {
  it('renders 4 stat cards')
  it('shows correct values from API response')
  it('shows delta badge when delta exists')
  it('refetches every 60 seconds')
  it('shows skeleton while loading')
  it('shows error state independently when API fails')
})

describe('RecentReviewsList', () => {
  it('renders up to 5 reviews')
  it('shows empty state when no reviews exist')
  it('navigates to /reviews/[id] on card click')
  it('shows skeleton while loading')
  it('shows status badge for each review')
})

describe('OverviewPage', () => {
  it('shows connect GitHub banner when user has no installations')
  it('renders all 3 sections')
  it('each section fails and recovers independently')
})
```

---

## Screen: Repos List `/repos`

### Components
```
(dashboard)/repos/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── ReposList.tsx              ← client component, owns filters + list
    ├── RepoCard.tsx               ← single repo row with toggle
    ├── ReposListSkeleton.tsx
    └── PlanLimitBanner.tsx        ← shown when Free tier limit reached
```

### Acceptance criteria
- [ ] Lists all repos across all user installations
- [ ] Each repo shows: full name, language tag, active status toggle, review count, last review time
- [ ] Toggle activates/deactivates repo via `POST /repos/:id/activate` or `/deactivate`
- [ ] Toggle is optimistically updated (instant UI) then confirmed/rolled back on API response
- [ ] If Free tier limit reached, extra inactive repos show "Upgrade to activate" instead of toggle
- [ ] Filter bar: All / Active / Inactive
- [ ] Search input: filters repos client-side by fullName
- [ ] Clicking a repo card body (not toggle) → `/repos/[repoId]`
- [ ] Loading skeleton while fetching

### Pseudocode
```
ReposList:
  [filter, setFilter] = useState<'all'|'active'|'inactive'>('all')
  [search, setSearch] = useState('')
  { data: repos, isLoading } = useRepos()
  activateMutation = useActivateRepo()
  deactivateMutation = useDeactivateRepo()

  displayed = repos
    ?.filter(r => filter === 'all' ? true : filter === 'active' ? r.isActive : !r.isActive)
    ?.filter(r => r.fullName.toLowerCase().includes(search.toLowerCase()))

  handleToggle(repo):
    if repo.isActive:
      deactivateMutation.mutate(repo.id)
    else:
      if isOverFreeLimit && !repo.isActive:
        showUpgradeBanner()
        return
      activateMutation.mutate(repo.id)

  render: <RepoCard repo={repo} onToggle={() => handleToggle(repo)} />

RepoCard:
  // Optimistic update via useMutation onMutate
  useActivateRepo = () => useMutation({
    mutationFn: (repoId) => api.post(`/repos/${repoId}/activate`),
    onMutate: async (repoId) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.repos() })
      const prev = queryClient.getQueryData(queryKeys.repos())
      queryClient.setQueryData(queryKeys.repos(), old =>
        old.map(r => r.id === repoId ? { ...r, isActive: true } : r)
      )
      return { prev }
    },
    onError: (_, __, ctx) => queryClient.setQueryData(queryKeys.repos(), ctx.prev),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.repos() }),
  })
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| No repos (no installation) | Empty state: "Connect GitHub to see your repos" |
| No repos (installation exists, no repos synced) | Empty state: "No repos found in your GitHub installation" |
| Activate fails (403 plan limit) | Roll back optimistic update + show `<PlanLimitBanner />` |
| Activate fails (network error) | Roll back + inline toast error |
| Search returns no results | "No repos matching your search" empty state |
| Toggle while mutation in flight | Disable toggle during pending mutation |

### Test cases
```typescript
describe('ReposList', () => {
  it('renders all repos from API')
  it('filters by active status')
  it('filters by search input (case insensitive)')
  it('shows empty state when no repos exist')
  it('navigates to /repos/[id] on card body click')
  it('shows skeleton while loading')
})

describe('RepoCard toggle', () => {
  it('optimistically sets isActive=true on activate click')
  it('rolls back optimistic update on API error')
  it('calls POST /repos/:id/activate on toggle on')
  it('calls POST /repos/:id/deactivate on toggle off')
  it('disables toggle while mutation is in flight')
  it('shows plan limit message instead of toggle when Free tier exceeded')
})
```

---

## Screen: Repo Detail `/repos/[repoId]`

> **Rewritten against the mockup (2026-08-23).** Previously documented as two routes
> (`/repos/[repoId]` for stats/history + `/repos/[repoId]/settings` for config). The mockup
> specifies **one route, three tabs** (`repoTabs`: Reviews / Configuration / Insights) — no
> separate settings page. This doc now follows the mockup; the old two-route split is gone.

### Components
```
(dashboard)/repos/[repoId]/
├── page.tsx                     ← server component shell, reads ?tab= for initial tab
├── loading.tsx
├── error.tsx
└── _components/
    ├── RepoDetailTabs.tsx        ← owns active tab (`config` default), renders one of the below
    ├── RepoConfigPanel.tsx       ← severity radio + category pills + ignore patterns + switches + save
    ├── RepoReviewsPanel.tsx      ← reviews scoped to this repo (reuses ReviewCard from Reviews screen)
    └── RepoInsightsPanel.tsx     ← 3 metric cards, see "Insights tab" note below
```

Header (shared with every dashboard screen's `<main>` header): breadcrumb = repo full name,
title = "Repository settings", no header CTA for this screen.

### Acceptance criteria — tabs shell
- [ ] Fetches the repo via `GET /repos/:repoId` (see `knowledge/domains/repos.md` — new endpoint)
- [ ] 3 tabs: Reviews / Configuration / Insights. Default tab on load: Configuration
- [ ] Tab selection reflected in URL (`?tab=reviews`) so links are shareable
- [ ] Handles 403 (repo belongs to another user) → redirect to `/repos`
- [ ] Handles 404 (repoId not found) → Next.js `not-found.tsx`

### Acceptance criteria — Configuration tab (`RepoConfigPanel`)
- [ ] Loads current config via `GET /repos/:repoId/config`
- [ ] Severity threshold: 3-option selector (CRITICAL "blockers only" / WARNING "schema default"
  / INFO "post everything") — copy from the mockup's `sevOptions` hints, not placeholder text
- [ ] Enabled categories: toggle pills (bug, security, performance, logic, style) — click to
  add/remove, not a traditional checkbox list
- [ ] Ignore patterns: tag list (remove via `×`) + text input to add a new glob
- [ ] Two toggles: "Review draft pull requests" (hint: *"Drafts are skipped by default, to keep
  Gemini spend on work that is ready."*) and "Post a PR-level summary comment" (hint: *"One
  comment with the overall verdict, in addition to the inline comments."*)
- [ ] "Save configuration" button — PATCH on submit (only changed fields sent)
- [ ] Dirty-state label next to Save: "unsaved changes" while dirty, else "saved `<time>` by
  `<user>`" (requires no new field — derive "unsaved" from form dirty state; the "saved by" half
  needs a `RepoConfig.updatedAt`/updater, which the schema only half has — `updatedAt` exists,
  no updater column, so render "saved `<relative time>`" and drop the "by `<user>`" clause rather
  than inventing an author)
- [ ] Side panel "Effect of this config": 3 rows — issues that would've posted last week at the
  current threshold, category count + list, files skipped by ignore patterns. **This needs a new
  read to be real** (`GET /repos/:repoId/config/effect` or computed client-side from
  `GET /repos/:repoId/stats` + the draft config state) — out of scope this pass; ship the panel
  wired to `/repos/:repoId/stats` for the parts it can answer (category breakdown) and omit the
  "posted last week at this threshold" and "files skipped" rows rather than inventing numbers,
  or mark them "coming soon"
- [ ] Show inline validation: at least one category selected
- [ ] Validate glob patterns client-side (basic check: not empty, no spaces)

### Acceptance criteria — Reviews tab (`RepoReviewsPanel`)
- [ ] Lists reviews for this repo only: `GET /reviews?repoId=:repoId` (existing endpoint)
- [ ] Same row rendering as the Reviews List screen (`ReviewCard`) — reuse, don't duplicate
- [ ] Empty state: "No reviews for this repo" / *"This repository is connected but hasn't seen a
  pull request since it was added."*

### Acceptance criteria — Insights tab (`RepoInsightsPanel`)
> **Open question, carried verbatim from the mockup's own "Design notes":** *"Repo detail has a
> third tab with three metrics. If nothing is planned there, I would cut the tab rather than ship
> an empty promise."* Two of the three mockup metrics (Most flagged path, Fix rate) have no real
> data source anywhere in the current schema/API — `ReviewIssue` has no "resolved" state, so a
> fix rate can't be computed. Resolution for this pass: build the tab against what's real
> (`GET /repos/:repoId/stats`, already implemented) and show only "Issues per PR" (derivable:
> `totalIssues / totalReviews`) plus the existing severity/category breakdown as the other two
> cards, instead of the mockup's fabricated "Most flagged path" / "Fix rate" metrics. Revisit if
> product wants the mockup's exact three metrics — that needs new schema (an issue-resolution
> concept) first.

### Pseudocode
```
RepoDetailPage:
  { data: repo } = useRepo(repoId)                     // GET /repos/:repoId
  tab = searchParams.get('tab') ?? 'config'

  render:
    <RepoDetailTabs active={tab} onChange={t => router.push(`?tab=${t}`)} />
    {tab === 'config' && <RepoConfigPanel repoId={repoId} />}
    {tab === 'reviews' && <RepoReviewsPanel repoId={repoId} />}
    {tab === 'insights' && <RepoInsightsPanel repoId={repoId} />}

RepoConfigPanel:
  { data: config } = useRepoConfig(repoId)
  updateMutation = useUpdateRepoConfig(repoId)

  schema = z.object({
    severityThreshold: z.enum(['CRITICAL','WARNING','INFO']),
    enabledCategories: z.array(z.string()).min(1, 'Select at least one category'),
    ignorePatterns: z.array(z.string()),
    reviewOnDraft: z.boolean(),
    postSummaryComment: z.boolean(),
  })

  form = useForm({ resolver: zodResolver(schema), values: config })

  onSubmit(data):
    // Only send fields that changed (PATCH semantics)
    changed = Object.fromEntries(
      Object.entries(data).filter(([k, v]) => v !== config[k])
    )
    if Object.keys(changed).length === 0: return  // no-op
    updateMutation.mutate(changed)
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| repoId not found | Next.js `not-found.tsx` |
| repoId belongs to another user | Redirect to `/repos` |
| All categories unchecked | Zod error: "Select at least one category" |
| Invalid glob pattern entered | Inline error below patterns field |
| Submit with no changes | No API call (diff check) |
| API returns 403 on save | Toast error + redirect to /repos |
| Network error on save | Toast: "Failed to save. Try again." |
| No reviews for this repo yet | Reviews tab empty state (see AC above) |

### Test cases
```typescript
describe('RepoDetailPage', () => {
  it('renders repo name in header')
  it('defaults to Configuration tab')
  it('switches tabs and reflects the choice in the URL')
  it('shows skeleton while loading')
  it('redirects to /repos on 403 response')
  it('renders not-found on 404 response')
})

describe('RepoConfigPanel', () => {
  it('pre-fills form with current config values')
  it('shows error when all categories are unchecked')
  it('calls PATCH /repos/:id/config on submit')
  it('only sends changed fields in PATCH body')
  it('shows success toast on save')
  it('does not call API when nothing changed')
  it('validates glob patterns before submit')
  it('shows "unsaved changes" label while form is dirty')
})

describe('RepoReviewsPanel', () => {
  it('renders reviews scoped to this repo only')
  it('shows empty state when repo has no reviews')
})

describe('RepoInsightsPanel', () => {
  it('renders issues-per-PR derived from repo stats')
  it('renders severity and category breakdown')
})
```

---

## Screen: Reviews List `/reviews`

### Components
```
(dashboard)/reviews/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── ReviewsList.tsx            ← client, owns filters + pagination
    ├── ReviewCard.tsx             ← single row
    ├── ReviewFiltersBar.tsx       ← status filter + repo selector + search
    ├── ReviewsListSkeleton.tsx
    └── Pagination.tsx
```

### Acceptance criteria
- [ ] Lists all reviews paginated (20 per page)
- [ ] Filter by status (All / Pending / Running / Done / Failed)
- [ ] Filter by repo (dropdown of user's repos)
- [ ] Status badge (colour-coded per severity map)
- [ ] Each card shows: PR title, PR number, repo, author, issue count, severity breakdown, time ago
- [ ] "Retry" button visible on FAILED reviews — inline in card
- [ ] Pagination controls (prev / next / page numbers)
- [ ] URL reflects active filters (`?status=FAILED&repoId=xxx&page=2`)
- [ ] Filters read from URL on mount (shareable links)

### Pseudocode
```
ReviewsList:
  searchParams = useSearchParams()
  router = useRouter()

  filters = {
    status: searchParams.get('status') ?? undefined,
    repoId: searchParams.get('repoId') ?? undefined,
    page: Number(searchParams.get('page') ?? '1'),
    limit: 20,
  }

  { data, isLoading } = useReviews(filters)
  retryMutation = useRetryReview()

  updateFilter(key, value):
    params = new URLSearchParams(searchParams)
    if value: params.set(key, value)
    else: params.delete(key)
    params.set('page', '1')  // reset page on filter change
    router.push(`/reviews?${params.toString()}`)
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| No reviews for current filter | Empty state: "No reviews match your filters" + "Clear filters" link |
| Retry fails (not FAILED status) | Toast: "This review cannot be retried" |
| Page out of range (URL tampered) | Clamp to last valid page |
| repoId filter for repo belonging to another user | API returns 403 → show ErrorBanner |

### Test cases
```typescript
describe('ReviewsList', () => {
  it('renders list of reviews')
  it('shows empty state when no reviews match filter')
  it('filters by status')
  it('filters by repoId')
  it('paginates correctly')
  it('reflects filters in URL params')
  it('reads filters from URL on mount')
  it('resets page to 1 on filter change')
  it('shows Retry button only on FAILED reviews')
  it('calls POST /reviews/:id/retry on retry click')
  it('shows skeleton while loading')
})
```

---

## Screen: Review Detail `/reviews/[reviewId]`

> **Rewritten against the mockup (2026-08-23).** Previously documented as a single accordion
> (file header → expandable issue list). The mockup specifies a **two-panel "Split" layout**
> instead: a 280px file rail on the left (one row per file with issues, worst-severity tick +
> count) and the selected file's issues rendered as full cards on the right (severity+category
> header, message, unified-diff snippet, suggestion box, actions). The mockup also has a
> **"Stream" layout** (issues stacked top-to-bottom per file, no rail — reads like a written
> review) behind a header toggle; per this doc's scope, **only Split is built this pass** (it's
> the mockup's own default `revVariant`). Stream is left documented, not implemented — revisit if
> product wants both.

### Components
```
(dashboard)/reviews/[reviewId]/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── ReviewHeader.tsx        ← PR title/repo/sha/author, summary text, 4 meta stats (Files/Issues/Critical/Duration)
    ├── ProcessingState.tsx     ← shown when PENDING or RUNNING — file N of M, elapsed time, issues-so-far
    ├── FileRail.tsx            ← left column: one button per file-with-issues, selects activeFile
    ├── IssueCard.tsx           ← severity+category header, message, DiffSnippet, suggestion box, actions
    └── DiffSnippet.tsx         ← unified-diff lines (context/added/removed), monospace
```

### Acceptance criteria
- [ ] Polls every 5s when status is PENDING or RUNNING (stops on DONE/FAILED)
- [ ] Shows `<ProcessingState />` while PENDING/RUNNING: current file index/total, elapsed time,
  running issue count (this needs no new field — derive file-index/elapsed from
  `filesReviewed`/`createdAt` on the polled `Review` row; if that's too coarse, show a generic
  "Reviewing…" spinner instead of a fabricated per-file counter)
- [ ] On DONE: `ReviewHeader` (summary + 4 meta stats) + `FileRail` + selected file's `IssueCard`s
- [ ] On FAILED: full-page failed state + Retry button
- [ ] `FileRail`: one row per distinct `issue.file`, sorted by first appearance in `review.issues`;
  each row shows the file's basename + directory, issue count, and a colour tick for the worst
  severity present in that file; selecting a row shows only that file's issues
- [ ] `IssueCard`: severity pill (colour + label, never colour alone — see design-system.md's
  "severity is colour plus a word" rule), category label, `file:line` location, message, a small
  diff snippet (context/added/removed lines), a suggestion box, "View on GitHub" button, and a
  **Dismiss button that is visually present but not wired to any API call** — see the schema-gap
  note below
- [ ] "Open on GitHub" / "View on GitHub" → links to `https://github.com/{fullName}/pull/{prNumber}`
- [ ] Filter issues by severity (client-side, no API call)

### Dismiss button — documented schema gap
The mockup shows a Dismiss button on every issue card. Its own "Design notes" flags this
explicitly: *"Each issue has a Dismiss button but the schema has no state for it. Needs a
decision before build."* `ReviewIssue` has no `dismissed`/`resolvedAt` column and no API to set
one. **Do not invent a column or endpoint for this pass** — render the button (matches the
mockup visually) with no `onClick` handler, or omit it entirely; either is acceptable, but do not
wire it to a fake local-only toggle that looks persisted but isn't. Flagged in `state/blockers.md`
pending a product decision.

### Pseudocode
```
ReviewDetailPage:
  { data: review, isLoading } = useReview(reviewId)   // polls per hooks-and-utils.md useReview

  if isLoading → <ReviewDetailSkeleton />
  if review.status in ('PENDING','RUNNING') → <ProcessingState review={review} />
  if review.status === 'FAILED' → <FailedState review={review} onRetry={retryMutation.mutate} />

  fileGroups = groupBy(review.issues, 'file')   // one entry per distinct file, in first-seen order
  [activeFile, setActiveFile] = useState(0)
  activeIssues = fileGroups[activeFile].issues

  render:
    <ReviewHeader review={review} />
    <div className="grid grid-cols-[280px_1fr] gap-4">
      <FileRail groups={fileGroups} active={activeFile} onSelect={setActiveFile} />
      <div className="flex flex-col gap-4">
        {activeIssues.map(issue => <IssueCard key={issue.id} issue={issue} />)}
      </div>
    </div>
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| Review has 0 issues | "No issues found. Great work! 🎉" empty state (no file rail shown) |
| Review is FAILED | Full-page failed state with retry button |
| Retry mutation in flight | Retry button disabled, shows spinner |
| reviewId belongs to another user | API 403 → redirect to `/reviews` |
| reviewId not found | API 404 → Next.js `not-found.tsx` |
| Review has 50 issues (max) | Renders all 50 across however many files; file rail scrolls |
| Dismiss button clicked | No-op — see schema-gap note above |

### Test cases
```typescript
describe('ReviewDetailPage', () => {
  it('shows skeleton while loading')
  it('polls every 5s when status is PENDING')
  it('polls every 5s when status is RUNNING')
  it('stops polling when status is DONE')
  it('stops polling when status is FAILED')
  it('renders summary text when DONE')
  it('groups issues by file in the file rail')
  it('shows only the active file\'s issues in the issue panel')
  it('shows processing state when PENDING or RUNNING')
  it('shows failed state with retry button when FAILED')
  it('shows empty state when review has 0 issues')
  it('filters issues by severity client-side')
  it('opens GitHub PR link in new tab')
  it('redirects to /reviews on 403 response')
})

describe('FileRail', () => {
  it('renders one row per distinct file with issues')
  it('shows the worst-severity tick colour per file')
  it('calls onSelect with the file index when a row is clicked')
  it('highlights the active file row')
})

describe('IssueCard', () => {
  it('renders severity pill with colour and label (not colour alone)')
  it('renders category and file:line location')
  it('renders the diff snippet with context/added/removed styling')
  it('renders the suggestion box')
  it('renders a View on GitHub link')
  it('is keyboard accessible')
})

describe('ProcessingState', () => {
  it('shows a spinner while RUNNING')
  it('shows elapsed time or a generic in-progress message')
})
```
