# Current State
> Update on every task that changes code. Never leave stale.

## Active task
Frontend Steps 3–8 complete: the full CodeIQ Dashboard mockup (Onboarding, Overview, Repos,
Reviews, Billing) plus Account & Workspace settings (Step 8, added per explicit user follow-up
request — not part of the mockup). All verified live in a browser (not just typechecked/tested)
— real seeded Postgres data, `pnpm dev` for both apps, Playwright driving every screen. Steps
3–7 found and fixed two real bugs invisible to the mocked/unit tests (Express 5's `req.query`
getter silently discarding `validateQuery`'s coercion, and `useReview`/`useRetryReview` not
unwrapping the `{ review: ... }` envelope); Step 8's verification pass found none. Backend
gained 7 new endpoints across both sessions: `GET /repos/:repoId`,
`GET /billing/{subscription,seats,invoices}`, `GET/PATCH /auth/me`,
`POST /auth/change-password`. `.ai/knowledge/screens/*.md` and the relevant
`.ai/knowledge/domains/*.md` rewritten/extended before each part was built. See
`state/completed.md` for the full breakdown and `plans/frontend.md` Steps 3–8 for per-screen
detail.

## Local dev environment note
The `api-api-1` Docker container (running before this session) was stopped to free port 4000 for
`pnpm dev`-based browser verification, and not restarted — it predates every change in this
session. Rebuild it (`cd apps/api && docker compose build api && docker compose up -d`) before
relying on it. Postgres/Redis containers were left running throughout and still have this
session's seed data (`verify@codeiq.dev` / `TestPass123!`, installation `acme-corp`, 3 repos, 4
reviews) — harmless, useful for exploring the new screens locally.

## Active plan step
`plans/frontend.md` → Steps 3–8 [ complete ] → Step 9: Polish [ not-started ]
`plans/backend.md` → Step 7: Deploy [ in-progress ] — Dockerfiles/compose/health done, AWS
EC2/RDS/ElastiCache + Secrets Manager + prod webhook URL still open (unchanged this session)

## Last updated
2026-08-23

## Next action
Frontend Step 9 (Polish — Framer Motion transitions, keyboard/a11y audit, mobile responsiveness,
root error boundary) is the natural next frontend step. Backend Step 7's AWS work is still open
but needs real cloud access this session doesn't have.

## Working branch
This session's work landed directly on `feat/auth-screens` (the branch already checked out at
session start) as 5 separate commits — docs+billing/repos API, then one commit per screen
(Onboarding, Overview, Repos, Reviews, Billing). Check `git log` before assuming a different
branch name; `memory/pitfalls.md` documents the branch-naming convention for *new* branches, but
this session extended the existing one rather than cutting a new one.
