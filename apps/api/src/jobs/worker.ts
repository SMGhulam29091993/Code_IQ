import { Worker } from "bullmq";
import type { Job } from "bullmq";
import Redis from "ioredis";
import type { ReviewJobProcessor } from "./review.job";
import { env } from "../lib/env";
import type { ReviewJobData } from "../modules/reviews/review.types";

const REVIEW_WORKER_CONCURRENCY = 5;

// Registers the review-queue consumer — called once from src/server.ts's startup sequence
// (.ai/rules/architecture-rules.md "Startup sequence" step 4). Producer side lives in
// jobs/queue.ts.
export function startReviewWorker(processor: ReviewJobProcessor): Worker<ReviewJobData> {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const worker = new Worker<ReviewJobData>(
    "review-queue",
    (job: Job<ReviewJobData>) => processor.process(job),
    { connection, concurrency: REVIEW_WORKER_CONCURRENCY }
  );

  worker.on("failed", (job, err) => {
    console.error(`Review job ${job?.id ?? "unknown"} failed:`, err);
  });

  return worker;
}
