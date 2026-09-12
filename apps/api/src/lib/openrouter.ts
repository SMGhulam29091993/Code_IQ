import { env } from "./env";
import type { ILLMClient } from "../modules/reviews/review.types";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Carries enough of the HTTP response for lib/llm-client.ts's retry/fallback logic: `status`
// and `retryAfterMs` (honor the provider's own suggested wait instead of guessing at
// exponential backoff) plus `retryable`, which this adapter — not the generic retry decorator —
// decides. Found empirically (2026-09-06, live-testing against the real API — decisions/008):
// OpenRouter's free models run on a shared, unreserved capacity pool, and under load the exact
// same well-formed request sometimes comes back as a proper 429 and sometimes as a misleading
// 400 "messages.0.content: Invalid input" — a status code alone can't tell a real malformed
// request (our own bug) apart from this. Since every request this client sends is built by our
// own code from a fixed shape, a 400 here is overwhelmingly more likely to be a mislabeled
// capacity blip than an actual bad request — so everything is retryable except a definite
// account-level problem (401/403), where retrying the *same* key obviously won't help.
export class LLMClientError extends Error {
  constructor(
    message: string,
    public readonly status: number | undefined,
    public readonly retryAfterMs: number | null,
    public readonly retryable: boolean = status !== 401 && status !== 403
  ) {
    super(message);
    this.name = "LLMClientError";
  }
}

// Adapter — translates ILLMClient's {systemInstruction, contents} request into OpenRouter's
// OpenAI-compatible /chat/completions body, and its response back into ILLMClient's plain
// {text} shape, so GeminiService (and everything above it) never knows OpenRouter exists. One
// instance per model id; lib/llm-client.ts's buildLLMClient constructs one per entry in
// OPEN_ROUTER_MODELS. Verified live against the real API 2026-09-06 — response_format:
// json_object is respected, cost: 0 on the free-tier models.
export class OpenRouterClient implements ILLMClient {
  constructor(private readonly model: string) {}

  async generateContent(request: {
    systemInstruction?: string;
    contents: Array<{ role: string; parts: Array<{ text: string }> }>;
  }): Promise<{ text: string }> {
    const messages = [
      ...(request.systemInstruction
        ? [{ role: "system", content: request.systemInstruction }]
        : []),
      ...request.contents.map((c) => ({
        role: c.role === "model" ? "assistant" : c.role,
        content: c.parts.map((p) => p.text).join("\n"),
      })),
    ];

    const res = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPEN_ROUTER_API_KEY}`,
        "Content-Type": "application/json",
        // Attribution headers OpenRouter recommends (optional) — usage shows up under this app
        // in OpenRouter's own dashboard instead of anonymously.
        "HTTP-Referer": "https://github.com/SMGhulam29091993/Code_IQ",
        "X-Title": "CodeIQ",
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      const retryAfterHeader = res.headers.get("retry-after");
      const parsedRetryAfterSec = retryAfterHeader ? Number.parseFloat(retryAfterHeader) : NaN;
      const retryAfterMs = Number.isFinite(parsedRetryAfterSec) ? parsedRetryAfterSec * 1000 : null;
      const body = await res.text().catch(() => "");
      throw new LLMClientError(
        `OpenRouter (${this.model}) ${res.status}: ${body.slice(0, 300)}`,
        res.status,
        retryAfterMs
      );
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = json.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new LLMClientError(
        `OpenRouter (${this.model}) returned no message content`,
        undefined,
        null
      );
    }
    return { text };
  }
}
