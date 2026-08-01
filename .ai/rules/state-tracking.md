# State Tracking Rule

Extends [agent-role.md](agent-role.md)'s state-tracking rule with the full mechanics of how every
`.ai/` subdirectory stays current for the Medeeze (VMD) backend.

## Development Plan step lifecycle

When working through [plans/backend.md](../plans/backend.md) (the 24-step development plan — currently
the only step-based plan file in `.ai/plans/`; `roadmap.md`, `database.md`, and `testing.md` are
supporting views, not separate step sequences):

- When a step starts, mark it `inprogress` (🟡) in both `plans/backend.md` and `plans/roadmap.md`'s
  status table before writing any code for it.
- Work through a step **one sub-step at a time** — don't jump ahead to a later sub-step before the
  current one is done.
- Only mark a step `completed` (✅) once all of its sub-steps are done, committed, and verified. A step
  with any deferred or blocked sub-task stays `inprogress`/🟡, never ✅ — see
  [agent-role.md](agent-role.md)'s "each step must reach `completed` before the next begins" rule, which
  this lifecycle exists to make concrete.
- Note: `plans/roadmap.md` currently documents a real deviation from this rule — Step 21 was started
  while Steps 11-20 were still not started. Don't silently "fix" the roadmap to hide this; if you resolve
  it (e.g. by returning to Step 11), update the anomaly note in `roadmap.md` to say so.

## On every completed task

1. Append a concise entry to [state/prompt-history.md](../state/prompt-history.md):

   ```
   ### [YYYY-MM-DD HH:MM]
   **User Request:** (one sentence)
   **Agent Action:** (files touched, migrations, verification, or architectural decision)
   ```

   Never log secrets, tokens, passwords, or customer PII (SAP/CRM credentials, JWT secrets, customer
   documents, Pay Now account numbers, etc.).

2. **Also update, every time** — not just the prompt history log:
   - [state/current.md](../state/current.md) — what's actively in progress right now.
   - [state/completed.md](../state/completed.md) — move the just-finished item here.
   - [state/next.md](../state/next.md) — what's queued up next.

State files must never go stale — this is a hard rule, not a suggestion. If a task doesn't change the
current/completed/next picture (e.g. a pure read-only question), it's fine to skip the state-file update,
but any code change, migration, or plan-affecting decision must be reflected there before the task is
considered done.

## Commit-status claims are a special case — verify, don't assert

Never write a commit-status claim ("not yet committed", "awaiting user's explicit commit instruction",
"unstaged") into `current.md`, `completed.md`, or `next.md` as if it were a permanent fact — it becomes
stale the instant the user commits, and nothing re-checks it automatically.

- Before **writing** a commit-status claim into a state file, or **reading** one to answer a question,
  run `git log`/`git status` and use the actual result — never trust or repeat prose describing commit
  state without checking.
- If something is genuinely uncommitted at the time of writing, prefer phrasing that ages safely instead
  of a flat claim: reference the specific commit once it exists (`committed in <hash>`) rather than
  leaving "not yet committed" to rot after the fact.
- `state/prompt-history.md` is the one exception — it's an append-only timestamped log describing what
  was true at that moment, not current state, so it's fine for an old entry to say "not committed" even
  after a later commit lands. Don't "fix" old log entries; only `current.md`/`completed.md`/`next.md`
  need to stay live.

## Memory updates (`.ai/memory/`)

- **[pitfalls.md](../memory/pitfalls.md)** — append a short entry (symptom → root cause → fix/avoidance)
  whenever a bug's root cause wasn't obvious, per [workflows/bug-fix.md](../workflows/bug-fix.md) (once
  that workflow is written for real). This is the file for technical gotchas/traps — e.g. the
  `sap_customer_code` has-no-`@unique` constraint forcing `updateMany` instead of `update` in
  `syncCustomers` (see [knowledge/tech/jobs.md](../knowledge/tech/jobs.md)) is the kind of thing that
  belongs here.
- **[lessons.md](../memory/lessons.md)** — append whenever the _approach_ was wrong, not a specific
  technical trap — e.g. the user corrects an assumption about how they want something done, or an
  approach is validated after being non-obvious. Broader/process-shaped, not bug-shaped.
- **[patterns.md](../memory/patterns.md)** — when the same implementation approach recurs across two or
  more modules (e.g. the ownership-check-then-T3-fetch pattern already used in both
  [finance](../knowledge/domains/finance.md) and [procurement](../knowledge/domains/procurement.md), or
  the two-step draft→external-system→submitted pattern used for RFQ), add a short named entry here so
  the next module reuses it instead of reinventing it.
- **[review-findings.md](../memory/review-findings.md)** — populated by
  [workflows/code-review.md](../workflows/code-review.md) runs (once that workflow is written for real);
  also add directly whenever you spot a real finding outside a formal review pass.

All four memory files are currently empty — populate them only with real, specific events as they
actually happen. Do not backfill fabricated incidents to make this rule file's examples look lived-in.

## Decision records (`.ai/decisions/`)

Whenever a real product or technical ambiguity gets resolved with an explicit decision — e.g. a
contradiction between source documents, a schema design choice, an infra/tooling choice — create a new
numbered file (`.ai/decisions/00N-short-slug.md`) using the existing files
([001-commonjs-over-esm.md](../decisions/001-commonjs-over-esm.md),
[002-prisma-7-adapter-pattern.md](../decisions/002-prisma-7-adapter-pattern.md),
[003-express-5.md](../decisions/003-express-5.md)) as the template (Context / Decision / Consequences).
Don't fabricate a decision file for routine implementation choices — only for genuine ambiguity that got
explicitly resolved.

## Workflow docs (`.ai/workflows/`)

Update the relevant workflow file when the **team's actual process** for that workflow changes — e.g. a
new lint rule, a different test framework, a new migration convention, or a new preferred sequence for
implementing a feature. These are meta-process docs; they don't change just because the codebase changes
(that's what `.ai/knowledge/` and `.ai/plans/` are for), only when _how the team works_ changes.

[code-review.md](../workflows/code-review.md), [generate-tests.md](../workflows/generate-tests.md), and
[bug-fix.md](../workflows/bug-fix.md) are still TODO stubs — write them for real the first time each
process is actually run, not ahead of time.
