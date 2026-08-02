import type { NextFunction, Request, Response } from "express";
import { prisma } from "@codeiq/db";
import { fail } from "../../lib/response";

// Tenant-isolation gate for any authenticated route shaped `/:installationId/...` — attaches
// `req.installation` once ownership is confirmed. Not yet mounted on a live route: Step 3's
// own DELETE /github/installations/:installationId does its ownership check inline in
// GithubService (matching the documented unit tests in
// .ai/knowledge/domains/github-app.md#delete-installation). This middleware exists for the
// Repo/Review modules (.ai/plans/backend.md Step 4/5), which scope every query by
// installationId — see .ai/memory/pitfalls.md #005. Same direct-Prisma pattern as
// auth.middleware.ts (middleware may call Prisma directly; only services may not).
export async function installationMiddleware(req: Request, res: Response, next: NextFunction) {
  const installationId = req.params.installationId as string | undefined;
  if (!installationId) {
    return res.status(400).json(fail("installationId is required"));
  }

  const installation = await prisma.installation.findUnique({ where: { id: installationId } });
  if (!installation) {
    return res.status(404).json(fail("Installation not found"));
  }
  if (installation.userId !== req.user?.id) {
    return res.status(403).json(fail("Forbidden"));
  }

  req.installation = installation;
  next();
}
