import { FlowProducer, Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "../lib/env";

// decisions/007 Phase 3: the review pipeline is now 3 queues instead of 1 — see
// knowledge/technical/backend/review-pipeline-scaling.md "Queue topology". Chunk and finalize
// jobs are only ever added via reviewFlowProducer (never a bare Queue#add), so they don't need
// their own exported Queue instances — jobs/worker.ts's Workers just need these name strings.
export const REVIEW_CHUNK_QUEUE_NAME = "review-chunk-queue";
export const REVIEW_FINALIZE_QUEUE_NAME = "review-finalize-queue";

// BullMQ requires `maxRetriesPerRequest: null` on its connection — see BullMQ docs.
// Deliberately a separate connection from src/lib/redis.ts's singleton, which doesn't set
// that option.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Entry point for a fresh review — enqueued by webhook.service.ts with jobId: X-GitHub-Delivery
// (pitfall #004 dedup). Fetches the diff, chunks it, and fans the chunks out via
// reviewFlowProducer. Retries skip this queue entirely (ReviewService.retryReview already knows
// the review's chunks and goes straight through reviewFlowProducer) — this queue only ever
// creates brand-new Review rows.
export const reviewCoordinatorQueue = new Queue("review-coordinator-queue", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5000 },
  },
});

// Fans a review's chunk jobs out under a parent finalize job — BullMQ activates the parent
// automatically once every child has settled, no hand-rolled "decrement a counter" coordination.
// See knowledge/technical/backend/review-pipeline-scaling.md "Why FlowProducer over hand-rolled
// fan-in". Used by jobs/review-coordinator.job.ts (fresh reviews) and
// modules/reviews/review.service.ts's retryReview (resumed reviews).
export const reviewFlowProducer = new FlowProducer({ connection });
