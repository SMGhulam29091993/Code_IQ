import type { PlanTier } from "@codeiq/db";
import type {
  CheckoutInput,
  CheckoutResult,
  GetInvoicesInput,
  IBillingInstallationRepository,
  IBillingReviewRepository,
  IBillingService,
  IGithubApiClient,
  InvoicesResult,
  IProcessedEventRepository,
  IStripeClient,
  PlansResult,
  PortalResult,
  SeatsResult,
  StripeCheckoutSessionObject,
  StripeSubscriptionObject,
  SubscriptionResult,
  WebhookResult,
} from "./billing.types";
import { env } from "../../lib/env";
import { AppError, BadRequestError } from "../../lib/errors";
import type { IUserRepository } from "../auth/auth.types";
import type { IRepoService } from "../repos/repo.types";

const DEFAULT_INVOICES_LIMIT = 12;
const MAX_INVOICES_LIMIT = 50;

// Exact plan definitions from .ai/knowledge/domains/billing.md "Plan definitions".
const PLANS: PlansResult["plans"] = [
  { tier: "FREE", price: 0, repoLimit: 3, reviewLimit: 50, aiQueries: false, stripePriceId: null },
  {
    tier: "PRO",
    price: 15,
    repoLimit: null,
    reviewLimit: null,
    aiQueries: false,
    stripePriceId: env.STRIPE_PRICE_ID_PRO,
  },
  {
    tier: "TEAM",
    price: 12,
    repoLimit: null,
    reviewLimit: null,
    aiQueries: true,
    stripePriceId: env.STRIPE_PRICE_ID_TEAM,
  },
];

function unixToIso(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function getPlanTierFromPriceId(priceId: string): PlanTier | null {
  if (priceId === env.STRIPE_PRICE_ID_PRO) return "PRO";
  if (priceId === env.STRIPE_PRICE_ID_TEAM) return "TEAM";
  return null;
}

// Exact behaviour/pseudocode from .ai/knowledge/domains/billing.md.
export class BillingService implements IBillingService {
  constructor(
    private readonly installationRepo: IBillingInstallationRepository,
    private readonly userRepo: IUserRepository,
    private readonly processedEventRepo: IProcessedEventRepository,
    private readonly repoService: IRepoService,
    private readonly stripeClient: IStripeClient,
    private readonly githubApiClient: IGithubApiClient,
    private readonly reviewRepo: IBillingReviewRepository
  ) {}

  getPlans(): PlansResult {
    return { plans: PLANS };
  }

  async createCheckout(userId: string, input: CheckoutInput): Promise<CheckoutResult> {
    if (input.planTier === "FREE") {
      throw new BadRequestError("Cannot checkout Free tier");
    }
    if (input.seats < 1) {
      throw new BadRequestError("Must purchase at least 1 seat");
    }
    if (input.seats > 500) {
      throw new BadRequestError("Contact sales for > 500 seats");
    }

    const installation = await this.installationRepo.findByUserId(userId);
    if (!installation) {
      throw new BadRequestError("No GitHub installation found — install the app first");
    }
    if (installation.planTier !== "FREE") {
      throw new BadRequestError("Already subscribed — use billing portal to change plan");
    }

    let customerId = installation.stripeCustomerId;
    if (!customerId) {
      const user = await this.userRepo.findById(userId);
      if (!user) {
        throw new BadRequestError("User not found");
      }
      const customer = await this.tryStripe(() =>
        this.stripeClient.customers.create({ email: user.email, name: user.name })
      );
      await this.installationRepo.updateBilling(installation.id, {
        stripeCustomerId: customer.id,
      });
      customerId = customer.id;
    }

    const priceId =
      input.planTier === "PRO" ? env.STRIPE_PRICE_ID_PRO : env.STRIPE_PRICE_ID_TEAM;
    const session = await this.tryStripe(() =>
      this.stripeClient.checkout.sessions.create({
        customer: customerId!,
        line_items: [{ price: priceId, quantity: input.seats }],
        mode: "subscription",
        success_url: `${env.FRONTEND_URL}/billing?success=true`,
        cancel_url: `${env.FRONTEND_URL}/billing`,
        metadata: { installationId: installation.id },
      })
    );
    if (!session.url) {
      throw new AppError("Stripe did not return a checkout URL", 502);
    }
    return { url: session.url };
  }

  async createPortal(userId: string): Promise<PortalResult> {
    const installation = await this.installationRepo.findByUserId(userId);
    if (!installation?.stripeCustomerId) {
      throw new BadRequestError("No active subscription found");
    }

    const session = await this.tryStripe(() =>
      this.stripeClient.billingPortal.sessions.create({
        customer: installation.stripeCustomerId!,
        return_url: `${env.FRONTEND_URL}/billing`,
      })
    );
    return { url: session.url };
  }

  async getSubscription(userId: string): Promise<SubscriptionResult> {
    const installation = await this.installationRepo.findByUserId(userId);
    if (!installation) {
      throw new BadRequestError("No active subscription found");
    }
    if (!installation.stripeSubId || installation.planTier === "FREE") {
      throw new BadRequestError("No active subscription found");
    }

    const [upcoming, paymentMethods] = await Promise.all([
      // Not routed through tryStripe: Stripe throws here whenever there's no upcoming invoice
      // (e.g. a subscription set to cancel at period end), which is an expected outcome for
      // this field, not a 502-worthy failure — any rejection just means nextInvoice: null.
      this.stripeClient.invoices
        .createPreview({ customer: installation.stripeCustomerId! })
        .catch(() => null),
      this.tryStripe(() =>
        this.stripeClient.paymentMethods.list({
          customer: installation.stripeCustomerId!,
          type: "card",
        })
      ),
    ]);

    const card = paymentMethods.data[0]?.card ?? null;

    return {
      planTier: installation.planTier as Exclude<PlanTier, "FREE">,
      seatCount: installation.seatCount,
      nextInvoice:
        upcoming && upcoming.next_payment_attempt
          ? { date: unixToIso(upcoming.next_payment_attempt), amount: upcoming.amount_due / 100 }
          : null,
      paymentMethod: card ? { brand: card.brand, last4: card.last4 } : null,
    };
  }

  async getSeats(userId: string): Promise<SeatsResult> {
    const installation = await this.installationRepo.findByUserId(userId);
    if (!installation) {
      throw new BadRequestError("No active subscription found");
    }
    if (installation.accountType !== "Organization") {
      throw new BadRequestError("Seats are only available for organization installations");
    }

    let periodStart = new Date(0);
    if (installation.stripeSubId) {
      const sub = await this.tryStripe(() =>
        this.stripeClient.subscriptions.retrieve(installation.stripeSubId!)
      );
      const item = sub.items.data[0];
      if (item) periodStart = new Date(item.current_period_start * 1000);
    }

    const [members, reviewCounts] = await Promise.all([
      this.githubApiClient.listOrgMembers(
        installation.githubInstallationId,
        installation.accountLogin
      ),
      this.reviewRepo.countReviewsByAuthorForInstallation(installation.id, periodStart),
    ]);

    return {
      seats: members.map((m) => ({
        login: m.login,
        role: m.role,
        prsReviewed: reviewCounts[m.login] ?? 0,
      })),
    };
  }

  async getInvoices(userId: string, input: GetInvoicesInput): Promise<InvoicesResult> {
    const installation = await this.installationRepo.findByUserId(userId);
    if (!installation?.stripeCustomerId) {
      throw new BadRequestError("No billing history found");
    }

    const limit = Math.min(input.limit ?? DEFAULT_INVOICES_LIMIT, MAX_INVOICES_LIMIT);
    const result = await this.tryStripe(() =>
      this.stripeClient.invoices.list({ customer: installation.stripeCustomerId!, limit })
    );

    return {
      invoices: result.data.map((inv) => ({
        date: unixToIso(inv.created),
        amount: inv.amount_paid / 100,
        status: inv.status ?? "unknown",
        pdfUrl: inv.hosted_invoice_url ?? "",
      })),
    };
  }

  async handleStripeWebhook(
    rawBody: Buffer,
    signature: string | undefined
  ): Promise<WebhookResult> {
    if (!signature) {
      throw new BadRequestError("Missing Stripe-Signature");
    }

    let event;
    try {
      event = this.stripeClient.webhooks.constructEvent(
        rawBody,
        signature,
        env.STRIPE_WEBHOOK_SECRET
      );
    } catch {
      throw new BadRequestError("Invalid Stripe signature");
    }

    if (await this.processedEventRepo.exists(event.id)) {
      return { message: "Already processed" };
    }
    await this.processedEventRepo.create(event.id);

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as StripeCheckoutSessionObject;
        const installationId = session.metadata?.installationId;
        if (!installationId) {
          console.error("Stripe checkout.session.completed missing installationId in metadata");
          return { message: "OK" };
        }
        if (!session.subscription) {
          console.error("Stripe checkout.session.completed missing subscription id");
          return { message: "OK" };
        }
        const sub = await this.stripeClient.subscriptions.retrieve(session.subscription);
        await this.applySubscriptionToInstallation(installationId, sub);
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as StripeSubscriptionObject;
        const installation = await this.installationRepo.findByStripeSubId(sub.id);
        if (installation) {
          await this.installationRepo.updateBilling(installation.id, {
            planTier: "FREE",
            seatCount: 0,
            stripeSubId: null,
          });
          await this.repoService.enforceFreeTierLimit(installation.id);
        }
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as StripeSubscriptionObject;
        const installation = await this.installationRepo.findByStripeSubId(sub.id);
        if (installation) {
          await this.applySubscriptionToInstallation(installation.id, sub);
        }
        break;
      }

      default:
        break;
    }

    return { message: "OK" };
  }

  private async applySubscriptionToInstallation(
    installationId: string,
    sub: StripeSubscriptionObject
  ): Promise<void> {
    const item = sub.items.data[0];
    if (!item) return;
    const tier = getPlanTierFromPriceId(item.price.id);
    if (!tier) {
      console.error(`Unrecognized Stripe price id on subscription ${sub.id}: ${item.price.id}`);
      return;
    }
    await this.installationRepo.updateBilling(installationId, {
      planTier: tier,
      seatCount: item.quantity ?? 0,
      stripeSubId: sub.id,
    });
  }

  private async tryStripe<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch {
      throw new AppError("Stripe API unavailable", 502);
    }
  }
}
