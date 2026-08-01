# Lessons
> Wrong assumptions about approach, corrected. Add when a design decision was reversed.

## 001 — Don't use REQUEST_CHANGES as GitHub review event type
**Assumption:** Using `REQUEST_CHANGES` would make the review more authoritative.
**Reality:** `REQUEST_CHANGES` blocks the PR from merging until dismissed. AI reviewers flag style issues alongside bugs — blocking on every PR leads to the GitHub App being uninstalled.
**Correction:** Always use `event: 'COMMENT'`. Developers see every issue; they choose what to act on.
→ See `knowledge/technical/backend/architecture.md` for the full reasoning.

## 002 — Don't scope .ai/ per-app in this monorepo
**Assumption:** Each app should have its own `.ai/` folder since they have different stacks.
**Reality:** Backend and frontend implement the same business domains (auth, review, billing). Splitting `.ai/` would mean maintaining two copies of `knowledge/domains/auth.md`. The AI-POS guide is explicit: split only when apps are genuinely separate products.
**Correction:** One root `.ai/`. Rules files declare their own scope (`applies to apps/api/**`).
