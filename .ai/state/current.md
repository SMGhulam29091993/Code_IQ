# Current State
> Update on every task that changes code. Never leave stale.

## Active task
Frontend Steps 3–9 complete: the full CodeIQ Dashboard mockup (Onboarding, Overview, Repos,
Reviews, Billing), Account & Workspace settings (Step 8, added per explicit user follow-up
request — not part of the mockup), and Polish (Step 9 — error boundaries, Framer Motion page
transitions, mobile responsiveness at 375px, a keyboard-nav audit, and an axe-core accessibility
pass). All verified live in a browser (not just typechecked/tested) — real seeded Postgres data,
`pnpm dev` for both apps, Playwright driving every screen. Steps 3–7 found and fixed two real
bugs invisible to the mocked/unit tests (Express 5's `req.query` getter silently discarding
`validateQuery`'s coercion, and `useReview`/`useRetryReview` not unwrapping the `{ review: ... }`
envelope); Step 8's verification pass found none; Step 9's axe-core pass found two real
accessibility bugs (an unlabeled toggle switch pair in `RepoConfigPanel`, a nested-interactive
violation in `RepoCard`) — see `plans/frontend.md` Step 9 for both. Backend gained 7 new
endpoints across the Step 3–8 sessions: `GET /repos/:repoId`,
`GET /billing/{subscription,seats,invoices}`, `GET/PATCH /auth/me`,
`POST /auth/change-password` — Step 9 was frontend-only, no backend changes.
`.ai/knowledge/screens/*.md` and the relevant `.ai/knowledge/domains/*.md` rewritten/extended
before each part was built. See `state/completed.md` for the full breakdown and
`plans/frontend.md` Steps 3–9 for per-screen/step detail.

## Local dev environment note
Session ended with the user about to shut the machine down (Docker included), mid-way through
first-ever live verification of the real review pipeline against a real GitHub PR. State as of
that point:
- **Real GitHub App wired up end-to-end**: installed on the user's own account
  (`SMGhulam29091993`, installation `156551794`... — see git log for the full saga), webhook
  delivering correctly via an ngrok tunnel (`https://flakily-scrabble-swiftly.ngrok-free.dev` →
  local `:4000`, path must be `/api/webhooks/github`) — **the ngrok tunnel dies when the machine
  shuts down and gets a new random subdomain on `ngrok http` restart** (free tier, no reserved
  domain) unless `ngrok http --url=flakily-scrabble-swiftly.ngrok-free.dev 4000` is used to
  reclaim the same one. Either way, next session needs to re-run ngrok and confirm the Webhook
  URL on `github.com/settings/apps/codeiq29091993` still matches.
- **`GEMINI_API_KEY` swapped to a real key** (in `apps/api/.env`, gitignored) after the original
  was invalid; **model changed from `gemini-1.5-pro` (fully retired by Google) to
  `gemini-2.5-flash`** (Pro-tier models 429 with a hard 0 free-tier quota without billing —
  `knowledge/technical/backend/architecture.md` has the full story). Free tier is still only 5
  requests/minute, so `lib/concurrency.ts` (chunk concurrency cap) + retry-with-backoff in
  `gemini.service.ts` were added and committed this session — see git log
  `fix(api): switch to Gemini 2.5 Flash, add retry-on-429 and chunk concurrency cap`.
- **Verification was IN PROGRESS, not confirmed complete**: a manually-enqueued review job for
  the real PR #8 (`SMGhulam29091993/Code_IQ`, review id `cmt923ad6000001p3x0bnqqxy`) was still
  `RUNNING` when the session paused — never confirmed to reach `DONE` with a real GitHub comment
  posted. **First thing next session: check that review's final status**, and if it never
  finished (likely, since the container stops with the machine), re-enqueue or just open a fresh
  small PR and watch it end-to-end for real.
- Both Docker containers (`api`, `web`) were rebuilt earlier this session and were running with
  current code when the session paused. They'll need `docker compose up -d` again next time (the
  images are already built, no rebuild needed unless code changed again) — Postgres/Redis data
  persists via volumes across restarts, so seed data survives. The `verify@codeiq.dev` seed
  account's password is **no longer `TestPass123!`** (changed during Step 8's live test, never
  reset). A second seed user exists from Step 9 (`step9check@codeiq.dev` / `TestPass123!`,
  installation `step9-org`, 2 repos, 2 reviews) — harmless, useful for exploring the dashboard.

## Active plan step
`plans/frontend.md` → Steps 3–9 [ complete ]
`plans/backend.md` → Step 7: Deploy [ in-progress ] — Dockerfiles/compose/health done, AWS
EC2/RDS/ElastiCache + Secrets Manager + prod webhook URL still open (unchanged this session)
`plans/backend.md` → Step 8: Scalable review pipeline [ in-progress ] — Phase 1 (`ReviewChunk`
model + `Review`/`ReviewIssue` schema additions, migration only, no behavior change) shipped
2026-08-30. Phases 2–4 (chunk persistence in the existing job, queue split via `FlowProducer`,
fairness/backpressure/live progress) not started — see `plans/backend.md` Step 8 for detail.

## Last updated
2026-08-26 (mid-session pause, not a natural stopping point — see "Next action")

## Next action
1. Confirm review `cmt923ad6000001p3x0bnqqxy` (or a fresh test PR) actually reaches `DONE` with a
   real comment posted to GitHub — this was the one thing never confirmed before the session
   paused for a machine shutdown.
2. Restart ngrok (same reserved domain if possible) and re-verify the Webhook URL on GitHub still
   points at it with the `/api/webhooks/github` path.
3. `docker compose up -d` for `api`/`web` (images already built with the latest code).
4. Otherwise, frontend Steps 1–9 are fully complete; backend Step 7's AWS work is the only other
   open item, and needs real cloud access this session doesn't have.

## Working branch
This session's work landed directly on `feat/auth-screens` (the branch already checked out at
session start) as 5 separate commits — docs+billing/repos API, then one commit per screen
(Onboarding, Overview, Repos, Reviews, Billing). Check `git log` before assuming a different
branch name; `memory/pitfalls.md` documents the branch-naming convention for *new* branches, but
this session extended the existing one rather than cutting a new one.
