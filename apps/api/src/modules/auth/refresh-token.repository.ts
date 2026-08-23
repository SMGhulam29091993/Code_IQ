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
}
