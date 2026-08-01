# Workflow: Generate Tests

## Rule
Every unit test case listed in `knowledge/domains/*.md` must exist as an `it(...)` block.
This is the acceptance criteria — not advisory.

## Test structure for service unit tests

No live Postgres/Redis in dev or CI yet (that lands with `plans/backend.md` Step 7 — Deploy).
Until then, unit tests build the repository/service dependencies as plain `vi.fn()` objects
typed against the module's `I*Repository`/`I*Service` interface — no dedicated `__mocks__/`
mock classes, no test database:

```typescript
// __tests__/auth.service.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthService } from '../modules/auth/auth.service';
import type { IUserRepository, IRefreshTokenRepository, IOtpRepository } from '../modules/auth/auth.types';
import type { IOtpService } from '../services/otp.service';
import type { IMailServiceFactory } from '../services/mail/mail.types';

// Mock modules imported directly by the service under test (infra singletons, not
// constructor-injected) BEFORE importing the service — vi.mock calls are hoisted regardless
// of where they're written, but placing them near the top keeps intent clear.
vi.mock('../lib/redis', () => ({ redis: { get: vi.fn(), set: vi.fn(), del: vi.fn() } }));
vi.mock('../lib/jwt', () => ({
  signAccessToken: vi.fn(() => 'access-token'),
  signRefreshToken: vi.fn(() => 'refresh-token'),
  refreshTokenExpiry: vi.fn(() => new Date()),
  verifyRefreshToken: vi.fn(() => ({ sub: 'user-1' })),
}));

describe('AuthService', () => {
  let userRepo: IUserRepository;
  let authService: AuthService;

  beforeEach(() => {
    userRepo = { findByEmail: vi.fn(), findById: vi.fn(), create: vi.fn(), updateLastLogin: vi.fn(), lockEmail: vi.fn() };
    // ...construct the other constructor-injected dependencies the same way
    authService = new AuthService(userRepo, /* refreshTokenRepo, otpRepo, otpService, mailServiceFactory */);
  });

  describe('login', () => {
    it('throws UnauthorizedError for wrong password', async () => {
      (userRepo.findByEmail as ReturnType<typeof vi.fn>).mockResolvedValue({ passwordHash: '...' });
      await expect(authService.login({ email: 'a@b.com', password: 'wrong' }))
        .rejects.toBeInstanceOf(UnauthorizedError);
    });
  });
});
```

Constructor-injected dependencies (repositories, other services) are mocked as plain objects
per the pattern above. Dependencies a service imports directly as a module-level singleton
(`lib/redis.ts`, `lib/jwt.ts`) are mocked with `vi.mock(...)` instead, since they can't be
passed through the constructor.

## Test structure for route integration tests

Same constraint applies: mock the infrastructure boundary (`@codeiq/db`, `ioredis`,
`nodemailer`) at the module level, then exercise the real Express `app` end-to-end with
`supertest`. This tests real routing/validation/middleware/service wiring without a live
database:

```typescript
// __tests__/auth.routes.test.ts
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@codeiq/db', () => ({
  prisma: {
    user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    refreshToken: { create: vi.fn(), findUnique: vi.fn(), deleteMany: vi.fn() },
  },
  UserStatus: { ACTIVE: 'ACTIVE', LOCKED: 'LOCKED' },
}));
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({ get: vi.fn(), set: vi.fn(), del: vi.fn() })),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: vi.fn().mockReturnValue({ sendMail: vi.fn().mockResolvedValue(undefined) }) },
}));

import { prisma } from '@codeiq/db';
import { app } from '../app';

describe('POST /api/auth/login', () => {
  it('returns 401 for invalid credentials', async () => {
    (prisma.user.findUnique as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const res = await request(app).post('/api/auth/login').send({ email: 'ghost@x.com', password: 'x' });
    expect(res.status).toBe(401);
  });
});
```

`vitest.setup.ts` (wired via `vitest.config.ts`'s `test.setupFiles`) supplies the env vars
`lib/env.ts` requires at import time, so importing `app.ts` never hits `process.exit(1)` for
missing config.

Note: middleware shared across multiple routes (e.g. `authRateLimit` on `/register`,
`/verify-otp`, and `/login` — see `memory/pitfalls.md` #006) shares state across `it()` blocks
within one test file. Keep total request counts against a shared-middleware route group well
under its limit within a single test file, or the limiter will trip mid-suite.

Once `plans/backend.md` Step 7 stands up a real test database, route integration tests can
switch to seeding real fixtures via `__tests__/helpers.ts` (`createTestUser`,
`createTestInstallation`) instead of mocking `@codeiq/db` — update this file again when that
migration actually happens, not before.

## How to generate tests from a domain file
1. Open `knowledge/domains/<domain>.md`
2. For each API route, find the **Unit test cases** block
3. Each `it(...)` line in that block becomes exactly one test in the `__tests__/` file
4. Edge cases table → each row is a test case
5. Run tests, fix failures, do not delete tests to make them pass
