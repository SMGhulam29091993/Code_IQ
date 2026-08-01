# Pitfalls
> Specific technical traps with root causes. Add when caught in review or production.

## 001 — Stripe raw body parsed before signature verification
**Symptom:** `stripe.webhooks.constructEvent` throws "No signatures found matching the expected signature for payload".
**Root cause:** `express.json()` middleware ran before the Stripe webhook route, converting the raw buffer to a parsed object. Stripe's signature is computed over the raw bytes.
**Fix:** Mount `express.raw({ type: 'application/json' })` specifically on `/billing/webhook` BEFORE the global `express.json()` middleware. See `rules/security.md`.

## 002 — GitHub App private key newlines lost in env var
**Symptom:** `error:0909006C:PEM routines:get_name:no start line` from Octokit.
**Root cause:** PEM file stored directly in `.env` — shell or dotenv strips or mangles newlines.
**Fix:** Base64-encode the PEM file (`base64 -i private-key.pem`) and decode at runtime. Documented in `rules/security.md`.

## 003 — bcrypt timing attack on login
**Symptom:** N/A (security concern, not a bug).
**Root cause:** If you short-circuit on "user not found" before calling `bcrypt.compare`, attackers can distinguish "email not registered" from "wrong password" by timing the response.
**Fix:** Always run `bcrypt.compare` even when the user is not found, using a dummy hash. See pseudocode in `knowledge/domains/auth.md#login`.

## 004 — BullMQ duplicate jobs without jobId
**Symptom:** Same PR reviewed twice when GitHub retries a webhook delivery.
**Root cause:** Job enqueued without `jobId` — BullMQ treats each `add()` as unique.
**Fix:** Pass `{ jobId: req.headers['x-github-delivery'] }` as the BullMQ job options. Second enqueue with same `jobId` is a no-op.

## 005 — Tenant isolation missing on review query
**Symptom:** User A can fetch User B's reviews by guessing reviewId.
**Root cause:** `reviewRepo.findById(reviewId)` without scoping to `installationId`.
**Fix:** Every repo query that returns user data must join through `installationId` and verify ownership. The `installationMiddleware` attaches `req.installation` for this purpose.

## 006 — `authRateLimit` is one shared instance across /register, /verify-otp, /login
**Symptom:** A client hitting `/auth/register` a few times then `/auth/login` gets 429'd sooner than expected — the 10-request budget looks like it belongs to `/login` alone but is actually exhausted by earlier `/register` calls.
**Root cause:** `rate-limit.middleware.ts` exports a single `authRateLimit` middleware instance, and `auth.routes.ts` mounts that *same* instance on all three routes. express-rate-limit's default in-memory store keys by IP only (not by route), so all three endpoints share one 10-req/15-min counter per IP.
**Fix:** This is intentional per `rules/security.md` #8 (rate limiting is IP-based, not per-endpoint), but it matters for integration tests: `__tests__/auth.routes.test.ts` keeps its total request count across register/verify-otp/login well under 10 within a single test file, since they all draw from the same budget. If per-endpoint limits are ever wanted, switch to `rateLimit({ ... })` called separately per route instead of reusing one instance.
