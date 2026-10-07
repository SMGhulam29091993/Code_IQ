import type { GeminiIssue } from "./review.types";

const SEVERITY_RANK: Record<string, number> = { critical: 3, warning: 2, info: 1 };

/**
 * Collapses issues that say the same thing about the same file into one, keeping the most severe
 * copy (first-seen on a tie). Two issues are duplicates when they share a file and their messages
 * match after lower-casing and collapsing whitespace — line numbers are ignored on purpose.
 *
 * Found live 2026-10-07: PR #16's review posted 19 copies of essentially one comment on a single
 * file. A file split into several overlapping chunks (diff.service.ts, 20-line overlap) gets
 * reviewed once per chunk, and each pass can restate the same finding at a different line —
 * the model's line numbers for the same concern differ, so matching on line would miss them.
 * Output order follows each kept issue's first appearance.
 */
export function dedupeIssues<T extends GeminiIssue & { file: string }>(issues: T[]): T[] {
  const kept = new Map<string, T>();
  for (const issue of issues) {
    const key = `${issue.file}\u0000${issue.message.toLowerCase().replace(/\s+/g, " ").trim()}`;
    const existing = kept.get(key);
    if (!existing || (SEVERITY_RANK[issue.severity] ?? 0) > (SEVERITY_RANK[existing.severity] ?? 0)) {
      kept.set(key, issue);
    }
  }
  return [...kept.values()];
}
