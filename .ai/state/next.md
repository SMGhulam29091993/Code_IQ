# Next Tasks
> Queued — not yet started.

1. Auth screens — register (2-step w/ OTP), login, AuthProvider rehydration (frontend Step 2)
2. Review pipeline — BullMQ worker, diff chunking, Gemini review + summary, comment posting,
   review CRUD (backend Step 5). First real caller of `modules/repos/config.service.ts`'s
   `getEffectiveConfig` and of `GET /repos/:repoId/stats`'s real aggregation.
3. Install flow (frontend Step 3) — can now call the completed `/github/*` and `/repos/*` APIs
