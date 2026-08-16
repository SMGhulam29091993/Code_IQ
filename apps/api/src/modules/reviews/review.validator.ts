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

// Gemini's raw JSON response for a single diff chunk — .ai/knowledge/domains/review.md
// "gemini.service.ts reviewDiff". Zod parse failure here means "malformed JSON" per the
// domain doc's edge-case table — the caller treats it as a failed chunk, not a fatal error.
export const GeminiReviewResultSchema = z.object({
  issues: z
    .array(
      z.object({
        line: z.number().int(),
        severity: z.enum(SEVERITY_VALUES),
        category: z.enum(CATEGORY_VALUES),
        message: z.string().max(200),
        suggestion: z.string().max(500),
      })
    )
    .max(50),
  summary: z.string().max(500),
});

// Gemini's raw JSON response for GeminiService.summarizePR — same "malformed JSON → caller
// handles it" stance as GeminiReviewResultSchema above.
export const GeminiSummaryResultSchema = z.object({
  summary: z.string().max(500),
});
