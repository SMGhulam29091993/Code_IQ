import type { Installation, User } from "@codeiq/db";

declare global {
  namespace Express {
    interface Request {
      user?: User;
      // Attached by installation.middleware.ts — see .ai/memory/pitfalls.md #005.
      installation?: Installation;
    }
  }
}
