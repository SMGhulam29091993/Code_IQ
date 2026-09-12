import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LLMClientError, OpenRouterClient } from "../lib/openrouter";

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

describe("OpenRouterClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends an OpenAI-compatible chat completions request for the configured model", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '{"ok":true}' } }] })
    );
    const client = new OpenRouterClient("some/model:free");

    await client.generateContent({
      systemInstruction: "system prompt",
      contents: [{ role: "user", parts: [{ text: "diff text" }] }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/chat/completions",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe("some/model:free");
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "diff text" },
    ]);
  });

  it("returns the message content as text", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ choices: [{ message: { content: '{"issues":[]}' } }] })
    );
    const client = new OpenRouterClient("some/model:free");

    const result = await client.generateContent({ contents: [] });

    expect(result.text).toBe('{"issues":[]}');
  });

  it("omits the system message when systemInstruction is not given", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: { content: "{}" } }] }));
    const client = new OpenRouterClient("some/model:free");

    await client.generateContent({ contents: [{ role: "user", parts: [{ text: "x" }] }] });

    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.messages).toEqual([{ role: "user", content: "x" }]);
  });

  it("throws LLMClientError with the HTTP status on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "rate limited" }, { status: 429 }));
    const client = new OpenRouterClient("some/model:free");

    const err = await client.generateContent({ contents: [] }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(LLMClientError);
    expect((err as LLMClientError).status).toBe(429);
  });

  // Free-model shared-pool capacity errors sometimes surface as a 400 instead of a proper 429
  // (found live 2026-09-06 — decisions/008), so this adapter marks everything but a definite
  // account-level failure as worth retrying/falling back on, regardless of status code.
  it("marks a 400 as retryable — OpenRouter's free tier sometimes mislabels capacity errors this way", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: { message: "messages.0.content: Invalid input" } }, { status: 400 })
    );
    const client = new OpenRouterClient("some/model:free");

    const err = await client.generateContent({ contents: [] }).catch((e: unknown) => e);

    expect((err as LLMClientError).retryable).toBe(true);
  });

  it("marks 401/403 as not retryable — retrying the same key won't fix an auth problem", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "unauthorized" }, { status: 401 }));
    const client = new OpenRouterClient("some/model:free");

    const err = await client.generateContent({ contents: [] }).catch((e: unknown) => e);

    expect((err as LLMClientError).retryable).toBe(false);
  });

  it("carries a Retry-After header into retryAfterMs", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "rate limited" }, { status: 429, headers: { "retry-after": "3" } })
    );
    const client = new OpenRouterClient("some/model:free");

    const err = await client.generateContent({ contents: [] }).catch((e: unknown) => e);

    expect((err as LLMClientError).retryAfterMs).toBe(3000);
  });

  it("throws LLMClientError when the response has no message content", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ message: {} }] }));
    const client = new OpenRouterClient("some/model:free");

    await expect(client.generateContent({ contents: [] })).rejects.toBeInstanceOf(LLMClientError);
  });
});
