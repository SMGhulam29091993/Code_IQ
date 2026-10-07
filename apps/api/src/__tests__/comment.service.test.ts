import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { CommentService, parseCommentableLines } from "../modules/reviews/comment.service";
import type { GeminiIssue } from "../modules/reviews/review.types";

// A hunk whose right side covers new-file lines `start`..`start + count - 1`, all added lines.
function addedHunk(start: number, count: number): string {
  const body = Array.from({ length: count }, (_, i) => `+line ${start + i}`).join("\n");
  return `@@ -0,0 +${start},${count} @@\n${body}`;
}

// Default PR diff covers every line the tests below anchor issues on (src/index.ts 1–50,
// src/foo.ts 1–10), so the pre-existing inline-comment tests behave as before.
const DEFAULT_PR_FILES = [
  { filename: "src/index.ts", patch: addedHunk(1, 50) },
  { filename: "src/foo.ts", patch: addedHunk(1, 10) },
];

function buildOctokit(reviewId = 999, prFiles: Array<{ filename: string; patch?: string }> = DEFAULT_PR_FILES) {
  return {
    pulls: {
      listFiles: vi.fn().mockResolvedValue({ data: prFiles }),
      createReview: vi.fn().mockResolvedValue({ data: { id: reviewId } }),
    },
  } as unknown as Octokit;
}

function buildIssue(overrides: Partial<GeminiIssue & { file: string }> = {}): GeminiIssue & {
  file: string;
} {
  return {
    file: "src/index.ts",
    line: 42,
    severity: "critical",
    category: "bug",
    message: "Null pointer dereference",
    suggestion: "Add a null check before use",
    ...overrides,
  };
}

describe("CommentService.postReview", () => {
  const service = new CommentService();

  it("calls createReview with event: COMMENT (not REQUEST_CHANGES)", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [buildIssue()],
      summary: "One issue found.",
    });

    expect(octokit.pulls.createReview).toHaveBeenCalledWith(
      expect.objectContaining({ event: "COMMENT" })
    );
  });

  it("batches all issues into a single createReview call", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [buildIssue(), buildIssue({ line: 10 })],
      summary: "Two issues.",
    });

    expect(octokit.pulls.createReview).toHaveBeenCalledTimes(1);
  });

  it("maps issue.file to path and issue.line to line correctly", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [buildIssue({ file: "src/foo.ts", line: 7 })],
      summary: "x",
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.comments).toEqual([expect.objectContaining({ path: "src/foo.ts", line: 7 })]);
  });

  it("formats comment body with severity icon, category, message, suggestion", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [
        buildIssue({
          severity: "warning",
          category: "performance",
          message: "N+1 query",
          suggestion: "Batch the queries",
        }),
      ],
      summary: "x",
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    const body = call.comments![0]!.body;
    expect(body).toContain("🟡");
    expect(body).toContain("Warning");
    expect(body).toContain("Performance");
    expect(body).toContain("N+1 query");
    expect(body).toContain("Batch the queries");
  });

  it("formats summary with issue count breakdown by severity", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [
        buildIssue({ severity: "critical" }),
        buildIssue({ severity: "warning" }),
        buildIssue({ severity: "warning" }),
        buildIssue({ severity: "info" }),
      ],
      summary: "Overall summary text.",
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.body).toContain("Overall summary text.");
    expect(call.body).toContain("| 🔴 Critical | 1 |");
    expect(call.body).toContain("| 🟡 Warning | 2 |");
    expect(call.body).toContain("| 🔵 Info | 1 |");
  });

  it("returns the GitHub review ID", async () => {
    const octokit = buildOctokit(4242);
    const id = await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [],
      summary: "x",
    });

    expect(id).toBe(4242);
  });

  it("handles empty issues array (posts summary-only review)", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [],
      summary: "All clear.",
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.comments).toEqual([]);
    expect(call.body).toContain("All clear.");
  });

  // decisions/009 follow-up: GitHub 422s the whole review if one inline comment targets a line
  // outside the diff — those issues move to the summary body instead.
  it("posts issues on lines outside the PR diff in the summary, not as inline comments", async () => {
    const octokit = buildOctokit(999, [{ filename: "src/index.ts", patch: addedHunk(40, 5) }]);
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [
        buildIssue({ line: 42, message: "Inside the hunk" }),
        buildIssue({ line: 400, message: "Outside the hunk" }),
        buildIssue({ file: "src/not-in-pr.ts", line: 3, message: "File not in PR" }),
      ],
      summary: "x",
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.comments).toEqual([expect.objectContaining({ path: "src/index.ts", line: 42 })]);
    expect(call.body).toContain("### Other findings");
    expect(call.body).toContain("`src/index.ts:400` — Outside the hunk");
    expect(call.body).toContain("`src/not-in-pr.ts:3` — File not in PR");
    expect(call.body).not.toContain("Inside the hunk");
    // Severity counts still cover every issue, anchored or not.
    expect(call.body).toContain("| 🔴 Critical | 3 |");
  });

  it("falls back to the summary for every issue on a file GitHub sent no patch for", async () => {
    const octokit = buildOctokit(999, [{ filename: "assets/logo.png" }]);
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [buildIssue({ file: "assets/logo.png", line: 1 })],
      summary: "x",
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.comments).toEqual([]);
    expect(call.body).toContain("`assets/logo.png:1`");
  });

  it("fetches every page of PR files for the commentable-line check", async () => {
    const octokit = buildOctokit();
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ filename: `f${i}.ts`, patch: addedHunk(1, 1) }));
    vi.mocked(octokit.pulls.listFiles)
      .mockResolvedValueOnce({ data: fullPage } as never)
      .mockResolvedValueOnce({ data: [{ filename: "src/late.ts", patch: addedHunk(5, 1) }] } as never);
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [buildIssue({ file: "src/late.ts", line: 5 })],
      summary: "x",
    });

    expect(octokit.pulls.listFiles).toHaveBeenCalledTimes(2);
    expect(octokit.pulls.listFiles).toHaveBeenLastCalledWith(
      expect.objectContaining({ pull_number: 5, per_page: 100, page: 2 })
    );
    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.comments).toEqual([expect.objectContaining({ path: "src/late.ts", line: 5 })]);
  });

  it("omits the Other findings section when every issue is anchored", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      owner: "acme",
      repo: "widgets",
      prNumber: 5,
      headSha: "abc123",
      issues: [buildIssue()],
      summary: "x",
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.body).not.toContain("Other findings");
  });
});

describe("CommentService.postReview with postSummaryComment disabled", () => {
  const service = new CommentService();
  const base = { owner: "acme", repo: "widgets", prNumber: 5, headSha: "abc123", summary: "Overall summary text." };

  it("posts the inline comments without the PR-level summary or severity table", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, { ...base, issues: [buildIssue()], includeSummary: false });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.comments).toHaveLength(1);
    expect(call.body).toBe("");
  });

  it("still lists findings that can't be posted inline", async () => {
    const octokit = buildOctokit();
    await service.postReview(octokit, {
      ...base,
      issues: [buildIssue({ file: "src/not-in-pr.ts", line: 3, message: "Unanchored" })],
      includeSummary: false,
    });

    const call = vi.mocked(octokit.pulls.createReview).mock.calls[0]![0]!;
    expect(call.body).not.toContain("## CodeIQ Review");
    expect(call.body!.startsWith("### Other findings")).toBe(true);
    expect(call.body).toContain("Unanchored");
  });

  it("posts nothing and returns null when there are no findings at all", async () => {
    const octokit = buildOctokit();
    const id = await service.postReview(octokit, { ...base, issues: [], includeSummary: false });

    expect(id).toBeNull();
    expect(octokit.pulls.createReview).not.toHaveBeenCalled();
  });
});

describe("parseCommentableLines", () => {
  it("collects added and context lines from the hunk header's new-file start", () => {
    const patch = ["@@ -10,4 +20,5 @@", " context", "-removed", "+added", " context", "+added"].join("\n");
    expect([...parseCommentableLines(patch)]).toEqual([20, 21, 22, 23]);
  });

  it("handles multiple hunks", () => {
    const patch = ["@@ -1,1 +1,1 @@", "+a", "@@ -50 +60,2 @@", " b", "+c"].join("\n");
    expect([...parseCommentableLines(patch)]).toEqual([1, 60, 61]);
  });

  it('ignores "\\ No newline at end of file" markers', () => {
    const patch = ["@@ -1,1 +1,1 @@", "+a", "\\ No newline at end of file"].join("\n");
    expect([...parseCommentableLines(patch)]).toEqual([1]);
  });

  it("returns an empty set for an empty patch", () => {
    expect(parseCommentableLines("").size).toBe(0);
  });
});
