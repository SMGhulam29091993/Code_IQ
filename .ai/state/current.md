# Current State
> Update on every task that changes code. Never leave stale.

## Active task
Backend Step 4 (Repos module) complete. Frontend Step 1 (Foundation) complete; frontend
Step 2 (Auth screens) not started.

## Active plan step
`plans/backend.md` → Step 4: Repos module [ complete ] → Step 5: Review pipeline [ not-started ]
`plans/frontend.md` → Step 1: Foundation [ complete ] → Step 2: Auth screens [ not-started ]

## Last updated
2026-08-11

## Next action
Begin `plans/backend.md` Step 5 (Review pipeline) — `src/jobs/worker.ts`, `diff.service.ts`,
`src/lib/gemini.ts`, `gemini.service.ts`, `comment.service.ts`, `review.repository.ts`,
`review-issue.repository.ts`, `review.service.ts`, `src/jobs/review.job.ts`,
`review.controller.ts`, `review.routes.ts` — per `knowledge/domains/review.md`. This is the
first real caller of `modules/repos/config.service.ts`'s `getEffectiveConfig` (built in Step 4
but unwired until now) and of `GET /repos/:repoId/stats`'s real aggregation (currently a
zero-value placeholder — see `knowledge/domains/repos.md` "Implementation notes").
Alternatively, `plans/frontend.md` Step 2 (Auth screens) can proceed in parallel against the
now-complete `/auth/*` API, or Step 3 (Install flow) against the completed `/github/*` +
`/repos/*` APIs.
