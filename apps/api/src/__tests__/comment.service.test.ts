import type { Octokit } from "@octokit/rest";
import { describe, expect, it, vi } from "vitest";
import { CommentService } from "../modules/reviews/comment.service";
import type { GeminiIssue } from "../modules/reviews/review.types";

function buildOctokit(reviewId = 999) {
  return {
    pulls: {
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
});
