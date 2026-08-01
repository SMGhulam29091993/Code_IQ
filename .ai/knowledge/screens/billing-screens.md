# Screens: Billing
> Acceptance criteria, component breakdown, pseudocode, edge cases, test cases.
> API contract: `knowledge/domains/billing.md`

---

## Screen: Billing `/billing`

### Components
```
(dashboard)/billing/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── CurrentPlanBanner.tsx      ← active plan, next invoice, seats used
    ├── PlanCards.tsx              ← Free / Pro / Team cards
    ├── SeatManager.tsx            ← +/- seat counter for current plan
    ├── InvoiceHistory.tsx         ← "Manage in Stripe" portal link
    └── UsageBar.tsx               ← repos used / limit (Free tier only)
```

### Acceptance criteria
- [ ] **CurrentPlanBanner:** shows current tier, next invoice date + amount, seat count
- [ ] **PlanCards:** 3 cards (Free, Pro, Team). Current plan highlighted with border + badge
- [ ] **PlanCards:** Free tier — "Downgrade" CTA (if on paid) or disabled "Current plan"
- [ ] **PlanCards:** Pro/Team — "Upgrade" → calls `POST /billing/checkout` → redirect to Stripe
- [ ] **PlanCards:** Current plan shows "Manage →" → calls `POST /billing/portal` → redirect
- [ ] **SeatManager:** only shown for Pro/Team users. +/- counter. Saves via Stripe portal.
- [ ] **UsageBar:** only shown for Free tier. "3 of 3 repos used" with progress bar.
- [ ] "Manage in Stripe" button → Stripe customer portal (opens new tab)
- [ ] Success state when redirected back with `?success=true` query param
- [ ] Cancel state when redirected back with no success param (after abandoning Stripe)

### Pseudocode
```
BillingPage:
  searchParams = useSearchParams()
  showSuccess = searchParams.get('success') === 'true'

  { data: installation } = useInstallation()
  checkoutMutation = useCheckout()
  portalMutation = useBillingPortal()

  handleUpgrade(tier, seats):
    checkoutMutation.mutate({ planTier: tier, seats })
    // on success: window.location.href = data.url (Stripe redirect)

  handleManage():
    portalMutation.mutate()
    // on success: window.open(data.url, '_blank')

useCheckout = () => useMutation({
  mutationFn: (body) => api.post('/billing/checkout', body).then(r => r.data.data),
  onSuccess: ({ url }) => { window.location.href = url },
  onError: (err) => toast.error(err.response?.data?.message ?? 'Checkout failed'),
})

useBillingPortal = () => useMutation({
  mutationFn: () => api.post('/billing/portal').then(r => r.data.data),
  onSuccess: ({ url }) => { window.open(url, '_blank') },
})
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| On Free tier, clicks "Upgrade to Pro" | Checkout redirect → Stripe |
| Already on Pro, clicks Pro card "Manage" | Portal redirect → Stripe |
| `POST /billing/checkout` returns 400 (already subscribed) | Toast: "You already have an active subscription. Use 'Manage' to change your plan." |
| `POST /billing/portal` returns 400 (no subscription) | Toast: "No active subscription found." |
| Stripe checkout returns `?success=true` | Show green success banner: "You're now on Pro! 🎉" |
| User abandons Stripe (no success param) | No banner. Page loads normally. |
| Stripe API unavailable (502) | Toast: "Payment service unavailable. Try again later." |
| Free tier: all 3 repos active, tries to activate 4th | `/repos` shows upgrade banner (not billing page) |

### Test cases
```typescript
describe('BillingPage', () => {
  it('renders CurrentPlanBanner with correct tier and invoice info')
  it('renders 3 plan cards')
  it('highlights current plan card')
  it('shows success banner when ?success=true in URL')
  it('shows UsageBar for Free tier users')
  it('hides UsageBar for Pro/Team users')
  it('shows SeatManager for Pro/Team users')
  it('hides SeatManager for Free tier users')
})

describe('PlanCards', () => {
  it('calls POST /billing/checkout on upgrade click')
  it('redirects to Stripe checkout URL on success')
  it('shows toast on 400 (already subscribed)')
  it('shows toast on 502 (Stripe unavailable)')
  it('disables upgrade button while checkout mutation is loading')
  it('shows "Manage" button instead of "Upgrade" for current plan')
})

describe('useBillingPortal', () => {
  it('calls POST /billing/portal')
  it('opens portal URL in new tab')
  it('shows toast on error')
})

describe('SeatManager', () => {
  it('shows current seat count')
  it('increments seat count on + click')
  it('decrements seat count on - click')
  it('prevents going below 1 seat')
  it('prevents going above 500 seats')
  it('shows "Contact sales" message above 500')
})
```

---

## Screen: Workspace Settings `/workspace`

### Components
```
(dashboard)/workspace/
├── page.tsx
└── _components/
    ├── WorkspaceNameForm.tsx     ← edit installation name (display only)
    ├── MembersList.tsx           ← future: list workspace members (placeholder)
    └── DangerZone.tsx            ← remove installation
```

### Acceptance criteria
- [ ] Shows installation account login (read-only — from GitHub)
- [ ] Shows plan tier + seat count
- [ ] "Remove installation" button → calls `DELETE /github/installations/:id`
- [ ] Confirm modal before deletion ("This will deactivate all repos. Are you sure?")
- [ ] On delete success → redirect to `/install`

### Edge cases
| Case | Behaviour |
|------|-----------|
| Confirm modal dismissed | No API call, modal closes |
| Delete fails (403) | Toast error: "You don't have permission to remove this installation." |
| Delete succeeds | Redirect to `/install` + clear activeInstallationId from store |

### Test cases
```typescript
describe('WorkspacePage', () => {
  it('renders installation account login')
  it('renders plan tier and seat count')
  it('shows confirm modal before deletion')
  it('calls DELETE /github/installations/:id after confirmation')
  it('redirects to /install on successful deletion')
  it('clears activeInstallationId from store on deletion')
  it('does not call API when confirm modal is dismissed')
  it('shows error toast on 403')
})
```
