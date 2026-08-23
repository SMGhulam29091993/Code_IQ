# Current State
> Update on every task that changes code. Never leave stale.

## Active task
Backend Step 7 (Deploy) in progress on `feat/billing-module`: local-tooling pieces done
(Dockerfiles for api/web, docker-compose with all 4 services, `GET /health`) — real AWS
provisioning still open, deliberately out of scope for this session (needs separate
access/authorization). Frontend Step 1 (Foundation) complete; frontend Step 2 (Auth screens)
not started.

## Active plan step
`plans/backend.md` → Step 7: Deploy [ in-progress ] — Dockerfiles/compose/health done, AWS
EC2/RDS/ElastiCache + Secrets Manager + prod webhook URL still open
`plans/frontend.md` → Step 1: Foundation [ complete ] → Step 2: Auth screens [ not-started ]

## Last updated
2026-08-23

## Next action
Frontend Step 2 (Auth screens) is still the highest-value next step — the backend API surface
has been complete since Step 6 (`/auth/*`, `/github/*`, `/repos/*`, `/reviews/*`, `/billing/*`),
and Step 7's remaining AWS work needs real cloud access this session doesn't have. Local dev is
now fully containerized (`cd apps/api && docker compose up -d --build` brings up
postgres+redis+api+web together) if that's useful for frontend work against a real backend
instead of `pnpm dev`.

## Working branch
Backend work happens on feature branches cut from `Dev`, not directly on `Dev` — Step 6 was
built on `feat/billing-module` (Step 5 was the first to use this convention, on
`feat/review-pipeline`). See `memory/pitfalls.md` if a future session needs the branch-naming
convention.
