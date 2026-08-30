import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateQuery } from "../middlewares/validate.middleware";

// Regression test for a real bug caught via a live browser session (not by any existing test —
// every route/service test mocks req.query as a plain object literal, which happens to already
// be the shape z.coerce produces). Express 5's req.query is a non-caching getter: it re-parses
// req.url on every access, so mutating the object returned by one access
// (Object.assign(req.query, coerced)) is silently discarded by the next read. This exercises the
// real Express query-string parsing path, not a mock, so it would have caught the bug.
describe("validateQuery", () => {
  it("coerces query string values to the schema's types before the route handler runs", async () => {
    const schema = z.object({
      page: z.coerce.number().int().default(1),
      limit: z.coerce.number().int().default(20),
      isActive: z.coerce.boolean().optional(),
    });

    const app = express();
    app.get("/test", validateQuery(schema), (req, res) => {
      res.json({
        page: req.query.page,
        pageType: typeof req.query.page,
        limit: req.query.limit,
        isActive: req.query.isActive,
      });
    });

    const res = await request(app).get("/test?page=2&limit=50&isActive=true");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page: 2, pageType: "number", limit: 50, isActive: true });
  });

  it("returns 400 when the query fails validation", async () => {
    const schema = z.object({ limit: z.coerce.number().max(100, "Limit cannot exceed 100") });
    const app = express();
    app.get("/test", validateQuery(schema), (_req, res) => res.json({ ok: true }));

    const res = await request(app).get("/test?limit=500");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Limit cannot exceed 100");
  });
});
