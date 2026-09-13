import { GoogleGenerativeAI } from "@google/generative-ai";
import type { GenerativeModel } from "@google/generative-ai";
import { env } from "./env";
import type { ILLMClient } from "../modules/reviews/review.types";

// Gemini 2.5 Flash — .ai/knowledge/technical/backend/architecture.md "AI model". Originally
// gemini-1.5-pro (ADR-era choice); Google fully retired that model (confirmed 2026-08-26 via
// ListModels — absent from the account's available-models list entirely, not just deprecated).
// Every Pro-tier model (2.5-pro, 3.1-pro-preview) 429s with a hard 0 free-tier quota on this
// key's project — Google requires billing enabled for any Pro-tier model, even at minimal
// usage. Flash tier has a real free-tier quota and works today; revisit if/when billing is
// enabled and Pro-tier quality is wanted instead.
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Adapter — translates the real SDK's GenerateContentResult (`result.response.text()`) into
// ILLMClient's plain `{ text }` shape. Added 2026-09-12 (codeiq29091993 Bot's own review of
// decisions/008): ILLMClient used to be shaped to structurally match GenerativeModel's own
// response object specifically so this file could skip writing an adapter — `geminiModel:
// ILLMClient = genAI.getGenerativeModel(...)` type-checked with no wrapper at all. That
// convenience *was* the "interface too specific to one provider's SDK" problem the finding
// raised, so both providers now go through a real adapter uniformly — see review.types.ts's
// ILLMClient comment.
class GeminiClient implements ILLMClient {
  constructor(private readonly model: GenerativeModel) {}

  async generateContent(
    request: Parameters<ILLMClient["generateContent"]>[0]
  ): ReturnType<ILLMClient["generateContent"]> {
    const result = await this.model.generateContent(request);
    return { text: result.response.text() };
  }
}

// Consumed by lib/llm-client.ts, which wraps it in retry-with-backoff and puts it first in the
// multi-model fallback chain (decisions/008) — never imported directly by GeminiService itself.
export const geminiModel: ILLMClient = new GeminiClient(
  genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    generationConfig: { responseMimeType: "application/json" },
  })
);
