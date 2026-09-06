import type Redis from "ioredis";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FairnessService } from "../lib/fairness";

function buildRedis(): Redis {
  return {
    get: vi.fn(),
    incrby: vi.fn(),
    expire: vi.fn(),
  } as unknown as Redis;
}

describe("FairnessService.priorityFor", () => {
  let redis: Redis;
  let service: FairnessService;

  beforeEach(() => {
    redis = buildRedis();
    service = new FairnessService(redis);
  });

  it("returns the highest priority (1) when nothing is in flight", async () => {
    vi.mocked(redis.get).mockResolvedValue(null);

    expect(await service.priorityFor("install-1")).toBe(1);
  });

  it("drops one priority tier per 20 in-flight chunks", async () => {
    vi.mocked(redis.get).mockResolvedValue("20");
    expect(await service.priorityFor("install-1")).toBe(2);

    vi.mocked(redis.get).mockResolvedValue("45");
    expect(await service.priorityFor("install-1")).toBe(3);
  });

  it("clamps at the lowest priority (10) for very high in-flight counts", async () => {
    vi.mocked(redis.get).mockResolvedValue("100000");

    expect(await service.priorityFor("install-1")).toBe(10);
  });

  it("scopes the in-flight key to the installation", async () => {
    vi.mocked(redis.get).mockResolvedValue("0");

    await service.priorityFor("install-42");

    expect(redis.get).toHaveBeenCalledWith("chunks:inflight:install-42");
  });
});

describe("FairnessService.markInFlight", () => {
  let redis: Redis;
  let service: FairnessService;

  beforeEach(() => {
    redis = buildRedis();
    service = new FairnessService(redis);
  });

  it("increments the installation's counter and refreshes its TTL", async () => {
    await service.markInFlight("install-1", 1);

    expect(redis.incrby).toHaveBeenCalledWith("chunks:inflight:install-1", 1);
    expect(redis.expire).toHaveBeenCalledWith("chunks:inflight:install-1", 300);
  });

  it("supports decrementing when a chunk finishes", async () => {
    await service.markInFlight("install-1", -1);

    expect(redis.incrby).toHaveBeenCalledWith("chunks:inflight:install-1", -1);
  });
});
