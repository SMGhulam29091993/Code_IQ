import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorMiddleware } from "./middlewares/error.middleware";
import { router } from "./routes/index";

export const app = express();

app.use(helmet());
app.use(cors());
// GitHub (`/webhooks/*`) and Stripe (`/billing/webhook`) routes need the raw body for
// signature verification (.ai/rules/security.md #3, #6) — see webhook.middleware.ts,
// billing.controller.ts, and pitfall 001. express.raw() is mounted on each exact webhook path
// before express.json() runs, and express.json() explicitly skips those paths so the stream is
// never read twice.
const RAW_BODY_PATHS = ["/api/webhooks", "/api/billing/webhook"];
app.use((req, res, next) => {
  if (RAW_BODY_PATHS.some((p) => req.path.startsWith(p))) {
    return express.raw({ type: "application/json" })(req, res, next);
  }
  return next();
});
app.use((req, res, next) => {
  if (RAW_BODY_PATHS.some((p) => req.path.startsWith(p))) return next();
  return express.json()(req, res, next);
});

// GET /health is .ai/plans/backend.md Step 7 (Deploy), not Step 1 — added there.
app.use("/api", router);

// Must be registered last — catches errors from every route above it.
app.use(errorMiddleware);
