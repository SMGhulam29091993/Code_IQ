# Screens: Dashboard (Overview, Repos, Reviews)
> Acceptance criteria, component breakdown, pseudocode, edge cases, test cases.
> API contract: `knowledge/domains/review.md`, `knowledge/domains/repos.md`

---

## Screen: Overview `/overview`

### Components
```
(dashboard)/overview/
├── page.tsx                         ← server component shell
├── loading.tsx                      ← <OverviewSkeleton />
├── error.tsx                        ← <ErrorBanner />
└── _components/
    ├── StatsGrid.tsx                ← 4 stat cards
    ├── RecentReviewsList.tsx        ← last 5 reviews
    ├── PendingActionItems.tsx       ← open action items from reviews
    └── QuickAsk.tsx                 ← inline RAG chat input (future)
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

### Components
```
(dashboard)/repos/[repoId]/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── RepoHeader.tsx         ← name, language, active status, last reviewed
    ├── RepoStatsRow.tsx       ← total reviews, total issues, breakdown
    └── RepoReviewHistory.tsx  ← paginated list of past reviews for this repo
```

### Acceptance criteria
- [ ] Fetches repo via `GET /repos` filtered by repoId (or a future `GET /repos/:id`)
- [ ] Fetches stats via `GET /repos/:repoId/stats`
- [ ] Fetches reviews via `GET /reviews?repoId=:repoId`
- [ ] Issue trend chart (last 30 days) using recharts
- [ ] "Settings" button → `/repos/[repoId]/settings`
- [ ] Handles 403 (repo belongs to another user) → redirect to `/repos`

### Test cases
```typescript
describe('RepoDetailPage', () => {
  it('renders repo name and language')
  it('renders stats from /repos/:id/stats')
  it('renders review history list')
  it('navigates to settings page')
  it('shows skeleton while loading')
  it('redirects to /repos on 403 response')
  it('renders trend chart with 30-day data')
})
```

---

## Screen: Repo Settings `/repos/[repoId]/settings`

### Components
```
(dashboard)/repos/[repoId]/settings/
├── page.tsx
└── _components/
    └── RepoConfigForm.tsx     ← loads config, shows form, saves on submit
```

### Acceptance criteria
- [ ] Loads current config via `GET /repos/:repoId/config`
- [ ] Form fields:
  - Severity threshold: radio group (Critical only / Warning+ / All)
  - Enabled categories: multi-checkbox (bug, security, style, performance, logic)
  - Ignore patterns: tag input (add/remove glob strings)
  - Review on draft: toggle
  - Post summary comment: toggle
- [ ] PATCH on submit (only changed fields sent)
- [ ] Show success toast on save
- [ ] Show inline validation: at least one category selected
- [ ] Validate glob patterns client-side (basic check: not empty, no spaces)
- [ ] "Reset to defaults" button

### Pseudocode
```
RepoConfigForm:
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
| All categories unchecked | Zod error: "Select at least one category" |
| Invalid glob pattern entered | Inline error below patterns field |
| Submit with no changes | No API call (diff check) |
| API returns 403 | Toast error + redirect to /repos |
| Network error on save | Toast: "Failed to save. Try again." |

### Test cases
```typescript
describe('RepoConfigForm', () => {
  it('pre-fills form with current config values')
  it('shows error when all categories are unchecked')
  it('calls PATCH /repos/:id/config on submit')
  it('only sends changed fields in PATCH body')
  it('shows success toast on save')
  it('does not call API when nothing changed')
  it('resets form to defaults when reset button clicked')
  it('validates glob patterns before submit')
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

### Components
```
(dashboard)/reviews/[reviewId]/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── ReviewHeader.tsx           ← PR title, status, meta, retry/export buttons
    ├── ReviewSummary.tsx          ← AI-generated summary text
    ├── IssueSeverityBreakdown.tsx ← 3 severity counts as pills
    ├── IssuesGroupedByFile.tsx    ← accordion: file → issues list
    ├── IssueRow.tsx               ← single issue with severity badge, category, message, suggestion
    └── ProcessingState.tsx        ← shown when PENDING or RUNNING
```

### Acceptance criteria
- [ ] Polls every 5s when status is PENDING or RUNNING (stops on DONE/FAILED)
- [ ] Shows `<ProcessingState />` with step-by-step progress UI while PENDING/RUNNING
- [ ] On DONE: shows summary + all issues grouped by file
- [ ] On FAILED: shows error state + Retry button
- [ ] Issues accordion: file path as header, expandable, issue count badge
- [ ] Each issue shows: severity icon+colour, category badge, message, suggestion (collapsible)
- [ ] "Open on GitHub" button → links to `https://github.com/{fullName}/pull/{prNumber}`
- [ ] Issue count in page header: "X issues across Y files"
- [ ] Filter issues by severity (client-side, no API call)

### Pseudocode
```
ReviewDetailPage:
  { data: review, isLoading } = useQuery({
    queryKey: queryKeys.review(reviewId),
    queryFn: () => api.get(`/reviews/${reviewId}`).then(r => r.data.data),
    refetchInterval: (data) =>
      (!data || ['PENDING','RUNNING'].includes(data.status)) ? 5_000 : false,
  })

  if isLoading → <ReviewDetailSkeleton />
  if review.status === 'PENDING' || 'RUNNING' → <ProcessingState review={review} />
  if review.status === 'FAILED' → <FailedState review={review} onRetry={retryMutation.mutate} />

  issuesByFile = groupBy(review.issues, 'file')

  render:
    <ReviewHeader review={review} />
    <ReviewSummary summary={review.summary} />
    <IssueSeverityBreakdown issues={review.issues} />
    <IssuesGroupedByFile issuesByFile={issuesByFile} />
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| Review has 0 issues | "No issues found. Great work! 🎉" empty state |
| Review is FAILED | Full-page failed state with retry button |
| Retry mutation in flight | Retry button disabled, shows spinner |
| reviewId belongs to another user | API 403 → redirect to `/reviews` |
| reviewId not found | API 404 → Next.js `not-found.tsx` |
| Review has 50 issues (max) | Renders all 50; no truncation |

### Test cases
```typescript
describe('ReviewDetailPage', () => {
  it('shows skeleton while loading')
  it('polls every 5s when status is PENDING')
  it('polls every 5s when status is RUNNING')
  it('stops polling when status is DONE')
  it('stops polling when status is FAILED')
  it('renders summary text when DONE')
  it('renders issues grouped by file when DONE')
  it('shows processing state when PENDING or RUNNING')
  it('shows failed state with retry button when FAILED')
  it('shows empty state when review has 0 issues')
  it('filters issues by severity client-side')
  it('shows issue count in header')
  it('opens GitHub PR link in new tab')
  it('redirects to /reviews on 403 response')
})

describe('IssueRow', () => {
  it('renders severity icon with correct colour')
  it('renders category badge')
  it('renders issue message')
  it('expands/collapses suggestion on click')
  it('is keyboard accessible (Enter/Space to expand)')
})

describe('ProcessingState', () => {
  it('shows step indicators matching review pipeline stages')
  it('shows spinner on active step')
  it('shows checkmark on completed steps')
})
```
