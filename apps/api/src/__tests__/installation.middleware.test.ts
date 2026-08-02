import type { Request, Response } from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { installationMiddleware } from "../modules/github/installation.middleware";

vi.mock("@codeiq/db", () => ({
  prisma: { installation: { findUnique: vi.fn() } },
}));

function buildRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

describe("installationMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches req.installation when the installation exists and is owned by req.user", async () => {
    const installation = { id: "install-1", userId: "user-1" };
    vi.mocked(prisma.installation.findUnique).mockResolvedValue(installation as never);
    const req = { params: { installationId: "install-1" }, user: { id: "user-1" } } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    await installationMiddleware(req, res, next);

    expect(req.installation).toBe(installation);
    expect(next).toHaveBeenCalled();
  });

  it("returns 400 when installationId param is missing", async () => {
    const req = { params: {}, user: { id: "user-1" } } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    await installationMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 404 when the installation does not exist", async () => {
    vi.mocked(prisma.installation.findUnique).mockResolvedValue(null);
    const req = { params: { installationId: "missing" }, user: { id: "user-1" } } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    await installationMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the installation belongs to another user", async () => {
    vi.mocked(prisma.installation.findUnique).mockResolvedValue({
      id: "install-1",
      userId: "someone-else",
    } as never);
    const req = { params: { installationId: "install-1" }, user: { id: "user-1" } } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    await installationMiddleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
