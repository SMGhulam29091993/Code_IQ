import { LLMClientError } from "./openrouter";
import type { ILLMClient } from "../modules/reviews/review.types";

// Big enough for buildSystemPrompt + a 300-line diff chunk (diff.service.ts's chunk size).
// Ollama's own default context window (2048–4096 depending on version) silently truncates the
// front of the prompt — i.e. the system instruction carrying the JSON schema — when exceeded,
// so it's set per-request rather than relying on whatever the local Modelfile happens to say.
const NUM_CTX = 16_384;

// A 7B model on a laptop can take tens of seconds on a large chunk; past this, fall through to
// the next tier instead of holding the chunk job (and its BullMQ lock) indefinitely.
const REQUEST_TIMEOUT_MS = 120_000;

// Adapter — local-development LLM tier (decisions/009). Translates ILLMClient's
// {systemInstruction, contents} request into Ollama's native /api/chat body and its response
// back into ILLMClient's plain {text} shape, same contract as lib/gemini.ts and
// lib/openrouter.ts. Uses the native endpoint rather than Ollama's OpenAI-compatible
// /v1/chat/completions because only the native one accepts per-request `options.num_ctx`.
//
// Retry classification is the inverse of OpenRouterClient's "retry almost everything": a local
// server that refuses the connection, times out, or doesn't have the model pulled won't fix
// itself within a backoff window, so those are non-retryable — FallbackLLMClient moves straight
// on to Gemini instead of RetryingLLMClient burning its backoff delays on a dead localhost.
// Only a 5xx (e.g. the model runner crashing mid-request) is worth a retry.
export class OllamaClient implements ILLMClient {
  constructor(
    private readonly baseUrl: string,
    private readonly model: string
  ) {}

  async generateContent(
    request: Parameters<ILLMClient["generateContent"]>[0]
  ): ReturnType<ILLMClient["generateContent"]> {
    const messages = [
      ...(request.systemInstruction
        ? [{ role: "system", content: request.systemInstruction }]
        : []),
      ...request.contents.map((c) => ({
        role: c.role === "model" ? "assistant" : c.role,
        content: c.parts.map((p) => p.text).join("\n"),
      })),
    ];

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages,
          stream: false,
          format: "json",
          options: { num_ctx: NUM_CTX, temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (err) {
      // Connection refused (Ollama not running) or the timeout above firing.
      throw new LLMClientError(
        `Ollama (${this.model}) unreachable at ${this.baseUrl}: ${String(err)}`,
        undefined,
        null,
        false
      );
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new LLMClientError(
        `Ollama (${this.model}) ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        null,
        res.status >= 500
      );
    }

    const json = (await res.json()) as { message?: { content?: string } };
    const text = json.message?.content;
    if (typeof text !== "string") {
      throw new LLMClientError(`Ollama (${this.model}) returned no message content`, undefined, null, false);
    }
    return { text };
  }
}
