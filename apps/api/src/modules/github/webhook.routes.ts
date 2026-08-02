import { Router } from "express";
import { verifyGithubSignature } from "./webhook.middleware";
import { webhookController } from "../../container";

// No JWT — GitHub authenticates via HMAC signature only (.ai/rules/backend.md route-audience
// table). The raw-body parser this route depends on is mounted in app.ts at the "/api/webhooks"
// prefix, ahead of the global express.json() — see the comment there and
// webhook.middleware.ts.
export const webhookRoutes = Router();

/**
 * @swagger
 * /webhooks/github:
 *   post:
 *     summary: Receive GitHub App webhook events (pull_request, installation, ...)
 *     tags: [Webhooks]
 */
webhookRoutes.post("/github", verifyGithubSignature, webhookController.handleWebhook);
