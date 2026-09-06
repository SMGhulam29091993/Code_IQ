# Next Tasks
> Queued — not yet started.

1. ~~Auth screens — register (2-step w/ OTP), login, AuthProvider rehydration~~ — done, see
   `plans/frontend.md` Step 2
2. ~~Onboarding, Overview, Repos, Reviews, Billing screens~~ — done (2026-08-23), see
   `plans/frontend.md` Steps 3–7 and `state/completed.md`
3. ~~Account & Workspace settings~~ — done (2026-08-23), see `plans/frontend.md` Step 8 and
   `state/completed.md`
4. Frontend Step 9 (Polish) — Framer Motion page transitions, keyboard navigation audit,
   axe-core accessibility pass on every page, mobile responsiveness (min-width 375px), root
   error boundary
5. Deploy (backend Step 7) — AWS EC2/RDS/ElastiCache, production webhook URL, Secrets Manager
   (Dockerfiles, docker-compose.yml, and `GET /health` are done — see `plans/backend.md` Step 7)
6. Open product questions from `state/blockers.md` (Insights tab scope, issue Dismiss semantics,
   billing seat source) — each has a pragmatic engineering default in place; revisit only if
   product wants the mockup's original behavior instead
7. Email-change flow and "log out other sessions on password change" — both explicitly flagged
   as gaps in `knowledge/domains/auth.md`'s `PATCH /auth/me` and `POST /auth/change-password`
   sections, not built this pass
8. ~~Add `APP_GITHUB_ID` / `APP_GITHUB_PRIVATE_KEY` repo secrets~~ — done (2026-09-06), workflow
   confirmed green on a real Actions run. See `knowledge/domains/github-app.md`'s "Automated
   drift check" note.
9. Purchase a one-time $10 OpenRouter credit (openrouter.ai/settings/credits) — this key has
   zero lifetime spend and hit what looks like an account-level free-tier request ceiling
   during `decisions/008`'s live-testing (every configured model failing identically at once,
   not per-model shared-pool congestion). OpenRouter ties a meaningfully higher free-tier
   ceiling to a one-time credit purchase rather than ongoing spend. Billing action — user's call.
10. Manually mark the 2 permanently `RUNNING` reviews from 2026-08-25
    (`cmt923ad6000001p3x0bnqqxy`, `cmt92bgwz000101p3suoesn1x`) as `FAILED` in the DB — orphaned
    when their worker died with the container mid-session; predate the Step 8 `ReviewChunk`
    schema so the resumable-retry endpoint can't pick them up. Flagged, not fixed, 2026-09-06.
11. Rebuild the `api`/`web` Docker containers (`docker compose build api web && docker compose
    up -d`, `apps/api/docker-compose.yml`) — currently running code from 2026-08-26, 11 days
    stale: missing all of Step 8's chunk fan-out pipeline, the billing/account-tabs fixes, and
    this session's OpenRouter fallback chain. Explicitly deferred by the user 2026-09-06.
