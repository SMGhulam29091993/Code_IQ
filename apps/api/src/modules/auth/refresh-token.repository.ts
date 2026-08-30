import type { IRefreshTokenRepository } from "./auth.types";
import { redis } from "../../lib/redis";

// Same key convention as otp.service.ts (`otp:`) and github.service.ts (`oauth_state:`) —
// `<domain>:<opaque-id>`, value is the owning userId. TTL mirrors the refresh JWT's own expiry
// (data.expiresAt, from lib/jwt.ts's refreshTokenExpiry()) so the store and the token never
// disagree on when it dies — no separate cleanup job needed, unlike the old Postgres row.
function key(token: string): string {
  return `refresh_token:${token}`;
}

export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(data: { userId: string; token: string; expiresAt: Date }): Promise<void> {
    const ttlSeconds = Math.max(1, Math.floor((data.expiresAt.getTime() - Date.now()) / 1000));
    await redis.set(key(data.token), data.userId, "EX", ttlSeconds);
  }

  async findByToken(token: string): Promise<{ userId: string } | null> {
    const userId = await redis.get(key(token));
    return userId ? { userId } : null;
  }

  async deleteByToken(token: string): Promise<void> {
    // No-op if not found (del on a missing key) — logout/refresh rotation must stay idempotent.
    await redis.del(key(token));
  }

  // The only place this codebase enumerates Redis keys by pattern rather than by exact key —
  // every other lookup (otp:, oauth_state:, refresh_token: elsewhere in this file) knows the
  // exact key it wants. There's no reverse index from userId to their tokens, so revoking "all
  // sessions" on password change means SCANning refresh_token:* and matching by value. Cursor-
  // based SCAN (not KEYS) so this never blocks Redis even as the keyspace grows.
  async deleteAllForUser(userId: string): Promise<void> {
    let cursor = "0";
    const keysToDelete: string[] = [];
    do {
      const [nextCursor, keys] = await redis.scan(cursor, "MATCH", "refresh_token:*", "COUNT", 100);
      cursor = nextCursor;
      if (keys.length > 0) {
        const values = await redis.mget(...keys);
        keys.forEach((k, i) => {
          if (values[i] === userId) keysToDelete.push(k);
        });
      }
    } while (cursor !== "0");

    if (keysToDelete.length > 0) {
      await redis.del(...keysToDelete);
    }
  }
}
