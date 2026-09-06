import { beforeEach, describe, expect, it, vi } from "vitest";
import { redis } from "../lib/redis";
import { RefreshTokenRepository } from "../modules/auth/refresh-token.repository";

vi.mock("../lib/redis", () => ({
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn(), mget: vi.fn() },
}));

describe("RefreshTokenRepository.deleteAllForUser", () => {
  let repo: RefreshTokenRepository;

  beforeEach(() => {
    vi.clearAllMocks();
    repo = new RefreshTokenRepository();
  });

  it("deletes only the keys whose value matches the given userId", async () => {
    vi.mocked(redis.scan).mockResolvedValue(["0", ["refresh_token:a", "refresh_token:b"]]);
    vi.mocked(redis.mget).mockResolvedValue(["user-1", "user-2"]);

    await repo.deleteAllForUser("user-1");

    expect(redis.del).toHaveBeenCalledWith("refresh_token:a");
    expect(redis.del).not.toHaveBeenCalledWith("refresh_token:b");
  });

  it("follows the cursor across multiple SCAN pages before deleting", async () => {
    vi.mocked(redis.scan)
      .mockResolvedValueOnce(["17", ["refresh_token:a"]])
      .mockResolvedValueOnce(["0", ["refresh_token:b"]]);
    vi.mocked(redis.mget).mockResolvedValueOnce(["user-1"]).mockResolvedValueOnce(["user-1"]);

    await repo.deleteAllForUser("user-1");

    expect(redis.scan).toHaveBeenCalledTimes(2);
    expect(redis.scan).toHaveBeenNthCalledWith(1, "0", "MATCH", "refresh_token:*", "COUNT", 100);
    expect(redis.scan).toHaveBeenNthCalledWith(2, "17", "MATCH", "refresh_token:*", "COUNT", 100);
    expect(redis.del).toHaveBeenCalledWith("refresh_token:a", "refresh_token:b");
  });

  it("does nothing when SCAN finds no keys at all", async () => {
    vi.mocked(redis.scan).mockResolvedValue(["0", []]);

    await repo.deleteAllForUser("user-1");

    expect(redis.mget).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("does nothing when keys exist but none belong to this user", async () => {
    vi.mocked(redis.scan).mockResolvedValue(["0", ["refresh_token:a"]]);
    vi.mocked(redis.mget).mockResolvedValue(["some-other-user"]);

    await repo.deleteAllForUser("user-1");

    expect(redis.del).not.toHaveBeenCalled();
  });
});
