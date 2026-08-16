import { prisma } from "@codeiq/db";
import type { CreateIssueInput, IReviewIssueRepository } from "./review.types";

export class ReviewIssueRepository implements IReviewIssueRepository {
  async createMany(reviewId: string, issues: CreateIssueInput[]) {
    if (issues.length === 0) return;
    await prisma.reviewIssue.createMany({
      data: issues.map((issue) => ({ ...issue, reviewId })),
    });
  }
}
