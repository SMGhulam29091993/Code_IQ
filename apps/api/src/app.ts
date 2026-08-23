import cors from "cors";
import express from "express";
import helmet from "helmet";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";
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

// Unauthenticated, outside /api — hit directly by Docker HEALTHCHECK / load balancer probes,
// not part of the versioned API surface. Checks both dependencies so a broken DB/Redis
// connection fails the container's health check instead of surfacing as request-time errors.
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    await redis.ping();
    res.status(200).json({ success: true, message: "OK", data: null });
  } catch (err) {
    res.status(503).json({
      success: false,
      message: err instanceof Error ? err.message : "Health check failed",
      data: null,
    });
  }
});

app.use("/api", router);

// Must be registered last — catches errors from every route above it.
app.use(errorMiddleware);
