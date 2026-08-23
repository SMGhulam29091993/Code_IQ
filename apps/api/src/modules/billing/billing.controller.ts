import type { Request, Response } from "express";
import type { CheckoutInput, GetInvoicesInput, IBillingService } from "./billing.types";
import { ok } from "../../lib/response";

// Thin HTTP handlers only — all business logic lives in BillingService.
export class BillingController {
  constructor(private readonly billingService: IBillingService) {}

  getPlans = (_req: Request, res: Response) => {
    const result = this.billingService.getPlans();
    res.status(200).json(ok(result));
  };

  createCheckout = async (req: Request, res: Response) => {
    const result = await this.billingService.createCheckout(
      req.user!.id,
      req.body as CheckoutInput
    );
    res.status(200).json(ok(result));
  };

  createPortal = async (req: Request, res: Response) => {
    const result = await this.billingService.createPortal(req.user!.id);
    res.status(200).json(ok(result));
  };

  getSubscription = async (req: Request, res: Response) => {
    const result = await this.billingService.getSubscription(req.user!.id);
    res.status(200).json(ok(result));
  };

  getSeats = async (req: Request, res: Response) => {
    const result = await this.billingService.getSeats(req.user!.id);
    res.status(200).json(ok(result));
  };

  getInvoices = async (req: Request, res: Response) => {
    const result = await this.billingService.getInvoices(
      req.user!.id,
      req.query as unknown as GetInvoicesInput
    );
    res.status(200).json(ok(result));
  };

  // Signature verified here (not middleware, unlike GitHub's webhook) because
  // stripeClient.webhooks.constructEvent both verifies and parses in one call — see
  // BillingService.handleStripeWebhook. req.body is still the raw Buffer here; app.ts mounts
  // express.raw() on this exact path ahead of the global express.json() (pitfall #001).
  handleWebhook = async (req: Request, res: Response) => {
    const signature = req.headers["stripe-signature"];
    const result = await this.billingService.handleStripeWebhook(
      req.body as Buffer,
      typeof signature === "string" ? signature : undefined
    );
    res.status(200).json(ok(null, result.message));
  };
}
