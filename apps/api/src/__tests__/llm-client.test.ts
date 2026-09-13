import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FallbackLLMClient, RetryingLLMClient } from "../lib/llm-client";
import type { ILLMClient } from "../modules/reviews/review.types";

function mockResponse(text: string) {
  return { text };
}

function geminiRateLimitError(retryDelay: string) {
  return Object.assign(new Error("429 Too Many Requests"), {
    status: 429,
    errorDetails: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay }],
  });
}

function geminiDailyQuotaError() {
  return Object.assign(new Error("429 Too Many Requests"), {
    status: 429,
    errorDetails: [
      {
        "@type": "type.googleapis.com/google.rpc.QuotaFailure",
        violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
      },
      { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "59s" },
    ],
  });
}

function openRouterError(status: number, retryAfterMs: number | null = null) {
  return Object.assign(new Error(`OpenRouter ${status}`), { status, retryAfterMs });
}

// Moved from gemini.service.test.ts's "GeminiService retry-on-429" describe block
// (decisions/008, 2026-09-06) — retry-with-backoff is now this decorator's own concern, not
// GeminiService's.
describe("RetryingLLMClient", () => {
  let inner: ILLMClient;
  let client: RetryingLLMClient;

  beforeEach(() => {
    vi.useFakeTimers();
    inner = { generateContent: vi.fn() };
    client = new RetryingLLMClient(inner, "test-model");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries after a 429 and succeeds on the next attempt", async () => {
    vi.mocked(inner.generateContent)
      .mockRejectedValueOnce(geminiRateLimitError("2s"))
      .mockResolvedValueOnce(mockResponse("ok"));

    const promise = client.generateContent({ contents: [] });
    await vi.advanceTimersByTimeAsync(2500); // Google's suggested delay + the small buffer

    const result = await promise;
    expect(result.text).toBe("ok");
    expect(inner.generateContent).toHaveBeenCalledTimes(2);
  });

  it("uses Gemini's suggested retryDelay rather than a fixed backoff", async () => {
    vi.mocked(inner.generateContent)
      .mockRejectedValueOnce(geminiRateLimitError("5s"))
      .mockResolvedValueOnce(mockResponse("ok"));

    const promise = client.generateContent({ contents: [] });
    await vi.advanceTimersByTimeAsync(1000); // well short of the 5s delay
    expect(inner.generateContent).toHaveBeenCalledTimes(1); // hasn't retried yet

    await vi.advanceTimersByTimeAsync(4500); // now past 5s + buffer
    await promise;
    expect(inner.generateContent).toHaveBeenCalledTimes(2);
  });

  it("uses an OpenRouter-style retryAfterMs the same way", async () => {
    vi.mocked(inner.generateContent)
      .mockRejectedValueOnce(openRouterError(429, 3000))
      .mockResolvedValueOnce(mockResponse("ok"));

    const promise = client.generateContent({ contents: [] });
    await vi.advanceTimersByTimeAsync(2000);
    expect(inner.generateContent).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1500);
    await promise;
    expect(inner.generateContent).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting retries and throws the last error", async () => {
    vi.mocked(inner.generateContent).mockRejectedValue(geminiRateLimitError("1s"));

    const promise = client.generateContent({ contents: [] });
    const assertion = expect(promise).rejects.toThrow("429 Too Many Requests");
    await vi.advanceTimersByTimeAsync(60_000); // flush every retry's delay
    await assertion;

    expect(inner.generateContent).toHaveBeenCalledTimes(4); // 1 initial + 3 retries
  });

  it("falls back to exponential backoff when the error has no retry info", async () => {
    vi.mocked(inner.generateContent)
      .mockRejectedValueOnce(new Error("network blip"))
      .mockResolvedValueOnce(mockResponse("ok"));

    const promise = client.generateContent({ contents: [] });
    await vi.advanceTimersByTimeAsync(1000); // first backoff step is 1s

    expect((await promise).text).toBe("ok");
    expect(inner.generateContent).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable status (e.g. 401) — fails immediately", async () => {
    vi.mocked(inner.generateContent).mockRejectedValue(openRouterError(401));

    await expect(client.generateContent({ contents: [] })).rejects.toThrow("OpenRouter 401");
    expect(inner.generateContent).toHaveBeenCalledTimes(1);
  });

  it("does not retry a daily-quota 429 even though it carries a short suggested delay", async () => {
    // Found empirically live-testing against the real Gemini API (decisions/008) — a "PerDay"
    // quotaId means backing off for the suggested delay and retrying is pointless; only a
    // calendar-day reset fixes it. Should fail after exactly 1 attempt, not MAX_RETRIES + 1.
    vi.mocked(inner.generateContent).mockRejectedValue(geminiDailyQuotaError());

    await expect(client.generateContent({ contents: [] })).rejects.toThrow("429 Too Many Requests");
    expect(inner.generateContent).toHaveBeenCalledTimes(1);
  });
});

// New with the OpenRouter fallback tier (decisions/008, 2026-09-06).
describe("FallbackLLMClient", () => {
  it("returns the first client's result without touching the rest", async () => {
    const first: ILLMClient = { generateContent: vi.fn().mockResolvedValue(mockResponse("a")) };
    const second: ILLMClient = { generateContent: vi.fn() };
    const chain = new FallbackLLMClient([
      { client: first, label: "first" },
      { client: second, label: "second" },
    ]);

    const result = await chain.generateContent({ contents: [] });

    expect(result.text).toBe("a");
    expect(second.generateContent).not.toHaveBeenCalled();
  });

  it("falls through to the next client when the first fails", async () => {
    const first: ILLMClient = {
      generateContent: vi.fn().mockRejectedValue(new Error("quota exceeded")),
    };
    const second: ILLMClient = { generateContent: vi.fn().mockResolvedValue(mockResponse("b")) };
    const chain = new FallbackLLMClient([
      { client: first, label: "first" },
      { client: second, label: "second" },
    ]);

    const result = await chain.generateContent({ contents: [] });

    expect(result.text).toBe("b");
  });

  it("throws the last error when every client fails", async () => {
    const first: ILLMClient = { generateContent: vi.fn().mockRejectedValue(new Error("fail 1")) };
    const second: ILLMClient = {
      generateContent: vi.fn().mockRejectedValue(new Error("fail 2")),
    };
    const chain = new FallbackLLMClient([
      { client: first, label: "first" },
      { client: second, label: "second" },
    ]);

    await expect(chain.generateContent({ contents: [] })).rejects.toThrow("fail 2");
  });

  it("throws at construction time when given no clients", () => {
    expect(() => new FallbackLLMClient([])).toThrow();
  });

  // codeiq29091993 Bot's own review of decisions/008 (2026-09-12): OpenRouter's account-level
  // throttle takes every configured model down at once, and the per-tier warnings alone mean
  // piecing that together from N log lines. This one clear, greppable summary line is the fix —
  // doesn't recover from the throttle (that still needs the $10 credit purchase, external to
  // this code), just makes the failure mode diagnosable at a glance.
  it("logs one summary line naming every tier and its failure reason when the whole chain is exhausted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const first: ILLMClient = {
      generateContent: vi.fn().mockRejectedValue(openRouterError(429)),
    };
    const second: ILLMClient = {
      generateContent: vi.fn().mockRejectedValue(openRouterError(401)),
    };
    const chain = new FallbackLLMClient([
      { client: first, label: "first" },
      { client: second, label: "second" },
    ]);

    await expect(chain.generateContent({ contents: [] })).rejects.toThrow();

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("ALL_TIERS_EXHAUSTED (2/2 tiers failed): first=429, second=401")
    );
    consoleError.mockRestore();
  });

  it("labels a daily-quota 429 distinctly from a plain 429 in the summary line", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const first: ILLMClient = {
      generateContent: vi.fn().mockRejectedValue(geminiDailyQuotaError()),
    };
    const chain = new FallbackLLMClient([{ client: first, label: "gemini-2.5-flash" }]);

    await expect(chain.generateContent({ contents: [] })).rejects.toThrow();

    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("gemini-2.5-flash=429(daily quota)"));
    consoleError.mockRestore();
  });
});
