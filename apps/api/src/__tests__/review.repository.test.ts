import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@codeiq/db";
import { ReviewRepository } from "../modules/reviews/review.repository";

vi.mock("@codeiq/db", () => ({
  prisma: { review: { update: vi.fn(), create: vi.fn(), findUnique: vi.fn() } },
}));

// A 32-bit Int overflows on real GitHub review ids — found live 2026-09-12 when this project's
// own dogfooded PR #9 review actually succeeded and returned id 5185926759, crashing the
// subsequent DB update. schema.prisma's Review.githubReviewId is BigInt at rest now; this
// repository is the one place that converts the plain-number business type to/from it.
describe("ReviewRepository.update", () => {
  let repo: ReviewRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new ReviewRepository();
  });

  it("converts githubReviewId to BigInt before writing, including values that overflow a 32-bit Int", async () => {
    await repo.update("review-1", { status: "DONE", githubReviewId: 5185926759 });

    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: "review-1" },
      data: { status: "DONE", githubReviewId: 5185926759n },
    });
  });

  it("does not touch githubReviewId when it isn't part of the update", async () => {
    await repo.update("review-1", { status: "FAILED" });

    expect(prisma.review.update).toHaveBeenCalledWith({
      where: { id: "review-1" },
      data: { status: "FAILED" },
    });
  });
});
