import type { GeminiIssue, GeminiReviewResult, IGeminiClient, IGeminiService } from "./review.types";
import { GeminiReviewResultSchema, GeminiSummaryResultSchema } from "./review.validator";
import type { SanitizedRepoConfig } from "../repos/repo.types";

const MAX_RETRIES = 3;
const MAX_BACKOFF_MS = 15_000;

// Exact pseudocode from .ai/knowledge/domains/review.md "gemini.service.ts", plus retry-on-429
// added 2026-08-26 — the free tier's requests-per-minute quota (5/min on gemini-2.5-flash) was
// getting hit on any PR with more than a handful of chunks, and every call (reviewDiff *and*
// summarizePR) was unprotected, so a single rate-limit hit failed the whole review. See
// review.job.ts's mapWithConcurrency for the complementary fix (capping how many calls fire at
// once) — this retry is still needed on its own, since summarizePR runs after all chunks and
// isn't covered by the chunk-level concurrency cap at all.
export class GeminiService implements IGeminiService {
  constructor(private readonly geminiClient: IGeminiClient) {}

  async reviewDiff(
    patch: string,
    config: SanitizedRepoConfig,
    filename: string
  ): Promise<GeminiReviewResult> {
    const systemInstruction = buildSystemPrompt(config, filename);
    const result = await withGeminiRetry(() =>
      this.geminiClient.generateContent({
        systemInstruction,
        contents: [{ role: "user", parts: [{ text: patch }] }],
      })
    );
    const raw: unknown = JSON.parse(result.response.text());
    return GeminiReviewResultSchema.parse(raw);
  }

  async summarizePR(
    prTitle: string,
    issues: Array<GeminiIssue & { file: string }>
  ): Promise<string> {
    const systemInstruction = buildSummaryPrompt();
    const result = await withGeminiRetry(() =>
      this.geminiClient.generateContent({
        systemInstruction,
        contents: [
          {
            role: "user",
            parts: [{ text: JSON.stringify({ prTitle, issues }) }],
          },
        ],
      })
    );
    const raw: unknown = JSON.parse(result.response.text());
    return GeminiSummaryResultSchema.parse(raw).summary;
  }
}

// Retries only the API call itself — JSON.parse/schema-validation failures happen outside this
// wrapper at each call site, so a malformed-response error is never retried here (retrying the
// exact same request wouldn't fix a bad response shape; that's the existing
// skip-and-log-a-warning path in review.job.ts's per-chunk handling).
async function withGeminiRetry<T>(fn: () => Promise<T>): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
      await sleep(getRetryDelayMs(err) ?? exponentialBackoffMs(attempt));
    }
  }
  throw lastErr;
}

// The Gemini SDK's 429 error carries Google's own suggested wait time in a structured
// RetryInfo detail (e.g. "Please retry in 8.6s") — using it directly avoids guessing at a
// backoff that's shorter than what the quota actually needs.
function getRetryDelayMs(err: unknown): number | null {
  const details = (err as { errorDetails?: Array<Record<string, unknown>> } | undefined)
    ?.errorDetails;
  const retryInfo = details?.find(
    (d) => d["@type"] === "type.googleapis.com/google.rpc.RetryInfo"
  );
  const raw = retryInfo?.retryDelay;
  if (typeof raw !== "string") return null;
  const seconds = Number.parseFloat(raw.replace("s", ""));
  return Number.isFinite(seconds) ? Math.ceil(seconds * 1000) + 250 : null; // small buffer
}

function exponentialBackoffMs(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, MAX_BACKOFF_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
