import { Worker } from "bullmq";
import type { Job } from "bullmq";
import Redis from "ioredis";
import { REVIEW_CHUNK_QUEUE_NAME, REVIEW_FINALIZE_QUEUE_NAME } from "./queue";
import type { ReviewChunkJobProcessor } from "./review-chunk.job";
import type { ReviewCoordinatorJobProcessor } from "./review-coordinator.job";
import type { ReviewFinalizeJobProcessor } from "./review-finalize.job";
import { env } from "../lib/env";
import type {
  ReviewChunkJobData,
  ReviewCoordinatorJobData,
  ReviewFinalizeJobData,
} from "../modules/reviews/review.types";

// Cheap job (one diff fetch + chunking, no Gemini calls) — high concurrency is safe.
const COORDINATOR_WORKER_CONCURRENCY = 20;
// The actual LLM-call workload — this is what you scale horizontally by adding more pods, each
// running its own Worker at this per-pod concurrency.
const CHUNK_WORKER_POD_CONCURRENCY = 10;
// Low-volume (one per review) — aggregation + a single GitHub API call.
const FINALIZE_WORKER_CONCURRENCY = 10;
// Still the free tier's 5 requests/minute (see state/current.md) — enforced fleet-wide via
// BullMQ's Redis-backed Worker limiter now, not the in-process mapWithConcurrency cap Phase 2
// (and everything before it) relied on. Move to env once this moves off the free tier.
const GEMINI_RPM_BUDGET = 5;

// Registers all three review-pipeline queue consumers — called once from src/server.ts's
// startup sequence (.ai/rules/architecture-rules.md "Startup sequence" step 4). Producer side:
// jobs/queue.ts (coordinator queue + reviewFlowProducer for chunk/finalize).
export function startReviewWorkers(
  coordinatorProcessor: ReviewCoordinatorJobProcessor,
  chunkProcessor: ReviewChunkJobProcessor,
  finalizeProcessor: ReviewFinalizeJobProcessor
): Worker[] {
  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

  const coordinatorWorker = new Worker<ReviewCoordinatorJobData>(
    "review-coordinator-queue",
    (job: Job<ReviewCoordinatorJobData>) => coordinatorProcessor.process(job),
    { connection, concurrency: COORDINATOR_WORKER_CONCURRENCY }
  );

  const chunkWorker = new Worker<ReviewChunkJobData>(
    REVIEW_CHUNK_QUEUE_NAME,
    (job: Job<ReviewChunkJobData>) => chunkProcessor.process(job),
    {
      connection,
      concurrency: CHUNK_WORKER_POD_CONCURRENCY,
      limiter: { max: GEMINI_RPM_BUDGET, duration: 60_000 },
    }
  );

  const finalizeWorker = new Worker<ReviewFinalizeJobData>(
    REVIEW_FINALIZE_QUEUE_NAME,
    (job: Job<ReviewFinalizeJobData>) => finalizeProcessor.process(job),
    { connection, concurrency: FINALIZE_WORKER_CONCURRENCY }
  );

  for (const worker of [coordinatorWorker, chunkWorker, finalizeWorker]) {
    worker.on("failed", (job, err) => {
      console.error(`${worker.name} job ${job?.id ?? "unknown"} failed: ${formatJobError(err)}`);
    });
  }

  return [coordinatorWorker, chunkWorker, finalizeWorker];
}

/**
 * Plain-string rendering of a failed job's error, for the worker "failed" log line.
 *
 * Passing the error object straight to console.error made Node's util.inspect walk every own
 * property, and on 2026-10-04 that walk itself threw (`TypeError: Cannot read properties of
 * undefined (reading 'value')` inside formatProperty) — so the log line meant to explain a
 * failure crashed instead and hid the real error. The stack (plus its cause, if any) carries
 * everything needed to diagnose it, and building a string never inspects arbitrary properties.
 */
export function formatJobError(err: unknown): string {
  try {
    if (!(err instanceof Error)) return String(err);
    const main = err.stack ?? `${err.name}: ${err.message}`;
    const cause = err.cause instanceof Error ? `\n  [cause] ${err.cause.stack ?? err.cause.message}` : "";
    return main + cause;
  } catch {
    return "<error could not be formatted>";
  }
}
