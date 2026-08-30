import type { NextFunction, Request, Response } from "express";
import type { ZodSchema } from "zod";
import { fail } from "../lib/response";

// Exact shape from .ai/rules/coding-standards.md "Validation pattern".
export const validate =
  (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Zod guarantees at least one issue when safeParse fails.
      return res.status(400).json(fail(result.error.errors[0]!.message));
    }
    req.body = result.data; // replace with parsed+stripped data
    next();
  };

// Same pattern, for query-string params — needed starting with GET /github/oauth/callback
// (.ai/knowledge/domains/auth.md), which takes `{ code, state }` as query params, not a body.
// Express 5's req.query is a non-caching getter (re-parses req.url on every access, no setter)
// — `Object.assign(req.query, result.data)` therefore mutates a throwaway object and the
// coercion is silently lost by the next `req.query` read. Confirmed empirically: every
// `z.coerce.number()`/`z.coerce.boolean()` field validated this way (page/limit/days/isActive
// across `modules/repos`, `modules/reviews`, `modules/billing`) was reaching Prisma as a raw
// string, which throws `PrismaClientValidationError` for non-string columns/params — caught via
// a real browser session against `GET /reviews`, not by any test (every test mocks `req.query`
// directly as an object literal, which happens to already be the shape `safeParse` returns).
// Fix: replace the getter with a plain value property via defineProperty, so later `req.query`
// reads return the coerced object instead of re-parsing the URL.
export const validateQuery =
  (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json(fail(result.error.errors[0]!.message));
    }
    Object.defineProperty(req, "query", { value: result.data, configurable: true });
    next();
  };
