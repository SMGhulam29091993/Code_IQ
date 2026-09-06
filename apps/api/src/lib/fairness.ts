import type Redis from "ioredis";
import type { IFairnessService } from "../modules/reviews/review.types";

const MIN_PRIORITY = 1;
const MAX_PRIORITY = 10;
// Every 20 in-flight chunks for one installation drops its next chunk jobs by one priority
// tier (BullMQ: lower number = higher priority) — an installation with nothing in flight stays
// at the top tier, a huge PR gradually cedes ground to quieter tenants without needing BullMQ
// Pro's paid per-group rate limiting.
const INFLIGHT_PER_PRIORITY_STEP = 20;
// Safety net so a crashed pod (chunk job died between markInFlight(+1) and the matching -1)
// can't leave a counter permanently inflated — decisions/007's fairnessService design.
const INFLIGHT_KEY_TTL_SECONDS = 300;

export class FairnessService implements IFairnessService {
  constructor(private readonly redis: Redis) {}

  async priorityFor(installationId: string): Promise<number> {
    const inFlight = Number((await this.redis.get(inflightKey(installationId))) ?? 0);
    const tier = 1 + Math.floor(inFlight / INFLIGHT_PER_PRIORITY_STEP);
    return Math.min(MAX_PRIORITY, Math.max(MIN_PRIORITY, tier));
  }

  async markInFlight(installationId: string, delta: number): Promise<void> {
    const key = inflightKey(installationId);
    await this.redis.incrby(key, delta);
    await this.redis.expire(key, INFLIGHT_KEY_TTL_SECONDS);
  }
}

function inflightKey(installationId: string): string {
  return `chunks:inflight:${installationId}`;
}
