# ADR 001: GitHub App over OAuth App

## Context
CodeIQ needs to post inline PR comments and receive webhook events for any repo a user connects.
Two options: GitHub OAuth App (user-token-based) or GitHub App (installation-token-based).

## Decision
Use GitHub App.

## Consequences
**Positive:**
- Installation tokens are not tied to a specific user — survive if the installing user leaves the org.
- Webhook events delivered automatically to all repos in the installation without per-repo setup.
- Posts comments as a bot identity (`codeiq[bot]`) — clearly attributable, not impersonating a user.
- Higher rate limits (5000 req/installation/hr vs. 5000 req/user/hr for OAuth).
- Fine-grained permission scoping (pull request: read + write; contents: read only).

**Negative:**
- More complex setup: App registration, private key management, installation flow UX.
- Requires base64-encoding PEM key in env (documented in `rules/security.md`).

**Applies to:** backend (apps/api), GitHub webhook setup
