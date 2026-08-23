# CodeIQ

CodeIQ is a GitHub App that automatically reviews every pull request using Gemini 1.5 Pro. It
posts inline comments per changed file, a PR-level summary, and stores every review in a
dashboard. Billing is Stripe seat-based; the app is multi-tenant by GitHub App installation.

## Architecture

Turborepo monorepo, pnpm workspaces.

```
├── apps/api        Express + TypeScript + Prisma + PostgreSQL + BullMQ + Redis
├── apps/web        Next.js 14 (App Router) + Zustand + Tanstack Query
└── packages/
    ├── db          Shared Prisma client + schema
    ├── types       Shared TypeScript interfaces
    └── config      Shared ESLint + tsconfig base
```

Backend is class-based and layered: `Router → Controller → Service (interface) → Repository
(interface) → Prisma`. Every domain module (`auth`, `github`, `repos`, `reviews`, `billing`)
follows the same file structure — see `.ai/rules/backend.md` for the pattern and hard
constraints.

## API surface

| Prefix          | Audience                              |
| ---------------- | -------------------------------------- |
| `/api/auth/*`     | Unauthenticated (register/login/OTP)   |
| `/api/github/*`   | JWT-authenticated                      |
| `/api/webhooks/*` | GitHub App (HMAC-SHA256 signature)     |
| `/api/repos/*`    | JWT-authenticated                      |
| `/api/reviews/*`  | JWT-authenticated                      |
| `/api/billing/*`  | JWT-authenticated + Stripe signatures  |
| `/health`         | Unauthenticated (Prisma + Redis ping)  |

## Prerequisites

- Node.js ≥ 20 (the Docker images use Node 22 — `pnpm@11.1.2`, pinned via `packageManager`,
  requires it)
- pnpm (via `corepack enable`)
- Docker, for Postgres/Redis (or the full containerized stack)

## Getting started

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

Fill in `apps/api/.env`. All values are validated at startup (`src/lib/env.ts`) — the process
refuses to boot if any required variable is missing or malformed. Notably:

- `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (base64-encoded PEM — see the comment in
  `.env.example` and `.ai/rules/security.md` #4), `GITHUB_WEBHOOK_SECRET`, `GITHUB_CLIENT_ID`,
  `GITHUB_CLIENT_SECRET` all come from one GitHub App registration
  (`github.com/settings/apps/new`) — see `.ai/knowledge/domains/github-app.md`.
- `JWT_SECRET` / `JWT_REFRESH_SECRET`: `openssl rand -base64 32` (must differ)
- `ENCRYPTION_KEY`: `openssl rand -hex 32` (64 hex chars)
- `STRIPE_*`: from the Stripe Dashboard (test mode) / Stripe CLI (`stripe listen`)

### 3. Start Postgres + Redis

```bash
cd apps/api
docker compose up -d postgres redis
```

### 4. Run database migrations

```bash
pnpm db:migrate
```

### 5. Start the app

```bash
pnpm dev
```

Runs `apps/api` (port 4000) and `apps/web` (port 3000) together via Turborepo, with hot reload.

## Running the full stack in Docker

Instead of steps 3–5, bring up all four services (Postgres, Redis, API, web) together:

```bash
cd apps/api
docker compose up -d --build
```

`apps/api/Dockerfile` and `apps/web/Dockerfile` are multi-stage builds (`turbo prune` → install →
build → minimal non-root runtime). The `api` service reads secrets from `apps/api/.env` and talks
to `postgres`/`redis` over the compose network; `GET /health` checks both.

## Scripts (repo root)

| Command             | Description                                  |
| -------------------- | --------------------------------------------- |
| `pnpm dev`           | Run all apps in dev mode (Turborepo)          |
| `pnpm build`         | Build all apps/packages                       |
| `pnpm lint`           | Lint all apps/packages                        |
| `pnpm typecheck`     | Typecheck all apps/packages                   |
| `pnpm test`           | Run all test suites                           |
| `pnpm db:generate`   | Regenerate the Prisma client                  |
| `pnpm db:migrate`     | Run Prisma migrations (dev)                   |

## Testing

```bash
pnpm --filter @codeiq/api test
```

Vitest, with the repository layer mocked at the module boundary for unit tests and a real
Express app (via supertest) for integration tests.

## Project knowledge base

This repo keeps an AI-agent-oriented knowledge base under [`.ai/`](.ai/project_context.md) —
platform rules, domain/screen knowledge, technical conventions, implementation plans, and a
running state/decision/pitfall log. Start at `.ai/project_context.md`; it indexes everything
else.
