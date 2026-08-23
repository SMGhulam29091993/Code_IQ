# Screens: Billing
> Acceptance criteria, component breakdown, pseudocode, edge cases, test cases.
> API contract: `knowledge/domains/billing.md`
> Source: Claude Design mockup `CodeIQ Dashboard.dc.html` (imported 2026-08-23) — rewritten
> against it. The mockup's layout is plan cards + a seats panel + a next-invoice card + an
> invoices list, not the CurrentPlanBanner/UsageBar/SeatManager-with-stepper design this doc
> previously sketched; that design is replaced below. Seats and invoices need three **new** read
> endpoints (`knowledge/domains/billing.md` — `GET /billing/subscription`, `GET /billing/seats`,
> `GET /billing/invoices`) that didn't exist before this pass.
>
> **Pricing note:** the mockup's plan card copy uses placeholder numbers (Free $0/1 repo, Pro
> $12/seat/5 repos, Team $19/seat/unlimited) that don't match the real Stripe price mapping
> documented in `knowledge/domains/billing.md` (FREE $0/3 repos, PRO $15/seat, TEAM $12/seat).
> `PlanCards` renders price/limit copy **from `GET /billing/plans` (the real endpoint)**, never
> the mockup's literal digits — the mockup is a layout reference here, not a pricing source.

---

## Screen: Billing `/billing`

### Components
```
(dashboard)/billing/
├── page.tsx
├── loading.tsx
├── error.tsx
└── _components/
    ├── PlanCards.tsx           ← 3 cards (Free/Pro/Team), current plan highlighted
    ├── SeatsPanel.tsx          ← GitHub org members list + role + PR count + invite CTA
    ├── NextInvoiceCard.tsx     ← amount, date, breakdown ("N seats × $X · card ending NNNN")
    └── InvoicesList.tsx        ← paginated past invoices, PDF link per row
```

Header: breadcrumb "acme-corp"-equivalent (current installation's `accountLogin`), title
"Billing", header CTA "Update payment method" → `POST /billing/portal` → redirect.

### Acceptance criteria
- [ ] **PlanCards:** 3 cards, data from `GET /billing/plans`. Current plan (from
  `GET /billing/subscription`) gets a "current" tag + accent border. Non-current paid tiers show
  "Switch to `<tier>`" → `POST /billing/checkout` → redirect to Stripe. Free card shows
  "Downgrade" (disabled/no-op if already Free) — downgrading a paid sub happens via the Stripe
  portal, not a direct API call (Stripe is the source of truth for cancellation)
- [ ] **SeatsPanel:** rows from `GET /billing/seats` — avatar (initials), GitHub login, "N pull
  requests reviewed" (or "no reviews this period"), role pill (`admin`/`member` — GitHub's own
  two org roles, not the mockup's three-role `owner`/`admin`/`member`; see
  `knowledge/domains/billing.md`). Footer:
  "Invite from GitHub org" link → GitHub org member-management page (external link, opens new tab)
- [ ] **NextInvoiceCard:** amount + date + breakdown line, from `GET /billing/subscription`
- [ ] **InvoicesList:** rows from `GET /billing/invoices` (date, amount, "paid" status pill, PDF
  link) — paginate if the list grows past a page; PDF link opens Stripe-hosted invoice PDF in a
  new tab
- [ ] Success banner when redirected back with `?success=true` (post-checkout)
- [ ] No banner when redirected back with no success param (abandoned Stripe checkout)

### Pseudocode
```
BillingPage:
  searchParams = useSearchParams()
  showSuccess = searchParams.get('success') === 'true'

  { data: subscription } = useSubscription()   // GET /billing/subscription
  { data: plans } = useBillingPlans()          // GET /billing/plans
  { data: seats } = useBillingSeats()          // GET /billing/seats
  { data: invoices } = useInvoices()           // GET /billing/invoices
  checkoutMutation = useCheckout()
  portalMutation = useBillingPortal()

  handleSwitchPlan(tier):
    checkoutMutation.mutate({ planTier: tier, seats: subscription?.seatCount ?? 1 })
    // on success: window.location.href = data.url (Stripe redirect)

  handleManage():
    portalMutation.mutate()
    // on success: window.location.href = data.url (full redirect, not a new tab — Stripe portal
    // needs to come back to /billing?success=true on some flows)
```

### Edge cases
| Case | Behaviour |
|------|-----------|
| On Free tier (no subscription) | `GET /billing/subscription` returns 400 → page shows the mockup's own empty state: "No subscription yet" / *"`{accountLogin}` is on the free tier. Add a card to move to Pro or Team and unlock private repositories."* / CTA "Choose a plan" (scrolls to PlanCards) |
| `POST /billing/checkout` returns 400 (already subscribed) | Toast: "You already have an active subscription. Use 'Manage' to change your plan." |
| `POST /billing/portal` returns 400 (no subscription) | Toast: "No active subscription found." |
| Stripe checkout returns `?success=true` | Green success banner |
| Stripe API unavailable (502) on any billing GET | That section shows its own `<ErrorBanner onRetry>` — not a full-page error (sections fail independently, same rule as Overview) |
| `GET /billing/seats`'s GitHub call fails | SeatsPanel shows its own error state; rest of the page still renders |
| Free tier: all repos active, tries to activate more | `/repos` shows upgrade banner (not this page) |

### Test cases
```typescript
describe('BillingPage', () => {
  it('renders 3 plan cards with data from GET /billing/plans')
  it('highlights the current plan card from GET /billing/subscription')
  it('shows success banner when ?success=true in URL')
  it('shows the free-tier empty state when GET /billing/subscription returns 400')
  it('each section (plans/seats/invoice/invoices) fails and recovers independently')
})

describe('PlanCards', () => {
  it('calls POST /billing/checkout on plan switch click')
  it('redirects to Stripe checkout URL on success')
  it('shows toast on 400 (already subscribed)')
  it('shows toast on 502 (Stripe unavailable)')
  it('disables the switch button while checkout mutation is loading')
})

describe('SeatsPanel', () => {
  it('renders one row per GET /billing/seats member')
  it('shows role pill per member')
  it('shows "no reviews this period" for members with 0 PR reviews')
  it('links "Invite from GitHub org" to the GitHub org members page in a new tab')
})

describe('InvoicesList', () => {
  it('renders invoice rows from GET /billing/invoices')
  it('links each row\'s PDF to the Stripe-hosted invoice')
})
```

---

## Screen: Workspace Settings

> **Moved 2026-08-23.** This screen shipped as the "Workspace" tab of `/account`, not its own
> `/workspace` route — see `knowledge/screens/account-screens.md` for the current spec
> (component breakdown, AC, edge cases, test cases). Also fixed there: the redirect-on-delete
> target was `/install`, a placeholder route name from before Onboarding existed; it's
> `/onboarding` now. This section is kept only so old links/history into this doc still land
> somewhere — do not add new detail here.
