// Runs before every test file loads — supplies the env vars src/lib/env.ts requires at
// import time, so importing app.ts/container.ts in tests never hits `process.exit(1)`.
// No real Postgres/Redis/SMTP is ever contacted: individual test files mock @codeiq/db,
// ioredis, and nodemailer at the module level.
process.env.NODE_ENV = process.env.NODE_ENV ?? "test";
process.env.PORT = process.env.PORT ?? "4000";
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://test:test@localhost:5432/codeiq_test";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.JWT_SECRET = process.env.JWT_SECRET ?? "test-jwt-secret-at-least-32-characters-long";
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? "test-jwt-refresh-secret-at-least-32-chars-diff";
process.env.MAIL_HOST = process.env.MAIL_HOST ?? "smtp.test.local";
process.env.MAIL_PORT = process.env.MAIL_PORT ?? "587";
process.env.MAIL_USER = process.env.MAIL_USER ?? "test-user";
process.env.MAIL_PASSWORD = process.env.MAIL_PASSWORD ?? "test-password";
process.env.MAIL_FROM = process.env.MAIL_FROM ?? "CodeIQ Test <test@codeiq.dev>";
