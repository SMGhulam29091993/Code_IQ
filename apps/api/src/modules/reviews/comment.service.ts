import type { Octokit } from "@octokit/rest";
import type { GeminiIssue, ICommentService, PostReviewInput } from "./review.types";

const SEVERITY_ICON: Record<string, string> = { critical: "🔴", warning: "🟡", info: "🔵" };

// Unanchored findings listed in the summary body, capped so a noisy review can't push the body
// past GitHub's 65,536-character review-body limit.
const MAX_UNANCHORED_IN_SUMMARY = 50;
const LIST_FILES_PAGE_SIZE = 100;

// .ai/knowledge/domains/review.md "comment.service.ts".
export class CommentService implements ICommentService {
  async postReview(
    octokit: Octokit,
    { owner, repo, prNumber, headSha, issues, summary }: PostReviewInput
  ): Promise<number> {
    // GitHub rejects the *entire* createReview call with 422 "Line could not be resolved" if
    // even one inline comment targets a line outside the PR's diff hunks — and the line numbers
    // come from an LLM reading a raw patch, which gets this wrong sometimes (found live
    // 2026-10-04 with a local 7B model, decisions/009; any model can do it). So only issues on
    // a line GitHub will accept become inline comments; the rest are listed in the summary
    // body instead of losing the whole review.
    const commentable = await fetchCommentableLines(octokit, owner, repo, prNumber);
    const anchored: PostReviewInput["issues"] = [];
    const unanchored: PostReviewInput["issues"] = [];
    for (const issue of issues) {
      if (commentable.get(issue.file)?.has(issue.line)) anchored.push(issue);
      else unanchored.push(issue);
    }

    const comments = anchored.map((issue) => ({
      path: issue.file,
      line: issue.line,
      body: formatComment(issue),
    }));

    const response = await octokit.pulls.createReview({
      owner,
      repo,
      pull_number: prNumber,
      commit_id: headSha,
      // Non-blocking — never REQUEST_CHANGES. See .ai/knowledge/domains/review.md.
      event: "COMMENT",
      body: formatSummary(summary, issues) + formatUnanchored(unanchored),
      comments,
    });
    return response.data.id;
  }
}

// Per file in the PR, the right-side ("new file") line numbers GitHub accepts an inline review
// comment on: added and context lines inside each diff hunk. A file with no `patch` (binary, or
// too large for GitHub to inline) gets no entry, so every issue on it falls back to the summary.
async function fetchCommentableLines(
  octokit: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<Map<string, Set<number>>> {
  // Manual page loop, not octokit.paginate — the pinned CJS Octokit v19 (memory/pitfalls.md
  // #007) pulls in two @octokit/types versions whose RequestInterface types don't unify, so
  // paginate(pulls.listFiles) doesn't typecheck. GitHub caps this endpoint at 3000 files.
  const result = new Map<string, Set<number>>();
  for (let page = 1; ; page++) {
    const { data: files } = await octokit.pulls.listFiles({
      owner,
      repo,
      pull_number: prNumber,
      per_page: LIST_FILES_PAGE_SIZE,
      page,
    });
    for (const file of files) {
      if (file.patch) result.set(file.filename, parseCommentableLines(file.patch));
    }
    if (files.length < LIST_FILES_PAGE_SIZE) break;
  }
  return result;
}

/** Right-side line numbers (added + context lines) covered by a unified-diff patch's hunks. */
export function parseCommentableLines(patch: string): Set<number> {
  const lines = new Set<number>();
  let newLine: number | null = null;
  for (const raw of patch.split("\n")) {
    const header = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (header) {
      newLine = Number(header[1]);
      continue;
    }
    if (newLine === null) continue;
    if (raw.startsWith("-") || raw.startsWith("\\")) continue; // removed line / "\ No newline"
    lines.add(newLine);
    newLine++;
  }
  return lines;
}

function formatUnanchored(issues: PostReviewInput["issues"]): string {
  if (issues.length === 0) return "";
  const shown = issues.slice(0, MAX_UNANCHORED_IN_SUMMARY).map((issue) => {
    const icon = SEVERITY_ICON[issue.severity];
    return `- ${icon} **${capitalize(issue.severity)} · ${capitalize(issue.category)}** \`${issue.file}:${issue.line}\` — ${issue.message}`;
  });
  const more = issues.length - shown.length;
  return `

### Other findings
_These point at lines outside this PR's diff, so they can't be posted inline._

${shown.join("\n")}${more > 0 ? `\n\n_…and ${more} more._` : ""}`;
}

function formatComment(issue: GeminiIssue): string {
  const icon = SEVERITY_ICON[issue.severity];
  const severityLabel = capitalize(issue.severity);
  const categoryLabel = capitalize(issue.category);
  return `${icon} **${severityLabel} · ${categoryLabel}**
${issue.message}

**Suggestion:** ${issue.suggestion}`;
}

function formatSummary(summary: string, issues: GeminiIssue[]): string {
  const critical = issues.filter((i) => i.severity === "critical").length;
  const warning = issues.filter((i) => i.severity === "warning").length;
  const info = issues.filter((i) => i.severity === "info").length;
  return `## CodeIQ Review
${summary}

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${critical} |
| 🟡 Warning | ${warning} |
| 🔵 Info | ${info} |`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
