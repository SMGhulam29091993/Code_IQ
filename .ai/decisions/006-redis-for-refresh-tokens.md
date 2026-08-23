# ADR 006: Redis over Postgres for Refresh Token Storage

## Context
Refresh tokens were originally stored in a Postgres `RefreshToken` table (`id`, `token`
unique, `userId`, `createdAt`, `expiresAt`), used purely as a revocation check: `POST
/auth/refresh` validates the JWT signature/expiry, then confirms the row still exists;
`POST /auth/logout` deletes it. `expiresAt` was written on create but never read back —
expiry was already enforced entirely by the JWT's own `exp` claim, not by comparing the
column. That made the table a revocation list with a manual-cleanup problem: expired rows
never got deleted, they just became permanently dead, unqueried weight in Postgres.
`.ai/knowledge/domains/auth.md`'s OTP flow already solved an equivalent problem (ephemeral,
TTL-bound, revocable state) with a Redis key rather than a Postgres row.

## Decision
Store refresh tokens in Redis instead: `refresh_token:<token>` → the owning `userId`, with a
native TTL matching the refresh JWT's own expiry (`refreshTokenExpiry()`, 7 days). Same
key-naming convention as the existing `otp:` and `oauth_state:` keys
(`apps/api/src/services/otp.service.ts`, `apps/api/src/modules/github/github.service.ts`).
`packages/db/prisma/schema.prisma`'s `RefreshToken` model is removed entirely (migration
`20260823105451_drop_refresh_token_table`).

## Consequences
**Positive:**
- Expired tokens vanish automatically via Redis's own TTL — no cleanup job, ever.
- Revocation (`logout`) is a single `DEL`, same cost as before, no ORM/SQL round trip.
- One fewer Postgres table to migrate/index/back up; consistent with the OTP/oauth_state
  precedent already established for ephemeral, revocable auth state.
- Store and JWT can no longer silently disagree on expiry — the TTL is derived directly from
  `refreshTokenExpiry()`, the same value that signs the JWT.

**Negative:**
- Redis is already a hard dependency (BullMQ, OTP, OAuth state — ADR 002), but this adds one
  more thing that breaks if Redis is unreachable: refresh-token issuance and validation, not
  just async jobs.
- Redis is not durable by default in this project's local `docker-compose.yml` config in the
  same way Postgres is — a Redis restart without persistence configured drops all live
  sessions' refresh tokens (they'd need to log in again; access tokens, 15 min TTL, are
  unaffected either way since they were never persisted anywhere).
- `IRefreshTokenRepository.findByToken` no longer returns a synthetic row `id` (nothing
  consumed it) — a narrower interface than the Postgres version, not a drop-in swap for a
  hypothetical future caller that wanted a real row identity.

**Applies to:** backend (`apps/api/src/modules/auth/refresh-token.repository.ts`,
`packages/db/prisma/schema.prisma`)
