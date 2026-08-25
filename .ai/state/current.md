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
The `api-api-1` Docker container was again found running-but-stale at the start of this session
(it predated Step 8 — 404'd on `GET /auth/me`, 500'd on `GET /reviews/stats`) and was stopped in
favor of `apps/api`'s own `pnpm dev` (`tsx watch`) for Step 9's browser verification, same
pattern as before. Rebuild it (`cd apps/api && docker compose build api && docker compose up -d`)
before relying on it again. Postgres/Redis containers were left running throughout. The
`verify@codeiq.dev` seed account's password is **no longer `TestPass123!`** — it was changed
during Step 8's own live change-password verification pass and never reset; a login attempt this
session confirmed the old password no longer works. A second seed user was created for this
session's verification instead (`step9check@codeiq.dev` / `TestPass123!`, installation
`step9-org`, 2 repos, 2 reviews, 1 issue) — both accounts' data are harmless leftovers, useful
for exploring the dashboard locally.

## Active plan step
`plans/frontend.md` → Steps 3–9 [ complete ]
`plans/backend.md` → Step 7: Deploy [ in-progress ] — Dockerfiles/compose/health done, AWS
EC2/RDS/ElastiCache + Secrets Manager + prod webhook URL still open (unchanged this session)

## Last updated
2026-08-25

## Next action
Frontend's mockup-derived plan (Steps 1–9) is now fully complete. Backend Step 7's AWS work is
still open but needs real cloud access this session doesn't have — the only concretely open
item left in either plan.

## Working branch
This session's work landed directly on `feat/auth-screens` (the branch already checked out at
session start) as 5 separate commits — docs+billing/repos API, then one commit per screen
(Onboarding, Overview, Repos, Reviews, Billing). Check `git log` before assuming a different
branch name; `memory/pitfalls.md` documents the branch-naming convention for *new* branches, but
this session extended the existing one rather than cutting a new one.
