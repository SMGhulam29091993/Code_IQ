import rateLimit from "express-rate-limit";
import { fail } from "../lib/response";

// 10 req / IP / 15 min on auth routes — see .ai/rules/security.md #8 and every
// endpoint's "Rate limit" line in .ai/knowledge/domains/auth.md.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    res.status(429).json(fail("Too many requests, please try again later"));
  },
});
