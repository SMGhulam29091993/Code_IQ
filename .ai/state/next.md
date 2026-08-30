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
