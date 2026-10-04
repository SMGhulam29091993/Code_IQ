import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OllamaClient } from "../lib/ollama";
import { LLMClientError } from "../lib/openrouter";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("OllamaClient", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a non-streaming JSON-mode /api/chat request for the configured model", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: '{"ok":true}' } }));
    const client = new OllamaClient("http://localhost:11434/", "qwen2.5-coder:7b");

    await client.generateContent({
      systemInstruction: "system prompt",
      contents: [{ role: "user", parts: [{ text: "diff text" }] }],
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:11434/api/chat",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse(fetchMock.mock.calls[0]![1].body);
    expect(body.model).toBe("qwen2.5-coder:7b");
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.options.num_ctx).toBe(16_384);
    expect(body.messages).toEqual([
      { role: "system", content: "system prompt" },
      { role: "user", content: "diff text" },
    ]);
  });

  it("returns the message content as text", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ message: { content: '{"issues":[]}' } }));
    const client = new OllamaClient("http://localhost:11434", "m");

    const result = await client.generateContent({ contents: [] });

    expect(result.text).toBe('{"issues":[]}');
  });

  it("throws a non-retryable LLMClientError when Ollama is unreachable", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const client = new OllamaClient("http://localhost:11434", "m");

    const err = await client.generateContent({ contents: [] }).catch((e) => e);

    expect(err).toBeInstanceOf(LLMClientError);
    expect(err.retryable).toBe(false);
  });

  it("throws a non-retryable LLMClientError when the model is not pulled (404)", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "model not found" }, 404));
    const client = new OllamaClient("http://localhost:11434", "m");

    const err = await client.generateContent({ contents: [] }).catch((e) => e);

    expect(err).toBeInstanceOf(LLMClientError);
    expect(err.status).toBe(404);
    expect(err.retryable).toBe(false);
  });

  it("marks a 5xx as retryable", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "runner crashed" }, 500));
    const client = new OllamaClient("http://localhost:11434", "m");

    const err = await client.generateContent({ contents: [] }).catch((e) => e);

    expect(err.retryable).toBe(true);
  });

  it("throws when the response has no message content", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}));
    const client = new OllamaClient("http://localhost:11434", "m");

    await expect(client.generateContent({ contents: [] })).rejects.toBeInstanceOf(LLMClientError);
  });
});
