import { describe, expect, it } from "vitest";
import { dedupeIssues } from "../modules/reviews/dedupe-issues";
import type { GeminiIssue } from "../modules/reviews/review.types";

function issue(overrides: Partial<GeminiIssue & { file: string }> = {}): GeminiIssue & { file: string } {
  return { file: "a.ts", line: 1, severity: "warning", category: "logic", message: "Same finding", suggestion: "s", ...overrides };
}

describe("dedupeIssues", () => {
  it("collapses the same message on the same file, whatever the line", () => {
    const result = dedupeIssues([issue({ line: 1 }), issue({ line: 40 }), issue({ line: 300 })]);

    expect(result).toHaveLength(1);
    expect(result[0]!.line).toBe(1);
  });

  it("matches messages ignoring case and whitespace differences", () => {
    expect(dedupeIssues([issue({ message: "Same  finding" }), issue({ message: " same finding\n" })])).toHaveLength(1);
  });

  it("keeps the most severe copy of a duplicate", () => {
    const result = dedupeIssues([issue({ severity: "info", line: 1 }), issue({ severity: "critical", line: 9 }), issue({ severity: "warning" })]);

    expect(result).toEqual([expect.objectContaining({ severity: "critical", line: 9 })]);
  });

  it("keeps the same message on different files, and different messages on one file", () => {
    const result = dedupeIssues([issue(), issue({ file: "b.ts" }), issue({ message: "Another finding" })]);

    expect(result).toHaveLength(3);
  });

  it("preserves the order of first appearance", () => {
    const result = dedupeIssues([issue({ message: "first" }), issue({ message: "second" }), issue({ message: "first", severity: "critical" })]);

    expect(result.map((i) => i.message)).toEqual(["first", "second"]);
  });
});
