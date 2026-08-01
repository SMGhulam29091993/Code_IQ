import type { NextFunction, Request, Response } from "express";
import { AppError } from "../lib/errors";
import { fail } from "../lib/response";

// Must be registered last in app.ts — see .ai/rules/architecture-rules.md "Startup sequence".
// Express 5 forwards rejected promises from async handlers here automatically.
export function errorMiddleware(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json(fail(err.message));
  }
  console.error(err);
  return res.status(500).json(fail("Internal server error"));
}
