import type { GeminiIssue, GeminiReviewResult, IGeminiService, ILLMClient } from "./review.types";
import { GeminiReviewResultSchema, GeminiSummaryResultSchema } from "./review.validator";
import { isUnverifiableSymbolClaim } from "./unverifiable-claims";
import type { SanitizedRepoConfig } from "../repos/repo.types";

// Exact pseudocode from .ai/knowledge/domains/review.md "gemini.service.ts". Retry-with-backoff
// and multi-model fallback used to live in this class (added 2026-08-26 for Gemini's
// requests-per-minute quota) but moved down into the injected `ILLMClient` itself — see
// lib/llm-client.ts's RetryingLLMClient/FallbackLLMClient (decisions/008) — once the client
// stopped being just Gemini. This class now only owns prompt-building and response
// parsing/validation; it neither knows nor cares whether `llmClient` is a single model or a
// whole fallback chain.
export class GeminiService implements IGeminiService {
  constructor(private readonly llmClient: ILLMClient) {}

  async reviewDiff(
    patch: string,
    config: SanitizedRepoConfig,
    filename: string
  ): Promise<GeminiReviewResult> {
    const systemInstruction = buildSystemPrompt(config, filename);
    const result = await this.llmClient.generateContent({
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: patch }] }],
    });
    const raw: unknown = JSON.parse(result.text);
    const parsed = GeminiReviewResultSchema.parse(raw);
    // Drop "X is never used / not defined / missing import" claims — unverifiable from one diff
    // fragment and already enforced by the linter/compiler (unverifiable-claims.ts).
    return { ...parsed, issues: parsed.issues.filter((issue) => !isUnverifiableSymbolClaim(issue.message)) };
  }

  async summarizePR(
    prTitle: string,
    issues: Array<GeminiIssue & { file: string }>
  ): Promise<string> {
    const systemInstruction = buildSummaryPrompt();
    const result = await this.llmClient.generateContent({
      systemInstruction,
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify({ prTitle, issues }) }],
        },
      ],
    });
    const raw: unknown = JSON.parse(result.text);
    return GeminiSummaryResultSchema.parse(raw).summary;
  }
}

function buildSystemPrompt(config: SanitizedRepoConfig, filename: string): string {
  return `You are an expert code reviewer. Analyze the git diff for file: ${filename}.
Return ONLY valid JSON matching this exact schema:
{
  "issues": [{
    "line": number,
    "severity": "critical" | "warning" | "info",
    "category": "bug" | "security" | "style" | "performance" | "logic",
    "message": string (max 200 chars),
    "suggestion": string (max 500 chars)
  }],
  "summary": string (max 500 chars)
}
Context: you see ONE FRAGMENT of this file's diff (a chunk of at most 300 lines), not the whole
file or repository. Code before, after and outside this fragment exists but is not shown.
Rules:
- Only report ${config.enabledCategories.join(", ")} categories.
- Minimum severity to report: ${config.severityThreshold}.
- Only report concrete problems in the changed lines (lines starting with "+").
- Do NOT report unused or undefined variables, imports, functions, parameters or properties,
  or missing imports/definitions: their uses and definitions are usually outside this fragment,
  and the compiler and linter already check them.
- If you are not confident an issue is real, do not report it. An empty "issues" array is a
  valid answer.
- Maximum 50 issues. Prioritize by severity.
- No markdown. No explanation outside the JSON.`;
}

function buildSummaryPrompt(): string {
  return `You are an expert code reviewer. Given a PR title and a list of issues found across
its files (as JSON), write a concise PR-level summary (max 500 chars) of the overall code
quality and the most important issues to address.
Return ONLY valid JSON matching this exact schema:
{ "summary": string (max 500 chars) }
No markdown. No explanation outside the JSON.`;
}
