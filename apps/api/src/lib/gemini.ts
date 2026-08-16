import { GoogleGenerativeAI } from "@google/generative-ai";
import { env } from "./env";
import type { IGeminiClient } from "../modules/reviews/review.types";

// Gemini 1.5 Pro — .ai/knowledge/technical/backend/architecture.md "AI model".
const genAI = new GoogleGenerativeAI(env.GEMINI_API_KEY);

// Typed against IGeminiClient (not the SDK's own GenerativeModel type) so GeminiService only
// ever depends on the narrow interface it actually calls — see review.types.ts.
export const geminiModel: IGeminiClient = genAI.getGenerativeModel({
  model: "gemini-1.5-pro",
  generationConfig: { responseMimeType: "application/json" },
});
