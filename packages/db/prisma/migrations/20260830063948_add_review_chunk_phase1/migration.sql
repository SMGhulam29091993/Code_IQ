-- CreateEnum
CREATE TYPE "ChunkStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "completedChunks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalChunks" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "truncated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ReviewIssue" ADD COLUMN     "chunkId" TEXT;

-- CreateTable
CREATE TABLE "ReviewChunk" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "chunkIndex" INTEGER NOT NULL,
    "patch" TEXT NOT NULL,
    "status" "ChunkStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewChunk_reviewId_status_idx" ON "ReviewChunk"("reviewId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ReviewChunk_reviewId_filename_chunkIndex_key" ON "ReviewChunk"("reviewId", "filename", "chunkIndex");

-- AddForeignKey
ALTER TABLE "ReviewIssue" ADD CONSTRAINT "ReviewIssue_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ReviewChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReviewChunk" ADD CONSTRAINT "ReviewChunk_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "Review"("id") ON DELETE CASCADE ON UPDATE CASCADE;
