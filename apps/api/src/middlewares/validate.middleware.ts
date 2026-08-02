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
// Express 5's req.query is a getter with no setter, so — unlike `validate` above — this
// mutates the existing object in place rather than reassigning req.query.
export const validateQuery =
  (schema: ZodSchema) => (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      return res.status(400).json(fail(result.error.errors[0]!.message));
    }
    Object.assign(req.query as object, result.data);
    next();
  };
