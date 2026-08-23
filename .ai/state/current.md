# Current State
> Update on every task that changes code. Never leave stale.

## Active task
Frontend Step 2 (Auth screens) complete — login, register (2-step w/ OTP), AuthProvider,
useAuth hook, tests. Backend Step 7 (Deploy) still in progress: local-tooling pieces done
(Dockerfiles for api/web, docker-compose with all 4 services, `GET /health`) — real AWS
provisioning still open, deliberately out of scope (needs separate access/authorization).
`packages/db` also migrated Prisma 5 → 7 (driver adapters) and refresh tokens moved from
Postgres to Redis mid-session — both unplanned but real fixes, see `state/completed.md`.

## Active plan step
`plans/frontend.md` → Step 2: Auth screens [ complete ] → Step 3: Install flow [ not-started ]
`plans/backend.md` → Step 7: Deploy [ in-progress ] — Dockerfiles/compose/health done, AWS
EC2/RDS/ElastiCache + Secrets Manager + prod webhook URL still open

## Last updated
2026-08-23

## Next action
Frontend Step 3 (Install flow — "Connect GitHub" CTA, OAuth callback handling, `POST
/github/install`) is the natural next step; the backend `/github/*` API it needs has been
complete since backend Step 3. Alternatively, Step 7's AWS work is still open but needs real
cloud access this session doesn't have.

## Working branch
Backend work happens on feature branches cut from `Dev`, not directly on `Dev` (`feat/billing-module`,
`feat/backend-deploy`, `fix/prisma-7-migration`, `fix/refresh-tokens-redis` so far). The Step 2
frontend work above was NOT committed on its own branch as of this update — check `git status`/
`git log` before assuming it's captured anywhere but the working tree. See `memory/pitfalls.md`
for the branch-naming convention.
