import jwt from "jsonwebtoken";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { app } from "../app";
import { stripeClient } from "../lib/stripe";

vi.mock("@codeiq/db", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    installation: { findFirst: vi.fn(), update: vi.fn() },
    repo: { findMany: vi.fn(), updateMany: vi.fn() },
    processedStripeEvent: { findUnique: vi.fn(), create: vi.fn() },
  },
}));

vi.mock("ioredis", () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    ping: vi.fn().mockResolvedValue("PONG"),
  })),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue(undefined) }),
  },
}));

vi.mock("@octokit/rest", () => ({ Octokit: vi.fn().mockImplementation(() => ({ rest: {} })) }));
vi.mock("@octokit/auth-app", () => ({ createAppAuth: vi.fn() }));
vi.mock("../jobs/queue", () => ({ reviewQueue: { add: vi.fn() } }));

// Mock our own thin wrapper (same stance as ../jobs/queue above) rather than the "stripe"
// package itself — BillingService only ever depends on this module's exported instance.
vi.mock("../lib/stripe", () => ({
  stripeClient: {
    customers: { create: vi.fn() },
    checkout: { sessions: { create: vi.fn() } },
    billingPortal: { sessions: { create: vi.fn() } },
    subscriptions: { retrieve: vi.fn() },
    webhooks: { constructEvent: vi.fn() },
  },
}));

const NOW = new Date("2026-01-01T00:00:00Z");

function buildUser(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    name: "Ada Lovelace",
    passwordHash: "hash",
    status: "ACTIVE",
    githubId: null,
    githubLogin: null,
    githubAccessToken: null,
    lastLoginAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function buildInstallation(overrides: Partial<Record<string, unknown>> = {}) {
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
  };
}

function accessTokenFor(userId: string) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET!, { expiresIn: "15m" });
}

function mockPrisma() {
  return prisma as unknown as {
    user: { findUnique: ReturnType<typeof vi.fn> };
    installation: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
    repo: { findMany: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> };
    processedStripeEvent: { findUnique: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn> };
  };
}

function mockStripe() {
  return stripeClient as unknown as {
    customers: { create: ReturnType<typeof vi.fn> };
    checkout: { sessions: { create: ReturnType<typeof vi.fn> } };
    billingPortal: { sessions: { create: ReturnType<typeof vi.fn> } };
    subscriptions: { retrieve: ReturnType<typeof vi.fn> };
    webhooks: { constructEvent: ReturnType<typeof vi.fn> };
  };
}

describe("Billing routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("GET /api/billing/plans", () => {
    it("returns 200 with all plan tiers, no auth required", async () => {
      const res = await request(app).get("/api/billing/plans");

      expect(res.status).toBe(200);
      expect(res.body.data.plans.map((p: { tier: string }) => p.tier)).toEqual([
        "FREE",
        "PRO",
        "TEAM",
      ]);
    });
  });

  describe("POST /api/billing/checkout", () => {
    it("returns 401 without a token", async () => {
      const res = await request(app)
        .post("/api/billing/checkout")
        .send({ planTier: "PRO", seats: 5 });

      expect(res.status).toBe(401);
    });

    it("returns 200 with a checkout URL for a valid request", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findFirst.mockResolvedValueOnce(
        buildInstallation({ stripeCustomerId: "cus_existing" })
      );
      mockStripe().checkout.sessions.create.mockResolvedValueOnce({
        url: "https://checkout.stripe.com/session",
      });

      const res = await request(app)
        .post("/api/billing/checkout")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ planTier: "PRO", seats: 5 });

      expect(res.status).toBe(200);
      expect(res.body.data.url).toBe("https://checkout.stripe.com/session");
    });

    it("returns 400 for FREE tier checkout", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());

      const res = await request(app)
        .post("/api/billing/checkout")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ planTier: "FREE", seats: 5 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Cannot checkout Free tier");
    });

    it("returns 400 when already subscribed", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findFirst.mockResolvedValueOnce(
        buildInstallation({ planTier: "PRO" })
      );

      const res = await request(app)
        .post("/api/billing/checkout")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`)
        .send({ planTier: "TEAM", seats: 5 });

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Already subscribed — use billing portal to change plan");
    });
  });

  describe("POST /api/billing/portal", () => {
    it("returns 200 with a portal URL when a Stripe customer exists", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findFirst.mockResolvedValueOnce(
        buildInstallation({ stripeCustomerId: "cus_existing" })
      );
      mockStripe().billingPortal.sessions.create.mockResolvedValueOnce({
        url: "https://billing.stripe.com/session",
      });

      const res = await request(app)
        .post("/api/billing/portal")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`);

      expect(res.status).toBe(200);
      expect(res.body.data.url).toBe("https://billing.stripe.com/session");
    });

    it("returns 400 when no active subscription", async () => {
      mockPrisma().user.findUnique.mockResolvedValueOnce(buildUser());
      mockPrisma().installation.findFirst.mockResolvedValueOnce(buildInstallation());

      const res = await request(app)
        .post("/api/billing/portal")
        .set("Authorization", `Bearer ${accessTokenFor("user-1")}`);

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("No active subscription found");
    });
  });

  describe("POST /api/billing/webhook", () => {
    it("returns 400 when Stripe-Signature header is missing", async () => {
      const res = await request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ id: "evt_1" }));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Missing Stripe-Signature");
    });

    it("returns 400 when signature verification fails", async () => {
      mockStripe().webhooks.constructEvent.mockImplementationOnce(() => {
        throw new Error("bad signature");
      });

      const res = await request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", "bad-sig")
        .send(JSON.stringify({ id: "evt_1" }));

      expect(res.status).toBe(400);
      expect(res.body.message).toBe("Invalid Stripe signature");
    });

    it("returns 200 and processes checkout.session.completed", async () => {
      mockStripe().webhooks.constructEvent.mockReturnValueOnce({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: { subscription: "sub_1", metadata: { installationId: "install-1" } } },
      });
      mockPrisma().processedStripeEvent.findUnique.mockResolvedValueOnce(null);
      mockStripe().subscriptions.retrieve.mockResolvedValueOnce({
        id: "sub_1",
        items: { data: [{ price: { id: process.env.STRIPE_PRICE_ID_PRO! }, quantity: 5 }] },
      });

      const res = await request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", "valid-sig")
        .send(JSON.stringify({ id: "evt_1" }));

      expect(res.status).toBe(200);
      expect(mockPrisma().installation.update).toHaveBeenCalledWith({
        where: { id: "install-1" },
        data: { planTier: "PRO", seatCount: 5, stripeSubId: "sub_1" },
      });
    });

    it("returns 200 without reprocessing an already-processed event", async () => {
      mockStripe().webhooks.constructEvent.mockReturnValueOnce({
        id: "evt_1",
        type: "checkout.session.completed",
        data: { object: {} },
      });
      mockPrisma().processedStripeEvent.findUnique.mockResolvedValueOnce({ id: "evt_1" });

      const res = await request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("Stripe-Signature", "valid-sig")
        .send(JSON.stringify({ id: "evt_1" }));

      expect(res.status).toBe(200);
      expect(res.body.message).toBe("Already processed");
      expect(mockPrisma().processedStripeEvent.create).not.toHaveBeenCalled();
    });
  });
});
