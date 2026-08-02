import { Queue } from "bullmq";
import Redis from "ioredis";
import { env } from "../lib/env";

// Review pipeline queue — only the Queue producer side is needed starting Step 3
// (webhook.controller.ts enqueues jobs here). The worker/processor
// (.ai/plans/backend.md Step 5 "src/jobs/worker.ts") consumes them; this file does not
// register a worker, so nothing processes jobs yet.
//
// BullMQ requires `maxRetriesPerRequest: null` on its connection — see BullMQ docs.
// Deliberately a separate connection from src/lib/redis.ts's singleton, which doesn't set
// that option.
const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

export const reviewQueue = new Queue("review-queue", { connection });
