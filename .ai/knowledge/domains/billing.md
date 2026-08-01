# Domain: Billing
> Covers Stripe plan management, seat-based pricing, and webhook handling.

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
