import { prisma } from "@codeiq/db";
import type { IPrStatusRepository, PrStatusContext } from "./review.types";

// Narrow repository for pr-status.service.ts — kept separate from ReviewRepository so the
// in-progress-signal feature doesn't widen IReviewRepository (and every mock of it) for three
// queries only that service needs. Not user-scoped: only ever called from the BullMQ pipeline
// and ReviewService.retryReview *after* its own ownership check, never from a controller.
export class PrStatusRepository implements IPrStatusRepository {
  async findContext(reviewId: string): Promise<PrStatusContext | null> {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      select: {
        prNumber: true,
        headSha: true,
        githubStatusCommentId: true,
        githubCheckRunId: true,
        repo: {
          select: { fullName: true, installation: { select: { githubInstallationId: true } } },
        },
      },
    });
    if (!review) return null;
    const [owner, repo] = review.repo.fullName.split("/") as [string, string];
    return {
      owner,
      repo,
      prNumber: review.prNumber,
      headSha: review.headSha,
      githubInstallationId: review.repo.installation.githubInstallationId,
      // BigInt at rest (schema.prisma), plain number everywhere else — GitHub ids stay well
      // under Number.MAX_SAFE_INTEGER. Same boundary conversion as githubReviewId.
      statusCommentId: review.githubStatusCommentId === null ? null : Number(review.githubStatusCommentId),
      checkRunId: review.githubCheckRunId === null ? null : Number(review.githubCheckRunId),
    };
  }

  async saveStatusIds(
    reviewId: string,
    ids: { statusCommentId?: number; checkRunId?: number }
  ): Promise<void> {
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        ...(ids.statusCommentId !== undefined ? { githubStatusCommentId: BigInt(ids.statusCommentId) } : {}),
        ...(ids.checkRunId !== undefined ? { githubCheckRunId: BigInt(ids.checkRunId) } : {}),
      },
    });
  }

  async countChunkProgress(reviewId: string): Promise<{ settled: number; total: number }> {
    const rows = await prisma.reviewChunk.groupBy({
      by: ["status"],
      where: { reviewId },
      _count: { _all: true },
    });
    let settled = 0;
    let total = 0;
    for (const row of rows) {
      total += row._count._all;
      if (row.status === "DONE" || row.status === "FAILED") settled += row._count._all;
    }
    return { settled, total };
  }
}
