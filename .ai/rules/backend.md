# Backend Rules

> Loaded when task touches `apps/api/**`

## Agent role

Senior backend engineer. Owns `apps/api/`. Responsible for all Express routes, services, repositories, jobs, and middleware.

## Route-audience table (hard constraint)

| Prefix        | Audience                        | Auth mechanism             |
| ------------- | ------------------------------- | -------------------------- |
| `/auth/*`     | Unauthenticated users           | None                       |
| `/github/*`   | JWT-authenticated users         | `authMiddleware`           |
| `/webhooks/*` | GitHub App                      | HMAC-SHA256 sig verify     |
| `/repos/*`    | JWT-authenticated users         | `authMiddleware`           |
| `/reviews/*`  | JWT-authenticated users         | `authMiddleware`           |
| `/billing/*`  | JWT-authenticated + Stripe sigs | Mixed (see billing domain) |

**Hard rule:** never mount a user-facing feature under `/webhooks/` and never mount a webhook handler under a JWT-protected prefix.

## Auth boundary (hard rule)

All user authentication goes through `users.password_hash` in PostgreSQL.
GitHub OAuth is used only to link a GitHub identity to an existing user account (`users.github_id`).
No path exists where a valid GitHub OAuth token bypasses password-based authentication.
→ Detail: `knowledge/domains/auth.md`

## Architecture constraints

→ Full architecture: `rules/architecture-rules.md`
→ Reasoning: `knowledge/technical/backend/architecture.md`

Short form:

- Layer order: Repository → Service → Controller → Router
- Interfaces cross layer boundaries; concrete classes never do
- Controllers only handle HTTP in/out; zero business logic
- Services own all business logic; zero DB client calls
- Repositories own all DB calls; zero business logic

## Per-module file pattern (copy this for every new module)

```
Every domain module follows the same 6-file structure:

```

modules/<name>/
├── <name>.interface.ts # IService + IRepository contracts — no implementation
├── <name>.controller.ts # HTTP in/out only — parse req, call service, send response
├── <name>.service.ts # Business logic — implements IService, receives IRepository via constructor
├── <name>.repository.ts # Prisma queries only — implements IRepository interface
├── <name>.routes.ts # Express Router — instantiates classes, mounts routes, Swagger JSDoc
└── <name>.types.ts # Zod schemas + inferred TypeScript request/response types

```

```

## Standard response envelope

All responses use this shape — no exceptions:

```typescript
{
  success: boolean;
  message: string;
  data: T | null;
}
```

Helper: `src/lib/response.ts` → `ok(data, message?)` and `fail(message, statusCode?)`

## Input validation pattern

- Library: Zod
- Middleware: `validate(schema)` from `src/middlewares/validate.middleware.ts`
- Mount position: on the router, before the controller handler
- On error: middleware returns `400` with `{ success: false, message: "Validation error", data: errors }`
- Controllers never manually validate — they trust the middleware has run

## Async error propagation

Express 5 (or `express-async-errors` on Express 4): async errors propagate to `error.middleware.ts` automatically. Never wrap async handlers in try/catch unless you need handler-specific error transformation.

## Behavioral rules (backend-specific)

1. Every new endpoint is documented before the PR merges. Spec location: `knowledge/technical/backend/api-guidelines.md`.
2. Every service method has a corresponding unit test in `__tests__/`. Tests mock the repository layer.
3. Every documented edge case in `knowledge/domains/` has a corresponding test case — this is the acceptance criteria.
4. Repositories are never instantiated directly in controllers. Dependency injection via constructor.
5. The BullMQ worker (`apps/api/src/jobs/worker.ts`) is the only place that calls `review.service.ts` for async jobs. Never call it from a controller.
6. Webhook controller responds 200 before any async work begins. Never await a job in a webhook handler.
7. Stripe webhook uses raw body (`express.raw()`). Do not parse it as JSON before signature verification.
