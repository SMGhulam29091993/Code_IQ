import { describe, expect, it } from "vitest";
import { isUnverifiableSymbolClaim } from "../modules/reviews/unverifiable-claims";

describe("isUnverifiableSymbolClaim", () => {
  // Every one of these was a real, false finding posted on PR #15/#16/#17.
  it.each([
    "Variable 'githubReviewId' is declared but never used.",
    "Variable 'failureReason' is assigned but never used.",
    "Function 'isFinalAttempt' is declared but never used.",
    "Importing 'listAllPullRequestFiles' from '../modules/reviews/pr-files' is not used in the current file.",
    "The 'truncated' variable is not used in the job data.",
    "Optional property 'includeSummary' is not used in the interface.",
    "The new 'postSummaryComment' property is not used in the existing code.",
    "Variable 'commentable' is not used anywhere.",
    "Potential missing import for 'RetryingLLMClient'",
    "Unused import of OllamaClient",
    "'OLLAMA_MODEL' is not defined in this scope",
  ])("flags: %s", (message) => {
    expect(isUnverifiableSymbolClaim(message)).toBe(true);
  });

  it.each([
    "SQL injection: user input concatenated into the query.",
    "Promise returned by fetch is not awaited, so errors are swallowed.",
    "The error is not handled when the GitHub API returns 403.",
    "Retry loop never terminates if total_count is undefined.",
    "Off-by-one: the last page is skipped.",
  ])("keeps: %s", (message) => {
    expect(isUnverifiableSymbolClaim(message)).toBe(false);
  });
});
