import type { Octokit } from "@octokit/rest";
import type { GeminiIssue, ICommentService, PostReviewInput } from "./review.types";

const SEVERITY_ICON: Record<string, string> = { critical: "🔴", warning: "🟡", info: "🔵" };

// Exact pseudocode from .ai/knowledge/domains/review.md "comment.service.ts".
export class CommentService implements ICommentService {
  async postReview(
    octokit: Octokit,
    { owner, repo, prNumber, headSha, issues, summary }: PostReviewInput
  ): Promise<number> {
    const comments = issues.map((issue) => ({
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
      body: formatSummary(summary, issues),
      comments,
    });
    return response.data.id;
  }
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
