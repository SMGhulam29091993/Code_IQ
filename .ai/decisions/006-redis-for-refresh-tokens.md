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

## Addendum (2026-08-30): `deleteAllForUser` breaks the "always an exact key" pattern

`POST /auth/change-password` needed to revoke every refresh token belonging to a user (a
security-review finding — password change previously left old sessions/devices logged in
indefinitely). The negative consequence flagged above ("no synthetic row id... not a drop-in
swap for a hypothetical future caller that wanted a real row identity") undersold the real gap:
this store has no reverse index from `userId` to their tokens at all, only token → `userId`.

**Decision:** rather than adding a second Redis structure (e.g. a per-user Set of token keys) to
get an O(1) reverse lookup, `deleteAllForUser` does a cursor-based `SCAN … MATCH
refresh_token:* COUNT 100` + `MGET` + filter-by-value + `DEL`. A per-user Set was considered and
rejected: it would reintroduce exactly the manual-cleanup problem this ADR moved off Postgres to
avoid — tokens that expire naturally (TTL, never explicitly logged out) would leave dead entries
in the set forever, since nothing removes a Set member when its paired key's TTL fires.

**Consequences:**
- `SCAN` (not `KEYS`) so this never blocks the single-threaded Redis event loop, even as the
  refresh-token keyspace grows — cost is O(total live refresh tokens across all users), paid
  once per password change, not O(this user's tokens).
- This is now the only place in the codebase that enumerates Redis keys by pattern; every other
  lookup (`otp:`, `oauth_state:`, `refresh_token:` elsewhere in this file) is an exact-key
  `GET`/`SET`/`DEL`. Revisit with a proper reverse index (Set or Hash, accepting the cleanup
  trade-off, or moving expiry-aware cleanup into a scheduled job) if refresh-token volume ever
  makes a full-keyspace `SCAN` per password change too slow.
- Unauthenticated `POST /auth/refresh` and `POST /auth/logout` are unaffected — they already
  address a single token by exact key.
