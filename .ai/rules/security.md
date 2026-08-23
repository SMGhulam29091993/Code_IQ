# Security Rules

> Non-negotiable. Violations block PR merge.

## Hard rules

1. **No hardcoded secrets or business payloads.** Env vars only. Validated at startup via `src/lib/env.ts`.
2. **Auth boundary.** Users authenticate via `users.password_hash`. GitHub OAuth links an identity; it never grants access on its own.
3. **Webhook signature verification is mandatory.** `POST /webhooks/github` rejects any request where `crypto.timingSafeEqual` fails. Same for Stripe webhook. This check runs before any other logic.
4. **GitHub App private key is base64-encoded in env.** Never commit the PEM file. Decode at runtime:
   ```typescript
   Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY!, "base64").toString("utf-8");
   ```
5. **JWT secret rotation.** `JWT_SECRET` and `JWT_REFRESH_SECRET` must be different values, minimum 32 characters, cryptographically random.
6. **Stripe raw body.** The Stripe webhook route mounts `express.raw({ type: 'application/json' })` before any JSON parser. The parsed body is never used for signature verification.
7. **SQL injection prevention.** All DB access is through Prisma parameterized queries. Raw SQL (`prisma.$queryRaw`) is forbidden unless explicitly approved and reviewed.
8. **Rate limiting.** Auth routes (`/auth/login`, `/auth/register`) are rate-limited: 10 requests per IP per 15 minutes. Implemented in `src/middlewares/rate-limit.middleware.ts`.
9. **Password hashing.** bcrypt with cost factor 12. Never store plaintext passwords. Never log passwords.
10. **Tenant isolation.** Every DB query that touches `Repo`, `Review`, or `ReviewIssue` must scope by `installationId`. The `installationMiddleware` attaches `req.installation` and enforces ownership. A controller that calls a service without passing `installationId` is a security bug.
11. **Always follow proper git branching, when adding, fixing or documenting anything

## Dev-bypass guard pattern

For any third-party integration stub in development:

```typescript
if (process.env.NODE_ENV === "production") {
  throw new Error("Dev bypass must never run in production");
}
// stub logic here
```

This guard must appear at the top of any dev-only code path, before any stub logic.

## Security hardening backlog

| Item                            | Status  | Plan step           |
| ------------------------------- | ------- | ------------------- |
| Helmet.js headers               | pending | plans/backend.md §1 |
| Rate limiting on auth routes    | pending | plans/backend.md §1 |
| GitHub token encryption at rest | pending | plans/backend.md §3 |
| Input sanitization (XSS)        | pending | plans/backend.md §1 |
| CORS strict origin list         | pending | plans/backend.md §1 |
