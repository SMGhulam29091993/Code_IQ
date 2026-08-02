import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../../lib/env";
import { fail } from "../../lib/response";

// Exact behaviour from .ai/knowledge/domains/github-app.md#webhook — runs before any other
// processing (.ai/rules/security.md #3). Relies on express.raw() being mounted for this exact
// path in app.ts, ahead of the global express.json() parser, so req.body is still the raw
// Buffer here (same pitfall as Stripe — .ai/memory/pitfalls.md #001).
export function verifyGithubSignature(req: Request, res: Response, next: NextFunction) {
  const signature = req.headers["x-hub-signature-256"];
  if (!signature || typeof signature !== "string") {
    return res.status(401).json(fail("Missing signature"));
  }

  const payload = req.body as Buffer;
  const expected =
    "sha256=" + crypto.createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(payload).digest("hex");

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  const valid =
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
  if (!valid) {
    return res.status(401).json(fail("Invalid signature"));
  }

  // Safe to parse now that the signature is verified against the raw bytes.
  req.body = JSON.parse(payload.toString("utf8"));
  next();
}
