import { describe, expect, it } from "vitest";
import { formatJobError } from "../jobs/worker";

describe("formatJobError", () => {
  it("returns the error's stack", () => {
    const err = new Error("boom");
    expect(formatJobError(err)).toBe(err.stack);
  });

  it("appends the cause's stack when there is one", () => {
    const err = new Error("outer", { cause: new Error("inner") });
    const out = formatJobError(err);
    expect(out).toContain("Error: outer");
    expect(out).toContain("[cause] Error: inner");
  });

  it("stringifies non-Error values", () => {
    expect(formatJobError("plain string")).toBe("plain string");
    expect(formatJobError(undefined)).toBe("undefined");
  });

  // The 2026-10-04 crash: inspecting the error threw instead of logging it.
  it("never throws, even when reading the error's stack does", () => {
    const err = new Error("x");
    Object.defineProperty(err, "stack", {
      get() {
        throw new TypeError("Cannot read properties of undefined (reading 'value')");
      },
    });
    expect(formatJobError(err)).toBe("<error could not be formatted>");
  });
});
