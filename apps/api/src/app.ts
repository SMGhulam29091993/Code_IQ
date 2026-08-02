import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorMiddleware } from "./middlewares/error.middleware";
import { router } from "./routes/index";

export const app = express();

app.use(helmet());
app.use(cors());
// GitHub (`/webhooks/*`) and Stripe (`/billing/webhook`, Step 6) routes need the raw body
// for signature verification (.ai/rules/security.md #3, #6) — see webhook.middleware.ts and
// pitfall 001. express.raw() is mounted on the exact webhook prefix before express.json()
// runs, and express.json() explicitly skips that prefix so the stream is never read twice.
app.use("/api/webhooks", express.raw({ type: "application/json" }));
app.use((req, res, next) => {
  if (req.path.startsWith("/api/webhooks")) return next();
  return express.json()(req, res, next);
});

// GET /health is .ai/plans/backend.md Step 7 (Deploy), not Step 1 — added there.
app.use("/api", router);

// Must be registered last — catches errors from every route above it.
app.use(errorMiddleware);
