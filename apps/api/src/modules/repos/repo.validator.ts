import { z } from "zod";

const SEVERITY_VALUES = ["CRITICAL", "WARNING", "INFO"] as const;
const CATEGORY_VALUES = ["bug", "security", "style", "performance", "logic"] as const;

// Minimatch (and most glob engines) treat malformed brackets/braces as literal characters
// rather than throwing, so it can't tell us a pattern is "invalid" — a bracket-balance check
// is the practical bar for what "Invalid glob pattern" means here.
// .ai/knowledge/domains/repos.md PATCH /repos/:repoId/config edge cases.
function hasBalancedGlobBrackets(pattern: string): boolean {
  const closers: Record<string, string> = { "[": "]", "{": "}", "(": ")" };
  const stack: string[] = [];
  for (const char of pattern) {
    if (char in closers) {
      stack.push(closers[char]!);
    } else if (char === "]" || char === "}" || char === ")") {
      if (stack.pop() !== char) return false;
    }
  }
  return stack.length === 0;
}

const GlobPatternSchema = z.string().superRefine((pattern, ctx) => {
  if (pattern.trim().length === 0 || !hasBalancedGlobBrackets(pattern)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid glob pattern: ${pattern}` });
  }
});

// Exact messages from .ai/knowledge/domains/repos.md "PATCH /repos/:repoId/config" edge cases.
export const UpdateConfigSchema = z.object({
  severityThreshold: z.enum(SEVERITY_VALUES).optional(),
  enabledCategories: z
    .array(z.enum(CATEGORY_VALUES))
    .min(1, "At least one category must be enabled")
    .optional(),
  ignorePatterns: z.array(GlobPatternSchema).optional(),
  reviewOnDraft: z.boolean().optional(),
  postSummaryComment: z.boolean().optional(),
});

// `.codeiq.yml` — same field rules as UpdateConfigSchema; an invalid file falls back to the
// DB config rather than 400ing (nothing there to return an HTTP error to). See config.service.ts.
export const YamlConfigSchema = UpdateConfigSchema;

// GET /repos query params — .ai/knowledge/domains/repos.md "GET /repos".
export const ListReposQuerySchema = z.object({
  installationId: z.string().optional(),
  isActive: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
});
