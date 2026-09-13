import type Redis from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LlmExhaustionService } from "../lib/llm-exhaustion";

function buildRedis(): Redis {
  return {
    get: vi.fn(),
    set: vi.fn(),
  } as unknown as Redis;
}

describe("LlmExhaustionService", () => {
  let redis: Redis;
  let service: LlmExhaustionService;

  beforeEach(() => {
    redis = buildRedis();
    service = new LlmExhaustionService(redis);
  });

  it("reports not exhausted when no flag is set", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    expect(await service.isExhausted("review-1")).toBe(false);
  });

  it("reports exhausted once markExhausted has set the flag", async () => {
    vi.mocked(redis.get).mockResolvedValue("1");

    expect(await service.isExhausted("review-1")).toBe(true);
  });

  it("scopes the flag to the review", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    await service.isExhausted("review-42");

    expect(redis.get).toHaveBeenCalledWith("review:review-42:llm-exhausted");
  });

  it("sets the flag with a TTL", async () => {
    await service.markExhausted("review-1");

    expect(redis.set).toHaveBeenCalledWith("review:review-1:llm-exhausted", "1", "EX", 600);
  });
});
