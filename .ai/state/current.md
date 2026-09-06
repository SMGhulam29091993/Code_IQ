# Current State
> Update on every task that changes code. Never leave stale.

## 2026-09-06 (Fix: review-coordinator.job.ts idempotency, on branch `fix/review-coordinator-idempotency`)
The duplicate-`Review`-row bug flagged in the jobId-bug entry below is now fixed on its own
branch (cut from `feat/auth-screens` at commit `cc9d084`, since the fix touches the same file
the jobId fix already changed): `Review.coordinatorJobId` (new column + migration) lets
`review-coordinator.job.ts` recognize a BullMQ retry of the same job and reuse the existing
`Review`/`ReviewChunk` rows instead of creating duplicates. 3 new tests, 366/366 passing,
typecheck/lint/build all clean. Full detail in `state/completed.md`. **Not yet committed or
merged** — see "Working branch" below.

## 2026-09-06 (Critical fix: Step 8 pipeline was completely broken for real reviews)
Rebuilt the 11-day-stale containers (user's explicit go-ahead, reversing the earlier "not yet")
and immediately found Step 8's entire chunk-fanout pipeline had never actually worked against
real Redis/BullMQ: a `:` character in BullMQ job IDs is rejected by the installed BullMQ version,
invisible to all mocked tests. Fixed (`memory/pitfalls.md` #016). Also handled the two orphaned
`RUNNING` reviews from 2026-08-25 (marked `FAILED` in DB) and confirmed — before doing anything
irreversible — that the standard retry endpoint would have posted a **false "no issues" comment
to the real GitHub PR** for today's 7 real failed reviews, since they predate the ReviewChunk
schema. Triggered one real fresh review instead (synthetic webhook, proper HMAC signature) for
PR #8's actual current head, which is what surfaced the jobId bug. After the fix + rebuild, a
second attempt genuinely chunked the real diff (30 chunks) and exercised the full Gemini→
OpenRouter fallback end-to-end — settled `FAILED` because both providers are still exhausted
(safe, correct outcome; no false report posted). Full detail in `state/completed.md`.

## 2026-09-06 (New: OpenRouter multi-model fallback — decisions/008)
Root cause of "PRs failing today" traced to Gemini's undocumented 20-requests/day free-tier
quota (separate from the per-minute quota already handled). Built a proper multi-model fallback
chain rather than a one-line swap: `ILLMClient` (renamed from `IGeminiClient`) is the seam,
`lib/gemini.ts` + new `lib/openrouter.ts` (Adapters) implement it, `lib/llm-client.ts`'s
`RetryingLLMClient` (Decorator) + `FallbackLLMClient` (Composite) compose Gemini-then-5-
OpenRouter-models into one client wired into `container.ts`. Full design, and two real bugs
found live-testing against the real APIs (a daily-quota 429 wrongly treated as retryable; an
OpenRouter free-tier 400 that's actually a mislabeled capacity error), in `decisions/008` and
`state/completed.md`'s entry. **Known open item, not this session's to fix**: the OpenRouter key
has zero lifetime spend and hit what looks like an account-level free-tier request ceiling
during this session's live-testing — recommended a one-time $10 credit purchase to raise it,
user's call. Also known but explicitly deferred by the user this session: the two permanently
`RUNNING` reviews from 2026-08-25 (orphaned, need a manual DB fix) and the live Docker
containers being 11 days stale (need a rebuild to pick up Step 8 + all of today's work,
including this OpenRouter change) — neither touched. `pnpm --filter @codeiq/api test` (363/363)
clean.

## 2026-09-06 side fixes (unrelated to the active task below)
Three `codeiq29091993 Bot` Warning/Logic findings closed this session, plus one new piece of
tooling the bot's own review suggested:
- `GET /billing/subscription` now returns 200 `planTier: 'FREE'` (with null `nextInvoice`/
  `paymentMethod`) instead of 400 for an unsubscribed installation.
- `GET /billing/invoices` now returns 200 `{ invoices: [] }` instead of 400 for an installation
  with no `stripeCustomerId`.
- `AccountTabs.tsx`'s tab switcher uses `router.replace` instead of `router.push` (was cluttering
  browser history with one entry per tab click). `RepoDetailTabs.tsx` has the same pattern but
  wasn't flagged — not touched.
- New: `apps/api/scripts/verify-github-app-slug.ts` + `.github/workflows/verify-github-app-
  slug.yml` (this repo's first CI workflow) — re-verifies the GitHub App slug against GitHub's
  own registration on a schedule/on change, per the bot's "implement automated validation"
  suggestion on the earlier slug-drift incident. Repo secrets added, confirmed green on a real
  Actions run.
See `state/completed.md`'s four 2026-09-06 entries and `knowledge/domains/billing.md`/
`knowledge/screens/billing-screens.md`/`knowledge/screens/account-screens.md`/
`knowledge/domains/github-app.md` for detail. Does not touch the frontend Step 3–9 / backend
Step 7–8 work described below.

## 2026-08-30 side fix (unrelated to the active task below)
`POST /auth/change-password` now revokes all of a user's other refresh tokens/sessions —
closed a Critical/Security finding from `codeiq29091993 Bot`'s automated PR review. See
`state/completed.md`'s 2026-08-30 entry and `knowledge/domains/auth.md`/
`decisions/006-redis-for-refresh-tokens.md` for the detail. Does not touch the frontend Step
3–9 / backend Step 7–8 work described below.

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
`plans/backend.md` → Step 8: Scalable review pipeline [ in-progress ] — all 4 phases shipped
backend-side 2026-08-30: `ReviewChunk` schema, chunk persistence + resumable retry, the
`FlowProducer` queue split (`review-coordinator-queue` / `review-chunk-queue` /
`review-finalize-queue`, 3 processors replacing the old single `ReviewJobProcessor`), and
per-installation fairness (`FairnessService`) + `MAX_CHUNKS_PER_REVIEW` truncation +
`totalChunks`/`completedChunks`/`truncated` exposed via the API. Unit/integration-verified
(342/342 API tests, 96/96 web tests) but **not yet live-verified against a real GitHub PR** —
needs the Docker/ngrok setup described below, plus a real load test with a large/200+-chunk PR
(confirming `failParentOnFailure: false` and the truncation/fairness behavior under real
conditions) before trusting this at scale in production. Phase 4's dashboard UI wiring
(consuming the new progress fields) is a separate, not-yet-scheduled frontend step — see
`plans/backend.md` Step 8 for detail.

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
Stale note from earlier in this multi-day session — kept for history, superseded below. This
session's *original* work landed directly on `feat/auth-screens` (the branch already checked out
at session start) as 5 separate commits — docs+billing/repos API, then one commit per screen
(Onboarding, Overview, Repos, Reviews, Billing).

**2026-09-06 update:** `feat/auth-screens` kept accumulating commits all day (billing fixes,
account tabs, the GitHub Actions slug-check workflow, the OpenRouter fallback chain, the jobId
fix — see `state/completed.md` for all of it) — check `git log` for the real list, this note
won't be kept exhaustively current. The one exception: the review-coordinator idempotency fix
(this file's top entry) is on a **new** branch, `fix/review-coordinator-idempotency`, cut off
`feat/auth-screens` at `cc9d084` — per explicit user instruction to use a fresh branch for that
piece of work, following the `fix/*` convention `memory/pitfalls.md` documents for new branches.
Not yet committed there as of this note.
