import type { Request, Response } from "express";
import type { IWebhookService } from "./github.types";
import { ok } from "../../lib/response";

// Thin HTTP handler — signature verification happens in webhook.middleware.ts (before this
// ever runs); event routing/business logic lives in WebhookService. Errors thrown by the
// service (e.g. AppError 503 when the queue is unreachable) propagate to error.middleware.ts
// automatically — Express 5 async error propagation, .ai/rules/backend.md "Async error
// propagation". Every other path returns 200, per .ai/rules/backend.md #6.
export class WebhookController {
  constructor(private readonly webhookService: IWebhookService) {}

  handleWebhook = async (req: Request, res: Response) => {
    const event = req.headers["x-github-event"];
    const deliveryId = req.headers["x-github-delivery"];
    if (typeof event !== "string") {
      res.status(200).json(ok(null, "Event ignored"));
      return;
    }

    const message = await this.webhookService.handle({
      event,
      deliveryId: typeof deliveryId === "string" ? deliveryId : undefined,
      body: req.body,
    });
    res.status(200).json(ok(null, message));
  };
}
