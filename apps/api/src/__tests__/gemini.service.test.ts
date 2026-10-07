import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SanitizedRepoConfig } from "../modules/repos/repo.types";
import { GeminiService } from "../modules/reviews/gemini.service";
import type { ILLMClient } from "../modules/reviews/review.types";

function buildConfig(overrides: Partial<SanitizedRepoConfig> = {}): SanitizedRepoConfig {
  return {
    severityThreshold: "WARNING",
    enabledCategories: ["bug", "security", "performance", "logic"],
    ignorePatterns: [],
    reviewOnDraft: false,
    postSummaryComment: true,
    ...overrides,
  };
}

function mockResponse(json: unknown) {
  return { text: JSON.stringify(json) };
}

describe("GeminiService.reviewDiff", () => {
  let client: ILLMClient;
  let service: GeminiService;

  beforeEach(() => {
    client = { generateContent: vi.fn() };
    service = new GeminiService(client);
  });

  it("parses valid Gemini JSON response correctly", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(
      mockResponse({
        issues: [
          {
            line: 10,
            severity: "critical",
            category: "bug",
            message: "Null pointer",
            suggestion: "Add a null check",
          },
        ],
        summary: "One critical bug found.",
      })
    );

    const result = await service.reviewDiff("@@ -1 +1 @@", buildConfig(), "src/index.ts");

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toEqual({
      line: 10,
      severity: "critical",
      category: "bug",
      message: "Null pointer",
      suggestion: "Add a null check",
    });
    expect(result.summary).toBe("One critical bug found.");
  });

  it("throws ZodError when Gemini returns invalid schema", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(
      mockResponse({ issues: [{ line: "not-a-number" }], summary: "x" })
    );

    await expect(service.reviewDiff("patch", buildConfig(), "f.ts")).rejects.toThrow();
  });

  it("truncates to the first 50 issues instead of rejecting the chunk", async () => {
    const issues = Array.from({ length: 51 }, (_, i) => ({
      line: i,
      severity: "info",
      category: "style",
      message: "x",
      suggestion: "y",
    }));
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues, summary: "x" }));

    const result = await service.reviewDiff("patch", buildConfig(), "f.ts");

    expect(result.issues).toHaveLength(50);
    expect(result.issues[49]!.line).toBe(49);
  });

  // Found live 2026-10-07: a 201+-char message used to throw `too_big` and lose the whole chunk.
  it("truncates an over-long message, suggestion and summary instead of rejecting the chunk", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(
      mockResponse({
        issues: [{ line: 1, severity: "warning", category: "bug", message: "m".repeat(250), suggestion: "s".repeat(600) }],
        summary: "z".repeat(700),
      })
    );

    const result = await service.reviewDiff("patch", buildConfig(), "f.ts");

    expect(result.issues[0]!.message).toHaveLength(200);
    expect(result.issues[0]!.message.endsWith("…")).toBe(true);
    expect(result.issues[0]!.suggestion).toHaveLength(500);
    expect(result.summary).toHaveLength(500);
  });

  it("still rejects genuinely malformed issues (unknown severity)", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(
      mockResponse({ issues: [{ line: 1, severity: "blocker", category: "bug", message: "m", suggestion: "s" }], summary: "x" })
    );

    await expect(service.reviewDiff("patch", buildConfig(), "f.ts")).rejects.toThrow();
  });

  it("passes responseMimeType via the injected client (constructed in lib/gemini.ts)", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues: [], summary: "x" }));

    await service.reviewDiff("patch", buildConfig(), "f.ts");

    expect(client.generateContent).toHaveBeenCalledWith(
      expect.objectContaining({ contents: [{ role: "user", parts: [{ text: "patch" }] }] })
    );
  });

  it("includes filename in system prompt", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues: [], summary: "x" }));

    await service.reviewDiff("patch", buildConfig(), "src/weird-file.ts");

    const call = vi.mocked(client.generateContent).mock.calls[0]![0];
    expect(call.systemInstruction).toContain("src/weird-file.ts");
  });

  it("includes enabled categories in system prompt", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues: [], summary: "x" }));

    await service.reviewDiff("patch", buildConfig({ enabledCategories: ["security"] }), "f.ts");

    const call = vi.mocked(client.generateContent).mock.calls[0]![0];
    expect(call.systemInstruction).toContain("security");
  });

  // 2026-10-08: 6 of PR #17's 11 warnings were "X is never used" — the model sees one diff
  // fragment, not the uses elsewhere. The prompt now tells it so and forbids those claims.
  it("tells the model it sees a fragment and must not report unused/undefined symbols", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues: [], summary: "x" }));

    await service.reviewDiff("patch", buildConfig(), "f.ts");

    const call = vi.mocked(client.generateContent).mock.calls[0]![0];
    expect(call.systemInstruction).toContain("ONE FRAGMENT");
    expect(call.systemInstruction).toContain("Do NOT report unused or undefined");
    expect(call.systemInstruction).toContain("lines starting with \"+\"");
  });

  it("drops unused/undefined/missing-import claims the model can't verify from a fragment", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(
      mockResponse({
        issues: [
          { line: 1, severity: "warning", category: "logic", message: "Variable 'x' is declared but never used.", suggestion: "s" },
          { line: 2, severity: "critical", category: "security", message: "SQL injection in query builder.", suggestion: "s" },
        ],
        summary: "x",
      })
    );

    const result = await service.reviewDiff("patch", buildConfig(), "f.ts");

    expect(result.issues.map((i) => i.message)).toEqual(["SQL injection in query builder."]);
  });

  it("includes severity threshold in system prompt", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues: [], summary: "x" }));

    await service.reviewDiff("patch", buildConfig({ severityThreshold: "CRITICAL" }), "f.ts");

    const call = vi.mocked(client.generateContent).mock.calls[0]![0];
    expect(call.systemInstruction).toContain("CRITICAL");
  });

  it("handles empty patch (returns 0 issues)", async () => {
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues: [], summary: "No changes." }));

    const result = await service.reviewDiff("", buildConfig(), "f.ts");

    expect(result.issues).toEqual([]);
  });
});

describe("GeminiService.summarizePR", () => {
  it("returns the summary string from Gemini's JSON response", async () => {
    const client: ILLMClient = { generateContent: vi.fn() };
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ summary: "Looks good overall." }));
    const service = new GeminiService(client);

    const summary = await service.summarizePR("Add login flow", [
      { file: "a.ts", line: 1, severity: "info", category: "style", message: "m", suggestion: "s" },
    ]);

    expect(summary).toBe("Looks good overall.");
  });
});

// Retry-with-backoff and multi-model fallback used to be tested here (added 2026-08-26) but
// moved to lib/llm-client.test.ts along with the logic itself (decisions/008, 2026-09-06) —
// GeminiService no longer retries anything; it just calls whatever ILLMClient it's given once.
