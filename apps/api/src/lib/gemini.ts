import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./env";
import type { IGeminiClient } from "../modules/reviews/review.types";

// Gemini 2.5 Flash — .ai/knowledge/technical/backend/architecture.md "AI model". Originally
// gemini-1.5-pro (ADR-era choice); Google fully retired that model (confirmed 2026-08-26 via
// ListModels — absent from the account's available-models list entirely, not just deprecated).
// Every Pro-tier model (2.5-pro, 3.1-pro-preview) 429s with a hard 0 free-tier quota on this
// key's project — Google requires billing enabled for any Pro-tier model, even at minimal
// usage. Flash tier has a real free-tier quota and works today; revisit if/when billing is
// enabled and Pro-tier quality is wanted instead.
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Typed against IGeminiClient (not the SDK's own GenerativeModel type) so GeminiService only
// ever depends on the narrow interface it actually calls — see review.types.ts.
export const geminiModel: IGeminiClient = genAI.getGenerativeModel({
  model: "gemini-2.5-flash",
  generationConfig: { responseMimeType: "application/json" },
});
