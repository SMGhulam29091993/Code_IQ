import { prisma } from "@codeiq/db";
import type { CreateIssueInput, GeminiIssue, IReviewIssueRepository } from "./review.types";

export class ReviewIssueRepository implements IReviewIssueRepository {
  async createMany(reviewId: string, issues: CreateIssueInput[]) {
    if (issues.length === 0) return;
    await prisma.reviewIssue.createMany({
      data: issues.map((issue) => ({ ...issue, reviewId })),
    });
  }

  async findByReviewId(reviewId: string): Promise<Array<GeminiIssue & { file: string }>> {
    const issues = await prisma.reviewIssue.findMany({ where: { reviewId } });
    return issues.map((issue) => ({
      file: issue.file,
      line: issue.line,
      severity: issue.severity as GeminiIssue["severity"],
      category: issue.category as GeminiIssue["category"],
      message: issue.message,
      suggestion: issue.suggestion,
    }));
  }
}
