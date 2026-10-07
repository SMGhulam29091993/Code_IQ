import { z } from "zod";

const STATUS_VALUES = ["PENDING", "RUNNING", "DONE", "FAILED"] as const;
const SEVERITY_VALUES = ["critical", "warning", "info"] as const;
const CATEGORY_VALUES = ["bug", "security", "style", "performance", "logic"] as const;

// GET /reviews query params — .ai/knowledge/domains/review.md "GET /reviews".
export const ListReviewsQuerySchema = z.object({
  repoId: z.string().optional(),
  status: z.enum(STATUS_VALUES).optional(),
  page: z.coerce.number().int().min(1, "Page must be at least 1").default(1),
  limit: z.coerce.number().int().max(100, "Limit cannot exceed 100").default(20),
});

// GET /reviews/stats query params — .ai/knowledge/domains/review.md "GET /reviews/stats".
export const GetStatsQuerySchema = z.object({
  repoId: z.string().optional(),
  days: z.coerce.number().int().min(1).max(90, "Days cannot exceed 90").default(30),
});

// Length/count limits are *truncated to*, never rejected. A `.max()` here used to fail the
// whole chunk when a model overran a limit by one character — found live 2026-10-07: Qwen wrote
// a >200-char `message` and Zod threw `too_big`, discarding every other finding in that chunk.
// Overrunning a soft limit isn't malformed output; only a wrong *shape* is (see below).
const truncated = (max: number) => z.string().transform((s) => (s.length > max ? `${s.slice(0, max - 1)}…` : s));

// The LLM's raw JSON response for a single diff chunk — .ai/knowledge/domains/review.md
// "gemini.service.ts reviewDiff". A Zod failure here means genuinely malformed output (wrong
// types, unknown severity/category) per the domain doc's edge-case table — the caller treats it
// as a failed chunk, not a fatal error.
export const GeminiReviewResultSchema = z.object({
  issues: z
    .array(
      z.object({
        line: z.number().int(),
        severity: z.enum(SEVERITY_VALUES),
        category: z.enum(CATEGORY_VALUES),
        message: truncated(200),
        suggestion: truncated(500),
      })
    )
    // "Truncate at 50" per the domain doc — keep the first 50 (the prompt asks for them in
    // severity order), don't reject the chunk.
    .transform((issues) => issues.slice(0, 50)),
  summary: truncated(500),
});

// The LLM's raw JSON response for GeminiService.summarizePR — same truncate-don't-reject stance.
export const GeminiSummaryResultSchema = z.object({
  summary: truncated(500),
});
