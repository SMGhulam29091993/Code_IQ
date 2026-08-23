# Domain: Billing
> Covers Stripe plan management, seat-based pricing, and webhook handling.
> `GET /billing/subscription`, `GET /billing/seats`, and `GET /billing/invoices` below are new —
> added 2026-08-23 to back the Billing screen's real layout, source: `knowledge/screens/
> billing-screens.md` (rewritten against the Claude Design mockup `CodeIQ Dashboard.dc.html`).
> Nothing before this section existed to answer "what's my current plan/seats/invoices" — only
> `/billing/{plans,checkout,portal,webhook}` did.

## Plan definitions
| Tier  | Price          | Repo limit | Review limit/mo | AI queries |
|-------|----------------|------------|-----------------|------------|
| FREE  | $0             | 3 repos    | 50 reviews      | N/A        |
| PRO   | $15/seat/mo    | Unlimited  | Unlimited       | N/A        |
| TEAM  | $12/seat/mo    | Unlimited  | Unlimited       | Dashboard analytics |

---

## API Routes

### GET /billing/plans
**Purpose:** Return plan list with pricing.
**Auth:** None (public)

**Acceptance criteria:**
- [ ] Returns all plan tiers with limits and Stripe price IDs
- [ ] Never exposes Stripe secret key to frontend

---

### POST /billing/checkout
**Purpose:** Create a Stripe Checkout Session for the user to subscribe.
**Auth:** JWT

**Request body:**
```typescript
{ planTier: 'PRO' | 'TEAM'; seats: number }
```

**Acceptance criteria:**
- [ ] Creates or retrieves Stripe Customer for the user
- [ ] Creates Checkout Session with correct quantity = seats
- [ ] Returns `{ url: string }` — the checkout redirect URL
- [ ] Stores `stripeCustomerId` on the Installation

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| `seats` < 1 | 400 `"Must purchase at least 1 seat"` | |
| `seats` > 500 | 400 `"Contact sales for > 500 seats"` | |
| User already has active subscription | 400 `"Already subscribed — use billing portal to change plan"` | |
| `planTier` = FREE | 400 `"Cannot checkout Free tier"` | |
| Stripe API unavailable | 502 | |

**Implementation pseudocode:**
```
createCheckout(userId, body):
  validate body with CheckoutSchema
  installation = installationRepo.findByUserId(userId)
  if installation.planTier !== 'FREE'
    → throw BadRequestError("Already subscribed — use billing portal to change plan")
  customerId = installation.stripeCustomerId
  if !customerId:
    customer = await stripe.customers.create({ email: user.email, name: user.name })
    installationRepo.update(installation.id, { stripeCustomerId: customer.id })
    customerId = customer.id
  session = await stripe.checkout.sessions.create({
    customer: customerId,
    line_items: [{ price: STRIPE_PRICE_IDS[body.planTier], quantity: body.seats }],
    mode: 'subscription',
    success_url: `${FRONTEND_URL}/billing?success=true`,
    cancel_url: `${FRONTEND_URL}/billing`,
    metadata: { installationId: installation.id },
  })
  return ok({ url: session.url })
```

**Unit test cases:**
```typescript
describe('BillingService.createCheckout', () => {
  it('creates Stripe customer if none exists')
  it('reuses existing Stripe customer if stripeCustomerId is set')
  it('throws BadRequestError when already subscribed')
  it('throws BadRequestError for seats < 1')
  it('throws BadRequestError for FREE tier checkout')
  it('passes correct quantity to Stripe')
  it('returns checkout URL')
  it('stores stripeCustomerId on installation after customer creation')
})
```

---

### POST /billing/portal
**Purpose:** Create a Stripe Customer Portal session for managing/cancelling subscription.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Only works if user has a Stripe customer ID
- [ ] Returns portal session URL
- [ ] Portal is configured to allow: cancel, upgrade, downgrade, seat changes

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| No Stripe customer ID | 400 `"No active subscription found"` | |
| Stripe API error | 502 | |

---

### GET /billing/subscription
**Purpose:** Current plan/seats/next-invoice summary for the Billing screen's header + plan
card highlighting + next-invoice card.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Scoped to the current user's installation (`InstallationRepository.findByUserId`, same
  "one active installation per user" stance as `createCheckout`/`createPortal` — see
  Implementation notes below)
- [ ] Returns 400 when the installation has no `stripeSubId` (FREE tier / never subscribed) —
  this is what drives the Billing screen's "No subscription yet" empty state, not a 200 with
  null fields
- [ ] `nextInvoice` fields come from `stripe.invoices.retrieveUpcoming` (or equivalent), not
  computed client-side
- [ ] Never exposes the full Stripe customer/subscription object — only the fields below

**Response shape:**
```typescript
{
  data: {
    planTier: 'PRO' | 'TEAM';
    seatCount: number;
    nextInvoice: { date: string; amount: number } | null;  // null if subscription is canceling
    paymentMethod: { brand: string; last4: string } | null;
  }
}
```

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| Installation has no `stripeSubId` (FREE) | 400 `"No active subscription found"` | |
| No installation for user | 404 `"Installation not found"` | |
| Stripe API unavailable | 502 | |
| Subscription set to cancel at period end | `nextInvoice: null`, `planTier` still reflects current (unchanged) tier | |

**Unit test cases:**
```typescript
describe('BillingService.getSubscription', () => {
  it('returns plan tier, seat count, next invoice and payment method for a subscribed installation')
  it('throws BadRequestError when installation has no stripeSubId')
  it('throws NotFoundError when user has no installation')
  it('returns nextInvoice: null when subscription is set to cancel at period end')
})
```

---

### GET /billing/seats
**Purpose:** Seat list for the Billing screen's Seats panel — GitHub org members joined with
each member's PR review activity in the current billing period.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Fetches org members via the installation's Octokit (`GET /orgs/:org/members`, using the
  same `IGithubApiClient` narrow-interface pattern as the rest of `modules/github`) — GitHub is
  the source of truth for who has a seat, **not** a locally-invited list (resolves the mockup's
  own "Where seats come from" open question in favor of "GitHub org membership", since that's
  the only real signal `Installation`/`User` already models)
- [ ] For each member, counts `Review` rows in the current billing period (Stripe subscription's
  `current_period_start` → now) where `prAuthor` matches the member's GitHub login
- [ ] Returns role as reported by the GitHub org-members API — **`'admin' | 'member'` only**, not
  the mockup's `owner`/`admin`/`member` trio. GitHub's org-membership API exposes exactly those
  two roles (fetched via two `role`-filtered `listMembers` calls); "owner" isn't a distinct role
  it returns, so the frontend maps `admin` → the mockup's "owner" styling for the installing
  user's own login (if it needs that visual distinction) rather than this endpoint inventing a
  third role GitHub doesn't have
- [ ] Scoped to the current user's installation

**Response shape:**
```typescript
{
  data: {
    seats: Array<{
      login: string;
      role: 'admin' | 'member';
      prsReviewed: number;   // 0 → frontend renders "no reviews this period"
    }>;
  }
}
```

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| Installation account type is 'User' (not 'Organization') | 400 `"Seats are only available for organization installations"` | |
| GitHub API unavailable | 502 (frontend's SeatsPanel shows its own error state, not a full-page failure) | |
| Member has 0 reviews in the period | `prsReviewed: 0` | |
| No installation for user | 404 | |

**Unit test cases:**
```typescript
describe('BillingService.getSeats', () => {
  it('returns org members from the GitHub API with role and PR review count')
  it('counts reviews only within the current billing period')
  it('returns prsReviewed: 0 for members with no reviews')
  it('throws BadRequestError for a non-organization installation')
  it('propagates a 502 when the GitHub API call fails')
})
```

---

### GET /billing/invoices
**Purpose:** Paginated invoice history for the Billing screen's Invoices list.
**Auth:** JWT

**Query params:** `{ limit?: number }`  // default 12, max 50 — Stripe cursor pagination via `starting_after` is a future enhancement, not needed at this list size

**Acceptance criteria:**
- [ ] Proxies `stripe.invoices.list({ customer, limit })` for the installation's
  `stripeCustomerId`
- [ ] Returns date, amount, status, and a hosted PDF URL per invoice — never the raw Stripe
  invoice object
- [ ] Scoped to the current user's installation

**Response shape:**
```typescript
{
  data: {
    invoices: Array<{ date: string; amount: number; status: string; pdfUrl: string }>;
  }
}
```

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| Installation has no `stripeCustomerId` | 400 `"No billing history found"` | |
| Stripe API unavailable | 502 | |
| No invoices yet (subscribed same day) | `{ invoices: [] }` | |

**Unit test cases:**
```typescript
describe('BillingService.getInvoices', () => {
  it('returns invoices for the installation\'s Stripe customer')
  it('respects the limit param up to 50')
  it('throws BadRequestError when installation has no stripeCustomerId')
  it('returns empty array when customer has no invoices yet')
})
```

---

### POST /billing/webhook
**Purpose:** Handle Stripe webhook events to update subscription state.
**Auth:** Stripe signature verification (not JWT)
**Mount:** Uses `express.raw()` before JSON parser

**Events handled:**
| Stripe event | Action |
|---|---|
| `checkout.session.completed` | Set planTier + seatCount from session metadata |
| `invoice.paid` | Confirm subscription active, log payment |
| `invoice.payment_failed` | Log failure (do not downgrade immediately — Stripe retries) |
| `customer.subscription.updated` | Sync seatCount and planTier |
| `customer.subscription.deleted` | Downgrade to FREE |

**Acceptance criteria:**
- [ ] Verifies `Stripe-Signature` header using `stripe.webhooks.constructEvent`
- [ ] Responds 200 before processing (fire-and-forget pattern)
- [ ] Idempotent (Stripe may retry deliveries)
- [ ] Uses `event.id` as idempotency key — skip if already processed

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| Signature missing | 400 `"Missing Stripe-Signature"` | |
| Signature invalid | 400 `"Invalid Stripe signature"` | |
| Event already processed | 200 (idempotent — check processed event log) | |
| `installationId` missing from metadata | Log error, return 200 (don't retry Stripe) | |
| Unknown event type | 200 `"Event ignored"` | |

**Implementation pseudocode:**
```
handleStripeWebhook(rawBody, sig):
  if !sig → return 400 "Missing Stripe-Signature"
  event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET)
    on error → return 400 "Invalid Stripe signature"

  // Idempotency check
  if processedEventRepo.exists(event.id) → return 200 "Already processed"
  processedEventRepo.create(event.id)

  switch event.type:
    case 'checkout.session.completed':
      session = event.data.object
      installationId = session.metadata.installationId
      if !installationId → log.error("Missing installationId in metadata") ; return 200
      sub = await stripe.subscriptions.retrieve(session.subscription)
      tier = getPlanTierFromPriceId(sub.items.data[0].price.id)
      seats = sub.items.data[0].quantity
      installationRepo.update(installationId, {
        planTier: tier,
        seatCount: seats,
        stripeSubId: sub.id,
      })

    case 'customer.subscription.deleted':
      sub = event.data.object
      installation = installationRepo.findByStripeSubId(sub.id)
      if installation:
        installationRepo.update(installation.id, { planTier: 'FREE', seatCount: 0, stripeSubId: null })
        // Deactivate repos over the free tier limit (keep 3 most recent)
        repoService.enforceFreeTierLimit(installation.id)

    case 'customer.subscription.updated':
      sub = event.data.object
      installation = installationRepo.findByStripeSubId(sub.id)
      if installation:
        tier = getPlanTierFromPriceId(sub.items.data[0].price.id)
        seats = sub.items.data[0].quantity
        installationRepo.update(installation.id, { planTier: tier, seatCount: seats })

  return 200 "OK"
```

**Unit test cases:**
```typescript
describe('BillingService.handleStripeWebhook', () => {
  it('returns 400 when Stripe-Signature is missing')
  it('returns 400 when signature verification fails')
  it('returns 200 when event already processed (idempotent)')
  it('sets planTier and seatCount on checkout.session.completed')
  it('downgrades to FREE on customer.subscription.deleted')
  it('enforces free tier repo limit after downgrade')
  it('syncs seats on customer.subscription.updated')
  it('logs error and returns 200 when installationId missing from metadata')
  it('returns 200 for unhandled event types')
  it('saves event.id to processed events for idempotency')
})
```

---

## Implementation notes (discovered during Step 6)

- **`GET /billing/plans` response shape deviates from `api-guidelines.md`'s original
  `{ tier, price, seats, limits }` sketch.** Implemented as
  `{ tier, price, repoLimit, reviewLimit, aiQueries, stripePriceId }` — `price` is USD/seat/month
  (0 for FREE), `repoLimit`/`reviewLimit` are `null` when unlimited, `stripePriceId` is `null`
  for FREE. `api-guidelines.md` updated to match.
- **Billing treats "installation" as one-per-user.** `createCheckout`/`createPortal` take only
  `userId` (per this doc's own pseudocode), but `Installation` is actually `User` 1:N — a user
  can have multiple GitHub App installations (`.ai/knowledge/domains/github-app.md`). Resolved
  by adding `InstallationRepository.findByUserId`, which returns the most-recently-created
  **active** installation for that user. This is a real product gap (multi-installation orgs
  can only bill their newest installation) flagged here rather than silently designed around —
  revisit if/when billing needs to be scoped per-installation instead of per-user.
- **`enforceFreeTierLimit` (called from `customer.subscription.deleted`) lives on
  `RepoService`, not `BillingService`.** Billing has no business reasoning about which repos to
  keep active — that's `RepoService`'s domain (`.ai/knowledge/domains/repos.md`'s FREE-tier
  3-repo rule). `BillingService` only calls `repoService.enforceFreeTierLimit(installationId)`
  after downgrading. New `IRepoRepository` methods:
  `findActiveIdsForInstallationByRecency` (most-recently-created first) and `setActiveMany`.
- **`customer.subscription.updated` doesn't call `stripe.subscriptions.retrieve`** — unlike
  `checkout.session.completed`, the full subscription object (including `items.data`) already
  arrives as `event.data.object`, so `applySubscriptionToInstallation` reads it directly.
- **`IStripeClient` is a narrow interface**, not the `stripe` SDK's own `Stripe` type —
  `BillingService` depends only on the five method groups it actually calls
  (`customers.create`, `checkout.sessions.create`, `billingPortal.sessions.create`,
  `subscriptions.retrieve`, `webhooks.constructEvent`). Same stance as `review.md`'s
  `IGeminiClient` vs. `@google/generative-ai`'s `GenerativeModel`. `src/lib/stripe.ts` exports
  the real Stripe client typed against this interface.
- **Unrecognized Stripe price ID on a subscription** (shouldn't happen outside of Stripe
  dashboard misconfiguration) logs an error and skips the update rather than throwing — a
  malformed/unmapped subscription must not break webhook idempotency (the event is already
  marked processed by that point) or return a non-200 to Stripe (which would trigger retries
  that can't succeed).
