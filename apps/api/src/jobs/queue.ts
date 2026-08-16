import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "../lib/env";

// Review pipeline queue. The producer side (webhook.service.ts, review.service.ts's
// retryReview) has existed since Step 3; jobs/worker.ts (Step 5) registers the consumer.
//
// BullMQ requires `maxRetriesPerRequest: null` on its connection — see BullMQ docs.
// Deliberately a separate connection from src/lib/redis.ts's singleton, which doesn't set
// that option.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const reviewQueue = new Queue("review-queue", {
  connection,
  // "BullMQ will retry (max 3 attempts with exponential backoff)" —
  // .ai/knowledge/domains/review.md "Core pipeline: review.job.ts".
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});
