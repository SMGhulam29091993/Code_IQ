# Current State
> Update on every task that changes code. Never leave stale.

## Active task
Backend Step 6 (Billing module) complete — all 7 backend plan steps except Step 7 (Deploy) are
now done. Frontend Step 1 (Foundation) complete; frontend Step 2 (Auth screens) not started.

## Active plan step
`plans/backend.md` → Step 6: Billing module [ complete ] → Step 7: Deploy [ not-started ]
`plans/frontend.md` → Step 1: Foundation [ complete ] → Step 2: Auth screens [ not-started ]

## Last updated
2026-08-17

## Next action
Backend's remaining plan step is Step 7 (Deploy) — Dockerfile, docker-compose.yml, AWS
EC2/RDS/ElastiCache, GitHub App webhook URL → production domain, env vars from AWS Secrets
Manager, `GET /health`. This is normally the last step (after the frontend catches up), so the
higher-value next action is `plans/frontend.md` Step 2 (Auth screens) or Step 3 (Install flow)
— the backend API surface is now fully complete (`/auth/*`, `/github/*`, `/repos/*`,
`/reviews/*`, `/billing/*`), including real billing/checkout data for Step 3's dashboard.

## Working branch
Backend work happens on feature branches cut from `Dev`, not directly on `Dev` — Step 6 was
built on `feat/billing-module` (Step 5 was the first to use this convention, on
`feat/review-pipeline`). See `memory/pitfalls.md` if a future session needs the branch-naming
convention.
