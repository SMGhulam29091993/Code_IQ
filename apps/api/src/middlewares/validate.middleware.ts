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
