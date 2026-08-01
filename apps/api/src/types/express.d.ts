import type { User } from "@codeiq/db";

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}
