import type { GeminiIssue, GeminiReviewResult, IGeminiClient, IGeminiService } from "./review.types";
import { GeminiReviewResultSchema, GeminiSummaryResultSchema } from "./review.validator";
import type { SanitizedRepoConfig } from "../repos/repo.types";

// Exact pseudocode from .ai/knowledge/domains/review.md "gemini.service.ts".
export class GeminiService implements IGeminiService {
  constructor(private readonly geminiClient: IGeminiClient) {}

  async reviewDiff(
    patch: string,
    config: SanitizedRepoConfig,
    filename: string
  ): Promise<GeminiReviewResult> {
    const systemInstruction = buildSystemPrompt(config, filename);
    const result = await this.geminiClient.generateContent({
      systemInstruction,
      contents: [{ role: "user", parts: [{ text: patch }] }],
    });
    const raw: unknown = JSON.parse(result.response.text());
    return GeminiReviewResultSchema.parse(raw);
  }

  async summarizePR(
    prTitle: string,
    issues: Array<GeminiIssue & { file: string }>
  ): Promise<string> {
    const systemInstruction = buildSummaryPrompt();
    const result = await this.geminiClient.generateContent({
      systemInstruction,
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify({ prTitle, issues }) }],
        },
      ],
    });
    const raw: unknown = JSON.parse(result.response.text());
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
Rules:
- Only report ${config.enabledCategories.join(", ")} categories.
- Minimum severity to report: ${config.severityThreshold}.
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
