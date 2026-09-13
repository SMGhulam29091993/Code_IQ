import type Redis from "ioredis";
import type { ILlmExhaustionService } from "../modules/reviews/review.types";

// Long enough to cover every other chunk still queued/running for the same review draining at
// the chunk queue's fleet-wide 5/min limiter (jobs/worker.ts GEMINI_RPM_BUDGET) even for a
// large (near-MAX_CHUNKS_PER_REVIEW) PR; short enough that a stale key from a long-finished
// review doesn't linger meaningfully. Same TTL-as-safety-net pattern as FairnessService's
// in-flight counter (lib/fairness.ts).
const EXHAUSTED_KEY_TTL_SECONDS = 600;

// Per-review circuit breaker for the "every LLM fallback tier exhausted" failure mode
// (lib/llm-client.ts's AllTiersExhaustedError). Scoped to one review, not global: the first
// review-chunk job (jobs/review-chunk.job.ts) to hit full exhaustion marks it here, and every
// other chunk still queued/running for the *same* review short-circuits instead of each
// independently burning its own retry budget rediscovering the same exhaustion — see
// decisions/008's fast-fail addendum. A different, concurrently-running review isn't affected;
// its own first affected chunk pays the one-time discovery cost independently, which is an
// acceptable, deliberately small blast radius (same "smallest change" precedent as the
// ALL_TIERS_EXHAUSTED log line itself).
export class LlmExhaustionService implements ILlmExhaustionService {
  constructor(private readonly redis: Redis) {}

  async markExhausted(reviewId: string): Promise<void> {
    await this.redis.set(exhaustedKey(reviewId), "1", "EX", EXHAUSTED_KEY_TTL_SECONDS);
  }

  async isExhausted(reviewId: string): Promise<boolean> {
    return (await this.redis.get(exhaustedKey(reviewId))) !== null;
  }
}

function exhaustedKey(reviewId: string): string {
  return `review:${reviewId}:llm-exhausted`;
}
