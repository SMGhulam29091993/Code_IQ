import cors from "cors";
import express from "express";
import helmet from "helmet";
import { errorMiddleware } from "./middlewares/error.middleware";
import { router } from "./routes/index";

export const app = express();

app.use(helmet());
app.use(cors());
// GitHub (`/webhooks/*`, Step 3) and Stripe (`/billing/webhook`, Step 6) routes need the
// raw body for signature verification (.ai/rules/security.md #3, #6). Mount `express.raw()`
// on those exact paths before this global parser runs, or exclude them via
// `express.json({ path: [...] })` — otherwise this middleware consumes the stream first.
app.use(express.json());

// GET /health is .ai/plans/backend.md Step 7 (Deploy), not Step 1 — added there.
app.use("/api", router);

// Must be registered last — catches errors from every route above it.
app.use(errorMiddleware);
