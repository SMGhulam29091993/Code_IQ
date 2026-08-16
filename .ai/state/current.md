# Current State
> Update on every task that changes code. Never leave stale.

## Active task
Backend Step 5 (Review pipeline) complete. Frontend Step 1 (Foundation) complete; frontend
Step 2 (Auth screens) not started.

## Active plan step
`plans/backend.md` → Step 5: Review pipeline [ complete ] → Step 6: Billing module [ not-started ]
`plans/frontend.md` → Step 1: Foundation [ complete ] → Step 2: Auth screens [ not-started ]

## Last updated
2026-08-16

## Next action
Begin `plans/backend.md` Step 6 (Billing module) — `src/lib/stripe.ts`, `billing.service.ts`
(plans/checkout/portal/webhook), `billing.controller.ts`/`billing.routes.ts`, `ProcessedEvent`
idempotency — per `knowledge/domains/billing.md`.
Alternatively, `plans/frontend.md` Step 2 (Auth screens) or Step 3 (Install flow) can proceed in
parallel — both now have a complete backend API surface (`/auth/*`, `/github/*`, `/repos/*`),
and Step 3's dashboard can additionally surface real review data via the newly-completed
`/reviews/*` endpoints.

## Working branch
Backend work now happens on feature branches cut from `Dev`, not directly on `Dev` — this step
was built on `feat/review-pipeline`. See `memory/pitfalls.md` if a future session needs the
branch-naming convention.
