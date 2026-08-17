import { Router } from "express";
import { CheckoutSchema } from "./billing.validator";
import { billingController } from "../../container";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate } from "../../middlewares/validate.middleware";

// `/billing/webhook` has no authMiddleware — Stripe authenticates via signature only
// (.ai/rules/backend.md route-audience table). Its raw-body parser is mounted in app.ts at
// the "/api/billing/webhook" prefix, ahead of the global express.json() — see the comment
// there and billing.controller.ts's handleWebhook.
export const billingRoutes = Router();

/**
 * @swagger
 * /billing/plans:
 *   get:
 *     summary: List plan tiers with pricing and limits
 *     tags: [Billing]
 */
billingRoutes.get("/plans", billingController.getPlans);

/**
 * @swagger
 * /billing/checkout:
 *   post:
 *     summary: Create a Stripe Checkout session to subscribe to a paid plan
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 */
billingRoutes.post(
  "/checkout",
  authMiddleware,
  validate(CheckoutSchema),
  billingController.createCheckout
);

/**
 * @swagger
 * /billing/portal:
 *   post:
 *     summary: Create a Stripe Customer Portal session
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 */
billingRoutes.post("/portal", authMiddleware, billingController.createPortal);

/**
 * @swagger
 * /billing/webhook:
 *   post:
 *     summary: Receive Stripe webhook events (checkout, invoice, subscription)
 *     tags: [Billing]
 */
billingRoutes.post("/webhook", billingController.handleWebhook);
