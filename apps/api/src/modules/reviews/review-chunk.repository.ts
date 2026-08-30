import { prisma } from "@codeiq/db";
import type { CreateChunkInput, IReviewChunkRepository, ReviewChunkRow } from "./review.types";

// Persists per-chunk state around each chunk's Gemini call — decisions/007 Phase 2. Still
// consumed from within the single ReviewJobProcessor job (Phase 3 moves chunk execution into
// its own BullMQ queue); this repository's shape doesn't need to change for that move.
export class ReviewChunkRepository implements IReviewChunkRepository {
  async createMany(reviewId: string, chunks: CreateChunkInput[]): Promise<ReviewChunkRow[]> {
    if (chunks.length === 0) return [];
    return prisma.reviewChunk.createManyAndReturn({
      data: chunks.map((chunk) => ({ ...chunk, reviewId })),
    });
  }

  findByReviewId(reviewId: string): Promise<ReviewChunkRow[]> {
    return prisma.reviewChunk.findMany({ where: { reviewId }, orderBy: { chunkIndex: "asc" } });
  }

  findIncomplete(reviewId: string): Promise<ReviewChunkRow[]> {
    return prisma.reviewChunk.findMany({
      where: { reviewId, status: { in: ["PENDING", "FAILED"] } },
      orderBy: { chunkIndex: "asc" },
    });
  }

  async markRunning(chunkId: string): Promise<void> {
    await prisma.reviewChunk.update({
      where: { id: chunkId },
      data: { status: "RUNNING", startedAt: new Date(), attempts: { increment: 1 } },
    });
  }

  async markDone(chunkId: string): Promise<void> {
    await prisma.reviewChunk.update({
      where: { id: chunkId },
      data: { status: "DONE", completedAt: new Date() },
    });
  }

  async markFailed(chunkId: string, error: string): Promise<void> {
    await prisma.reviewChunk.update({ where: { id: chunkId }, data: { status: "FAILED", error } });
  }
}
