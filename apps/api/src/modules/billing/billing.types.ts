import type { Installation, PlanTier } from "@codeiq/db";
import type { GithubOrgMember, IGithubApiClient } from "../github/github.types";

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

// New 2026-08-23 — .ai/knowledge/domains/billing.md "GET /billing/subscription" /
// "GET /billing/seats" / "GET /billing/invoices", backing the Billing screen
// (knowledge/screens/billing-screens.md) rewritten against the Claude Design mockup.
export interface SubscriptionResult {
  planTier: Exclude<PlanTier, "FREE">;
  seatCount: number;
  nextInvoice: { date: string; amount: number } | null;
  paymentMethod: { brand: string; last4: string } | null;
}

export interface SeatsResult {
  seats: Array<{ login: string; role: GithubOrgMember["role"]; prsReviewed: number }>;
}

export interface GetInvoicesInput {
  limit?: number;
}

export interface InvoicesResult {
  invoices: Array<{ date: string; amount: number; status: string; pdfUrl: string }>;
}

export interface IBillingService {
  getPlans(): PlansResult;
  createCheckout(userId: string, input: CheckoutInput): Promise<CheckoutResult>;
  createPortal(userId: string): Promise<PortalResult>;
  getSubscription(userId: string): Promise<SubscriptionResult>;
  getSeats(userId: string): Promise<SeatsResult>;
  getInvoices(userId: string, input: GetInvoicesInput): Promise<InvoicesResult>;
  // rawBody must be the untouched request bytes — see app.ts's express.raw() mount for
  // /api/billing/webhook and .ai/memory/pitfalls.md #001.
  handleStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<WebhookResult>;
}

// Narrow slice of IReviewRepository — BillingService only ever needs the per-author count for
// GET /billing/seats, not the rest of the review module's surface.
export interface IBillingReviewRepository {
  countReviewsByAuthorForInstallation(
    installationId: string,
    since: Date
  ): Promise<Record<string, number>>;
}

// Re-exported so BillingService's constructor signature doesn't need a direct import from
// modules/github — same "interfaces cross layer boundaries" stance as IBillingInstallationRepository.
export type { IGithubApiClient };

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
  // `current_period_start` lives on each subscription item (not the subscription itself) as of
  // Stripe's 2025 API versions — used by BillingService.getSeats to window "reviews in the
  // current billing period" (.ai/knowledge/domains/billing.md), read off items.data[0].
  items: {
    data: Array<{ price: { id: string }; quantity?: number; current_period_start: number }>;
  };
}

export interface IStripeUpcomingInvoice {
  amount_due: number;
  // Unix seconds the invoice is expected to be charged — null is possible on some preview
  // shapes; getSubscription treats a null/missing upcoming invoice as `nextInvoice: null`.
  next_payment_attempt: number | null;
}

export interface IStripeInvoice {
  created: number; // unix seconds
  amount_paid: number;
  status: string | null;
  hosted_invoice_url?: string | null;
}

export interface IStripePaymentMethod {
  card?: { brand: string; last4: string };
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
  invoices: {
    // Stripe SDK v22 renamed the classic "retrieve upcoming invoice" call to createPreview.
    // Throws when there's no upcoming invoice (e.g. a subscription set to cancel at period
    // end) — BillingService.getSubscription catches that and returns `nextInvoice: null`.
    createPreview(params: { customer: string }): Promise<IStripeUpcomingInvoice>;
    list(params: { customer: string; limit: number }): Promise<{ data: IStripeInvoice[] }>;
  };
  paymentMethods: {
    list(params: { customer: string; type: "card" }): Promise<{ data: IStripePaymentMethod[] }>;
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
