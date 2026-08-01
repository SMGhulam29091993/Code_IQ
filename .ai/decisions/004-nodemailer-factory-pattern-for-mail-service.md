# ADR 004: Nodemailer via Factory Pattern for the Mail Service

## Context
The welcome email (existing) and the new OTP email (ADR 003) are the first two mail types.
Each has its own template and, potentially, its own delivery requirements (e.g. OTP mail
benefits from higher deliverability priority than a welcome email). Wiring `AuthService`
directly to a single nodemailer transporter call per mail type would mean every new mail type
adds another branch of transporter/template logic inside business-logic services.

## Decision
Introduce a `MailServiceFactory.create(type)` that returns the sender configured for a given
mail type (`'welcome' | 'otp' | ...`), backed by nodemailer. Callers (e.g. `auth.service.ts`)
depend only on `mailServiceFactory.create(type).send(to, data)` and never construct a
transporter or pick a template themselves.

Detail: `.ai/knowledge/domains/auth.md` "Mail Service" section.

## Consequences
**Positive:**
- Adding a new mail type (e.g. password-reset later) means adding a factory case, not touching
  `auth.service.ts` or any other business-logic caller.
- Template and transporter config for each mail type live in one place (`services/mail/`),
  consistent with the layering rule that services own business logic and never construct
  infra clients ad hoc (`rules/architecture-rules.md`).
- Matches the existing fire-and-forget convention already used for the welcome email — no
  behavioral surprise for callers.

**Negative:**
- One more indirection than calling nodemailer directly — not worth it if the app only ever
  sends one kind of email, but we already have two (welcome, OTP) at introduction time.
- Factory must be wired through `src/container.ts` like every other service (`rules/backend.md`
  "Per-module file pattern"); not yet built — lands with the auth module in `plans/backend.md`
  Step 2.

**Applies to:** backend (`apps/api/src/services/mail/` — `plans/backend.md` Step 2)
