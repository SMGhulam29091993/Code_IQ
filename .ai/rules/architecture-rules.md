# Architecture Rules
> Hard constraints. See `knowledge/technical/backend/architecture.md` for the reasoning.

## Layer table
| Layer       | Must                                      | Must NOT                                  |
|-------------|-------------------------------------------|-------------------------------------------|
| Repository  | Access DB via Prisma only                 | Contain business logic, call other repos  |
| Service     | Own all business logic, call repositories | Import Prisma directly, call controllers  |
| Controller  | Parse req, call service, send res         | Contain business logic, call repos        |
| Router      | Mount routes, attach middleware           | Contain logic of any kind                 |
| Middleware  | Transform/validate/authenticate request   | Call services directly (except auth)      |

## Dependency flow (interfaces only cross boundaries)
```
Router
  └── Controller
        └── IService (interface)
              └── IRepository (interface)
                    └── PrismaClient
```

Concrete classes (`ReviewService implements IReviewService`) are wired in `src/container.ts`.
Nothing outside `container.ts` calls `new SomeService(...)`.

## Infrastructure singleton pattern
```typescript
// src/lib/prisma.ts
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ['error'] });
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
```
Same pattern for Redis client. Reason: survives hot-reload without leaking connections.

## Startup sequence (ordered)
1. Load and validate all env vars (fail fast with clear message if missing)
2. Connect Prisma (`prisma.$connect()`)
3. Connect Redis (`redis.ping()`)
4. Register BullMQ workers (`worker.ts`)
5. `app.listen(PORT)` — only after all dependencies confirmed reachable
6. Register `error.middleware.ts` last

## Core paradigm
Class-based, interface-driven, layered architecture. Non-negotiable. Functional utilities are allowed inside a class method; the module boundary is always a class implementing an interface.
