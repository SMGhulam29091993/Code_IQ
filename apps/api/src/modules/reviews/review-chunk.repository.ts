import { prisma } from "@codeiq/db";
import type { CreateChunkInput, IReviewChunkRepository, ReviewChunkRow } from "./review.types";

// Persists per-chunk state around each chunk's Gemini call — introduced in decisions/007 Phase 2
// (chunk persistence inside the single-job pipeline) and unchanged by Phase 3's queue split
// (ReviewChunkJobProcessor, jobs/review-chunk.job.ts) — this repository's shape didn't need to
// change for that move.
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
      // RUNNING too: retry only accepts a FAILED review, so no chunk of it is genuinely running —
      // a RUNNING row here is one whose job stalled out without reaching its catch block
      // (memory/pitfalls.md #021) and must be re-run, not skipped.
      where: { reviewId, status: { in: ["PENDING", "RUNNING", "FAILED"] } },
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
