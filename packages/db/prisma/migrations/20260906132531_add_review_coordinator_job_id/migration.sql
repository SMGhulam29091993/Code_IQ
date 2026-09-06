-- AlterTable
ALTER TABLE "Review" ADD COLUMN     "coordinatorJobId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Review_coordinatorJobId_key" ON "Review"("coordinatorJobId");
