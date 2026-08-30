import { Router } from "express";
import { CheckoutSchema, GetInvoicesQuerySchema } from "./billing.validator";
import { billingController } from "../../container";
import { authMiddleware } from "../../middlewares/auth.middleware";
import { validate, validateQuery } from "../../middlewares/validate.middleware";

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
 * /billing/subscription:
 *   get:
 *     summary: Current plan, seat count, and next invoice summary
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 */
billingRoutes.get("/subscription", authMiddleware, billingController.getSubscription);

/**
 * @swagger
 * /billing/seats:
 *   get:
 *     summary: GitHub org members with role and PR review count for the current period
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 */
billingRoutes.get("/seats", authMiddleware, billingController.getSeats);

/**
 * @swagger
 * /billing/invoices:
 *   get:
 *     summary: Paginated Stripe invoice history
 *     tags: [Billing]
 *     security:
 *       - bearerAuth: []
 */
billingRoutes.get(
  "/invoices",
  authMiddleware,
  validateQuery(GetInvoicesQuerySchema),
  billingController.getInvoices
);

/**
 * @swagger
 * /billing/webhook:
 *   post:
 *     summary: Receive Stripe webhook events (checkout, invoice, subscription)
 *     tags: [Billing]
 */
billingRoutes.post("/webhook", billingController.handleWebhook);
