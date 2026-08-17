import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Installation, User } from "@codeiq/db";
import { AppError, BadRequestError } from "../lib/errors";
import type { IUserRepository } from "../modules/auth/auth.types";
import { BillingService } from "../modules/billing/billing.service";
import type {
  IBillingInstallationRepository,
  IProcessedEventRepository,
  IStripeClient,
} from "../modules/billing/billing.types";
import type { IRepoService } from "../modules/repos/repo.types";

const NOW = new Date("2026-01-01T00:00:00Z");

function buildInstallation(overrides: Partial<Installation> = {}): Installation {
  return {
    id: "install-1",
    githubInstallationId: 111,
    accountLogin: "acme",
    accountType: "Organization",
    userId: "user-1",
    stripeCustomerId: null,
    stripeSubId: null,
    planTier: "FREE",
    seatCount: 0,
    isActive: true,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as Installation;
}

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: "user-1",
    email: "acme@example.com",
    name: "Acme Corp",
    passwordHash: "hash",
    status: "ACTIVE",
    githubId: null,
    githubLogin: null,
    githubAccessToken: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  } as User;
}

describe("BillingService", () => {
  let installationRepo: IBillingInstallationRepository;
  let userRepo: IUserRepository;
  let processedEventRepo: IProcessedEventRepository;
  let repoService: IRepoService;
  let stripeClient: IStripeClient;
  let service: BillingService;

  beforeEach(() => {
    installationRepo = {
      findById: vi.fn(),
      findByUserId: vi.fn(),
      findByStripeSubId: vi.fn(),
      updateBilling: vi.fn(),
    };
    userRepo = {
      findByEmail: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(),
      updateLastLogin: vi.fn(),
      lockEmail: vi.fn(),
      findByGithubId: vi.fn(),
      linkGithubIdentity: vi.fn(),
    };
    processedEventRepo = { exists: vi.fn().mockResolvedValue(false), create: vi.fn() };
    repoService = {
      listRepos: vi.fn(),
      activateRepo: vi.fn(),
      deactivateRepo: vi.fn(),
      getConfig: vi.fn(),
      updateConfig: vi.fn(),
      getStats: vi.fn(),
      enforceFreeTierLimit: vi.fn(),
    };
    stripeClient = {
      customers: { create: vi.fn() },
      checkout: { sessions: { create: vi.fn() } },
      billingPortal: { sessions: { create: vi.fn() } },
      subscriptions: { retrieve: vi.fn() },
      webhooks: { constructEvent: vi.fn() },
    };

    service = new BillingService(
      installationRepo,
      userRepo,
      processedEventRepo,
      repoService,
      stripeClient
    );
  });

  describe("getPlans", () => {
    it("returns all three plan tiers with limits and Stripe price IDs", () => {
      const result = service.getPlans();

      expect(result.plans.map((p) => p.tier)).toEqual(["FREE", "PRO", "TEAM"]);
      expect(result.plans[0]!.stripePriceId).toBeNull();
      expect(result.plans[1]!.stripePriceId).not.toBeNull();
      expect(result.plans[2]!.stripePriceId).not.toBeNull();
    });
  });

  describe("createCheckout", () => {
    it("creates a Stripe customer if none exists", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(buildInstallation());
      vi.mocked(userRepo.findById).mockResolvedValue(buildUser());
      vi.mocked(stripeClient.customers.create).mockResolvedValue({ id: "cus_new" });
      vi.mocked(stripeClient.checkout.sessions.create).mockResolvedValue({
        url: "https://checkout.stripe.com/session",
      });

      await service.createCheckout("user-1", { planTier: "PRO", seats: 5 });

      expect(stripeClient.customers.create).toHaveBeenCalledWith({
        email: "acme@example.com",
        name: "Acme Corp",
      });
      expect(installationRepo.updateBilling).toHaveBeenCalledWith("install-1", {
        stripeCustomerId: "cus_new",
      });
    });

    it("reuses existing Stripe customer if stripeCustomerId is set", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(
        buildInstallation({ stripeCustomerId: "cus_existing" })
      );
      vi.mocked(stripeClient.checkout.sessions.create).mockResolvedValue({
        url: "https://checkout.stripe.com/session",
      });

      await service.createCheckout("user-1", { planTier: "PRO", seats: 5 });

      expect(stripeClient.customers.create).not.toHaveBeenCalled();
      expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ customer: "cus_existing" })
      );
    });

    it("throws BadRequestError when already subscribed", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(
        buildInstallation({ planTier: "PRO" })
      );

      await expect(service.createCheckout("user-1", { planTier: "TEAM", seats: 5 })).rejects.toThrow(
        BadRequestError
      );
    });

    it("throws BadRequestError for seats < 1", async () => {
      await expect(service.createCheckout("user-1", { planTier: "PRO", seats: 0 })).rejects.toThrow(
        "Must purchase at least 1 seat"
      );
    });

    it("throws BadRequestError for seats > 500", async () => {
      await expect(
        service.createCheckout("user-1", { planTier: "PRO", seats: 501 })
      ).rejects.toThrow("Contact sales for > 500 seats");
    });

    it("throws BadRequestError for FREE tier checkout", async () => {
      await expect(
        service.createCheckout("user-1", { planTier: "FREE", seats: 5 })
      ).rejects.toThrow("Cannot checkout Free tier");
    });

    it("passes correct quantity to Stripe", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(
        buildInstallation({ stripeCustomerId: "cus_existing" })
      );
      vi.mocked(stripeClient.checkout.sessions.create).mockResolvedValue({
        url: "https://checkout.stripe.com/session",
      });

      await service.createCheckout("user-1", { planTier: "TEAM", seats: 12 });

      expect(stripeClient.checkout.sessions.create).toHaveBeenCalledWith(
        expect.objectContaining({ line_items: [expect.objectContaining({ quantity: 12 })] })
      );
    });

    it("returns checkout URL", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(
        buildInstallation({ stripeCustomerId: "cus_existing" })
      );
      vi.mocked(stripeClient.checkout.sessions.create).mockResolvedValue({
        url: "https://checkout.stripe.com/session",
      });

      const result = await service.createCheckout("user-1", { planTier: "PRO", seats: 5 });

      expect(result).toEqual({ url: "https://checkout.stripe.com/session" });
    });

    it("stores stripeCustomerId on installation after customer creation", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(buildInstallation());
      vi.mocked(userRepo.findById).mockResolvedValue(buildUser());
      vi.mocked(stripeClient.customers.create).mockResolvedValue({ id: "cus_new" });
      vi.mocked(stripeClient.checkout.sessions.create).mockResolvedValue({
        url: "https://checkout.stripe.com/session",
      });

      await service.createCheckout("user-1", { planTier: "PRO", seats: 5 });

      expect(installationRepo.updateBilling).toHaveBeenCalledWith(
        "install-1",
        expect.objectContaining({ stripeCustomerId: "cus_new" })
      );
    });

    it("throws AppError(502) when Stripe API is unavailable", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(
        buildInstallation({ stripeCustomerId: "cus_existing" })
      );
      vi.mocked(stripeClient.checkout.sessions.create).mockRejectedValue(new Error("network"));

      await expect(service.createCheckout("user-1", { planTier: "PRO", seats: 5 })).rejects.toThrow(
        AppError
      );
    });
  });

  describe("createPortal", () => {
    it("returns portal session URL when a Stripe customer exists", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(
        buildInstallation({ stripeCustomerId: "cus_existing" })
      );
      vi.mocked(stripeClient.billingPortal.sessions.create).mockResolvedValue({
        url: "https://billing.stripe.com/session",
      });

      const result = await service.createPortal("user-1");

      expect(result).toEqual({ url: "https://billing.stripe.com/session" });
    });

    it("throws BadRequestError when no Stripe customer ID", async () => {
      vi.mocked(installationRepo.findByUserId).mockResolvedValue(buildInstallation());

      await expect(service.createPortal("user-1")).rejects.toThrow("No active subscription found");
    });
  });

  describe("handleStripeWebhook", () => {
    it("throws BadRequestError when Stripe-Signature is missing", async () => {
      await expect(service.handleStripeWebhook(Buffer.from("{}"), undefined)).rejects.toThrow(
        "Missing Stripe-Signature"
      );
    });

    it("throws BadRequestError when signature verification fails", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockImplementation(() => {
        throw new Error("bad signature");
      });

      await expect(service.handleStripeWebhook(Buffer.from("{}"), "sig")).rejects.toThrow(
        "Invalid Stripe signature"
      );
    });

    it("returns early when event already processed (idempotent)", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: {} },
      });
      vi.mocked(processedEventRepo.exists).mockResolvedValue(true);

      const result = await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(result.message).toBe("Already processed");
      expect(processedEventRepo.create).not.toHaveBeenCalled();
    });

    it("sets planTier and seatCount on checkout.session.completed", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_1",
        type: "checkout.session.completed",
        data: {
          object: { subscription: "sub_1", metadata: { installationId: "install-1" } },
        },
      });
      vi.mocked(stripeClient.subscriptions.retrieve).mockResolvedValue({
        id: "sub_1",
        items: { data: [{ price: { id: process.env.STRIPE_PRICE_ID_PRO! }, quantity: 5 }] },
      });

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(installationRepo.updateBilling).toHaveBeenCalledWith("install-1", {
        planTier: "PRO",
        seatCount: 5,
        stripeSubId: "sub_1",
      });
    });

    it("downgrades to FREE on customer.subscription.deleted", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_1",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_1" } },
      });
      vi.mocked(installationRepo.findByStripeSubId).mockResolvedValue(
        buildInstallation({ id: "install-1", planTier: "PRO" })
      );

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(installationRepo.updateBilling).toHaveBeenCalledWith("install-1", {
        planTier: "FREE",
        seatCount: 0,
        stripeSubId: null,
      });
    });

    it("enforces free tier repo limit after downgrade", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_1",
        type: "customer.subscription.deleted",
        data: { object: { id: "sub_1" } },
      });
      vi.mocked(installationRepo.findByStripeSubId).mockResolvedValue(
        buildInstallation({ id: "install-1", planTier: "PRO" })
      );

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(repoService.enforceFreeTierLimit).toHaveBeenCalledWith("install-1");
    });

    it("syncs seats on customer.subscription.updated", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_1",
        type: "customer.subscription.updated",
        data: {
          object: {
            id: "sub_1",
            items: { data: [{ price: { id: process.env.STRIPE_PRICE_ID_TEAM! }, quantity: 8 }] },
          },
        },
      });
      vi.mocked(installationRepo.findByStripeSubId).mockResolvedValue(
        buildInstallation({ id: "install-1" })
      );

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      // customer.subscription.updated carries the full subscription object in event.data.object
      // (unlike checkout.session.completed, no extra `subscriptions.retrieve` round trip needed)
      expect(installationRepo.updateBilling).toHaveBeenCalledWith(
        "install-1",
        expect.objectContaining({ planTier: "TEAM", seatCount: 8 })
      );
    });

    it("logs error and returns 200 when installationId missing from metadata", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: { subscription: "sub_1", metadata: {} } },
      });

      const result = await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(result.message).toBe("OK");
      expect(installationRepo.updateBilling).not.toHaveBeenCalled();
    });

    it("returns 200 for unhandled event types", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_1",
        type: "invoice.payment_failed",
        data: { object: {} },
      });

      const result = await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(result.message).toBe("OK");
    });

    it("saves event.id to processed events for idempotency", async () => {
      vi.mocked(stripeClient.webhooks.constructEvent).mockReturnValue({
        id: "evt_unique",
        type: "invoice.paid",
        data: { object: {} },
      });

      await service.handleStripeWebhook(Buffer.from("{}"), "sig");

      expect(processedEventRepo.create).toHaveBeenCalledWith("evt_unique");
    });
  });
});
