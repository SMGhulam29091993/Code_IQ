# CodeIQ — AI Code Review Assistant
> AI-POS Index · ~150 lines · Links out; does not duplicate detail

## What this project is
CodeIQ is a GitHub App that automatically reviews every pull request using Gemini 2.5 Flash.
It posts inline comments per file, a PR-level summary, and stores all reviews in a dashboard.
Billing is Stripe seat-based. Multi-tenant by GitHub App installation.

## Architecture at a glance
```
Turborepo monorepo
├── apps/api        Express + TypeScript + Prisma + PostgreSQL + BullMQ + Redis
├── apps/web        Next.js 14 App Router + Zustand + Tanstack Query
└── packages/
    ├── db          Shared Prisma client + schema
    ├── types       Shared TypeScript interfaces
    └── config      Shared ESLint + tsconfig base
```

## Current sprint
→ See `state/current.md`

## Platform rules
| Platform  | Rules file                       | Applies to          |
|-----------|----------------------------------|---------------------|
| General   | `rules/general.md`               | all files           |
| Backend   | `rules/backend.md`               | `apps/api/**`       |
| Frontend  | `rules/frontend.md`              | `apps/web/**`       |

## Route-audience table (source of truth)
| Prefix          | Audience              |
|-----------------|-----------------------|
| `/auth/*`       | Any unauthenticated   |
| `/github/*`     | Authenticated users   |
| `/webhooks/*`   | GitHub App (sig-only) |
| `/repos/*`      | Authenticated users   |
| `/reviews/*`    | Authenticated users   |
| `/billing/*`    | Authenticated users + Stripe webhooks |

## Domain knowledge (API contracts — backend + frontend both reference)
| Domain        | File                                  |
|---------------|---------------------------------------|
| Auth          | `knowledge/domains/auth.md`           |
| GitHub App    | `knowledge/domains/github-app.md`     |
| Review        | `knowledge/domains/review.md`         |
| Billing       | `knowledge/domains/billing.md`        |
| Repos         | `knowledge/domains/repos.md`          |

## Screen knowledge (frontend-specific: components, AC, edge cases, tests)
| Screens       | File                                      |
|---------------|-------------------------------------------|
| Auth screens  | `knowledge/screens/auth-screens.md`       |
| Onboarding    | `knowledge/screens/onboarding-screens.md` |
| Dashboard + Repos + Reviews | `knowledge/screens/dashboard-screens.md` |
| Billing       | `knowledge/screens/billing-screens.md` |
| Account + Workspace | `knowledge/screens/account-screens.md` |

## Technical knowledge
| Platform  | File                                                        |
|-----------|-------------------------------------------------------------|
| Backend   | `knowledge/technical/backend/architecture.md`               |
| Backend   | `knowledge/technical/backend/api-guidelines.md`             |
| Frontend  | `knowledge/technical/frontend/design-system.md`             |
| Frontend  | `knowledge/technical/frontend/state-conventions.md`         |
| Frontend  | `knowledge/technical/frontend/component-conventions.md`     |
| Frontend  | `knowledge/technical/frontend/hooks-and-utils.md`           |
| Backend   | `knowledge/technical/backend/review-pipeline-scaling.md` — HLD/LLD for chunk-level fan-out (decision 007) |

## Workflows
| Workflow                     | File                                           |
|------------------------------|------------------------------------------------|
| Implement feature (backend)  | `workflows/implement-feature.md`               |
| Implement screen (frontend)  | `workflows/frontend-implement-screen.md`       |
| Generate tests               | `workflows/generate-tests.md`                  |
| Frontend testing setup       | `workflows/frontend-testing.md`                |
| Code review checklist        | `workflows/code-review.md`                     |

## Plans
- `plans/backend.md` — API implementation order + status
- `plans/frontend.md` — Screen/component build order + status
- `plans/database.md` — Schema migrations + seeder plan

## State
- `state/current.md` — Active tasks right now
- `state/next.md` — Queued tasks
- `state/blockers.md` — Anything blocking progress
- `state/completed.md` — Append-only log

## Decisions
- `decisions/001-github-app-over-oauth-app.md`
- `decisions/002-bullmq-for-async-review.md`
- `decisions/003-otp-verification-for-registration.md`
- `decisions/004-nodemailer-factory-pattern-for-mail-service.md`
- `decisions/005-pgvector-over-pinecone.md` *(future)*
- `decisions/006-redis-for-refresh-tokens.md`
- `decisions/007-chunk-level-fanout-review-pipeline.md`

## Memory
- `memory/lessons.md`
- `memory/pitfalls.md`
- `memory/review-findings.md`

## Critical cross-cutting rules
1. Every fact lives in exactly one file. Link; never copy.
2. `state/current.md` updates on every task that changes code.
3. API docs update in the same commit that changes the endpoint.
4. Never hardcode business payloads — data from DB + seeders only.
5. Auth boundary: all personas authenticate against `users.password_hash`. GitHub OAuth is identity-link only, not login-bypass.
