import type { Installation, PlanTier } from "@codeiq/db";

// .ai/knowledge/domains/billing.md "Plan definitions". PRO/TEAM carry a real Stripe price ID;
// FREE has none — it's never checked out (see BillingService.createCheckout's FREE-tier guard).
export interface PlanInfo {
  tier: PlanTier;
  price: number; // USD per seat per month; 0 for FREE
  repoLimit: number | null; // null = unlimited
  reviewLimit: number | null; // null = unlimited, per month
  aiQueries: boolean;
  stripePriceId: string | null;
}

export interface PlansResult {
  plans: PlanInfo[];
}

export interface CheckoutInput {
  planTier: PlanTier;
  seats: number;
}

export interface CheckoutResult {
  url: string;
}

export interface PortalResult {
  url: string;
}

export interface WebhookResult {
  message: string;
}

export interface IBillingService {
  getPlans(): PlansResult;
  createCheckout(userId: string, input: CheckoutInput): Promise<CheckoutResult>;
  createPortal(userId: string): Promise<PortalResult>;
  // rawBody must be the untouched request bytes — see app.ts's express.raw() mount for
  // /api/billing/webhook and .ai/memory/pitfalls.md #001.
  handleStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<WebhookResult>;
}

export interface IProcessedEventRepository {
  exists(eventId: string): Promise<boolean>;
  create(eventId: string): Promise<void>;
}

// Billing-specific slice of IInstallationRepository — extends the github module's interface
// (.ai/rules/architecture-rules.md "Interfaces cross layer boundaries") rather than
// duplicating a second Installation repository, since Installation already lives there.
export interface IBillingInstallationRepository {
  findById(id: string): Promise<Installation | null>;
  findByUserId(userId: string): Promise<Installation | null>;
  findByStripeSubId(stripeSubId: string): Promise<Installation | null>;
  updateBilling(
    installationId: string,
    data: Partial<{
      stripeCustomerId: string;
      stripeSubId: string | null;
      planTier: PlanTier;
      seatCount: number;
    }>
  ): Promise<void>;
}

// Narrow subset of the Stripe SDK's own types — BillingService depends on this, never on
// `Stripe` directly, same stance as review.types.ts's IGeminiClient vs
// `@google/generative-ai`'s GenerativeModel. src/lib/stripe.ts's real Stripe client
// structurally satisfies this.
export interface IStripeCustomer {
  id: string;
}

export interface IStripeCheckoutSession {
  url: string | null;
}

export interface IStripePortalSession {
  url: string;
}

export interface IStripeSubscription {
  id: string;
  items: { data: Array<{ price: { id: string }; quantity?: number }> };
}

export interface IStripeEvent {
  id: string;
  type: string;
  data: { object: unknown };
}

export interface IStripeClient {
  customers: {
    create(params: { email: string; name: string }): Promise<IStripeCustomer>;
  };
  checkout: {
    sessions: {
      create(params: {
        customer: string;
        line_items: Array<{ price: string; quantity: number }>;
        mode: "subscription";
        success_url: string;
        cancel_url: string;
        metadata: Record<string, string>;
      }): Promise<IStripeCheckoutSession>;
    };
  };
  billingPortal: {
    sessions: {
      create(params: { customer: string; return_url: string }): Promise<IStripePortalSession>;
    };
  };
  subscriptions: {
    retrieve(id: string): Promise<IStripeSubscription>;
  };
  webhooks: {
    constructEvent(payload: string | Buffer, signature: string, secret: string): IStripeEvent;
  };
}

// Narrow shapes for the two Stripe event payloads this module reads fields from
// (`event.data.object` is `unknown` on IStripeEvent — these are asserted at the call site).
export interface StripeCheckoutSessionObject {
  subscription: string | null;
  metadata: Record<string, string> | null;
}

export interface StripeSubscriptionObject {
  id: string;
  items: { data: Array<{ price: { id: string }; quantity?: number }> };
}
