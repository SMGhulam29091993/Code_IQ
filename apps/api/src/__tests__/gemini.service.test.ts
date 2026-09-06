import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SanitizedRepoConfig } from "../modules/repos/repo.types";
import { GeminiService } from "../modules/reviews/gemini.service";
import type { IGeminiClient } from "../modules/reviews/review.types";

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
  return { response: { text: () => JSON.stringify(json) } };
}

describe("GeminiService.reviewDiff", () => {
  let client: IGeminiClient;
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

  it("limits issues to 50 (Zod .max(50))", async () => {
    const issues = Array.from({ length: 51 }, (_, i) => ({
      line: i,
      severity: "info",
      category: "style",
      message: "x",
      suggestion: "y",
    }));
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ issues, summary: "x" }));

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
    const client: IGeminiClient = { generateContent: vi.fn() };
    vi.mocked(client.generateContent).mockResolvedValue(mockResponse({ summary: "Looks good overall." }));
    const service = new GeminiService(client);

    const summary = await service.summarizePR("Add login flow", [
      { file: "a.ts", line: 1, severity: "info", category: "style", message: "m", suggestion: "s" },
    ]);

    expect(summary).toBe("Looks good overall.");
  });
});

// Added 2026-08-26 after a real all-chunks-rate-limited pipeline run — see review.job.ts's
// mapWithConcurrency comment and .ai/knowledge/domains/review.md "Implementation notes".
describe("GeminiService retry-on-429", () => {
  let client: IGeminiClient;
  let service: GeminiService;

  function rateLimitError(retryDelay: string) {
    return Object.assign(new Error("429 Too Many Requests"), {
      status: 429,
      errorDetails: [
        { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay },
      ],
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    client = { generateContent: vi.fn() };
    service = new GeminiService(client);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries after a 429 and succeeds on the next attempt", async () => {
    vi.mocked(client.generateContent)
      .mockRejectedValueOnce(rateLimitError("2s"))
      .mockResolvedValueOnce(mockResponse({ issues: [], summary: "ok" }));

    const promise = service.reviewDiff("patch", buildConfig(), "f.ts");
    await vi.advanceTimersByTimeAsync(2500); // Google's suggested delay + the small buffer

    const result = await promise;
    expect(result.summary).toBe("ok");
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });

  it("uses Google's suggested retryDelay rather than a fixed backoff", async () => {
    vi.mocked(client.generateContent)
      .mockRejectedValueOnce(rateLimitError("5s"))
      .mockResolvedValueOnce(mockResponse({ issues: [], summary: "ok" }));

    const promise = service.reviewDiff("patch", buildConfig(), "f.ts");
    await vi.advanceTimersByTimeAsync(1000); // well short of the 5s delay
    expect(client.generateContent).toHaveBeenCalledTimes(1); // hasn't retried yet

    await vi.advanceTimersByTimeAsync(4500); // now past 5s + buffer
    await promise;
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries and throws the last error", async () => {
    vi.mocked(client.generateContent).mockRejectedValue(rateLimitError("1s"));

    const promise = service.reviewDiff("patch", buildConfig(), "f.ts");
    const assertion = expect(promise).rejects.toThrow("429 Too Many Requests");
    await vi.advanceTimersByTimeAsync(60_000); // flush every retry's delay
    await assertion;

    expect(client.generateContent).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("also retries summarizePR, not just reviewDiff", async () => {
    vi.mocked(client.generateContent)
      .mockRejectedValueOnce(rateLimitError("1s"))
      .mockResolvedValueOnce(mockResponse({ summary: "done" }));

    const promise = service.summarizePR("title", []);
    await vi.advanceTimersByTimeAsync(1500);

    expect(await promise).toBe("done");
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });

  it("falls back to exponential backoff when the error has no retryDelay", async () => {
    vi.mocked(client.generateContent)
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(mockResponse({ issues: [], summary: "ok" }));

    const promise = service.reviewDiff("patch", buildConfig(), "f.ts");
    await vi.advanceTimersByTimeAsync(1000); // first backoff step is 1s

    expect(await promise).toEqual(expect.objectContaining({ summary: "ok" }));
    expect(client.generateContent).toHaveBeenCalledTimes(2);
  });
});
