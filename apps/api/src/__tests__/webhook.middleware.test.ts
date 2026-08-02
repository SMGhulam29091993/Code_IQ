import crypto from "node:crypto";
import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { env } from "../lib/env";
import { verifyGithubSignature } from "../modules/github/webhook.middleware";

function buildRes() {
  const res = {} as Response;
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res;
}

function sign(payload: Buffer) {
  return "sha256=" + crypto.createHmac("sha256", env.GITHUB_WEBHOOK_SECRET).update(payload).digest("hex");
}

describe("verifyGithubSignature", () => {
  it("returns 401 when the signature header is missing", () => {
    const req = { headers: {}, body: Buffer.from("{}") } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    verifyGithubSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when the signature does not match", () => {
    const payload = Buffer.from(JSON.stringify({ action: "opened" }));
    const req = {
      headers: { "x-hub-signature-256": "sha256=deadbeef" },
      body: payload,
    } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    verifyGithubSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() and parses the body to JSON when the signature is valid", () => {
    const payload = Buffer.from(JSON.stringify({ action: "opened", foo: "bar" }));
    const req = {
      headers: { "x-hub-signature-256": sign(payload) },
      body: payload,
    } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    verifyGithubSignature(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual({ action: "opened", foo: "bar" });
  });

  it("uses timingSafeEqual (rejects a same-length but wrong signature)", () => {
    const payload = Buffer.from(JSON.stringify({ action: "opened" }));
    const validSig = sign(payload);
    const wrongSig = "sha256=" + "f".repeat(validSig.length - 7);
    const req = {
      headers: { "x-hub-signature-256": wrongSig },
      body: payload,
    } as unknown as Request;
    const res = buildRes();
    const next = vi.fn();

    verifyGithubSignature(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
