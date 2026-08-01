# ADR 003: OTP Email Verification on Registration (Instead of Issuing Tokens Immediately)

## Context
`POST /auth/register` used to hash the password, create the user, and immediately return
access + refresh tokens — the account was usable before the email address was ever confirmed
as reachable. There was no step that verified the registrant actually controls the email
they signed up with.

## Decision
On successful registration, create a short-lived OTP (5 min validity, 3 attempts) instead of
issuing tokens. The raw OTP is emailed to the user; only an opaque `identifier` is returned to
the frontend. Tokens are issued only after `POST /auth/verify-otp` confirms the OTP. Three
failed verification attempts lock the account's email, requiring the user to register again
with a different email rather than retrying indefinitely.

Full schema, service flow, and endpoint contracts: `.ai/knowledge/domains/auth.md`.

## Consequences
**Positive:**
- Email address is proven reachable before the account can be used — reduces throwaway/typo
  emails and impersonation via someone else's address.
- The OTP row + Redis identifier are short-lived (5 min) and single-use, limiting the blast
  radius of a leaked identifier compared to a long-lived token.
- Locking after 3 failed attempts bounds brute-force guessing of a 6-digit OTP.

**Negative:**
- Registration is now two round trips (`register` then `verify-otp`) instead of one — frontend
  must hold the `identifier` across a redirect/screen change (see auth.md "Frontend" section).
- A user who never receives the email (spam filter, typo, mail service outage) is stuck with a
  half-registered account; no resend/rollback endpoint is defined yet — flagged as an open
  question in `.ai/knowledge/domains/auth.md`.
- Adds Redis as a hard dependency for the register→verify flow, not just for BullMQ (ADR 002).

**Applies to:** backend (`apps/api` auth module — `plans/backend.md` Step 2), frontend (register
screen — `plans/frontend.md` Step 2)
