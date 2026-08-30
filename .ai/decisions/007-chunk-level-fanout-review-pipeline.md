# ADR 007: Chunk-Level Fan-Out/Fan-In for the Review Pipeline

## Context
The current pipeline (`ReviewJobProcessor`, see `knowledge/domains/review.md`) processes an
entire PR as **one BullMQ job**: fetch diff → chunk every file → run all chunks through
`mapWithConcurrency` inside that single job → wait for every chunk → one Gemini summary call →
one GitHub review post. This works for small/medium PRs but breaks down at enterprise scale:

- **Head-of-line blocking.** The worker has a fixed concurrency of 5 job *slots*
  (`REVIEW_WORKER_CONCURRENCY` in `jobs/worker.ts`). A single huge PR (hundreds of files → tens
  of chunks, rate-limited against Gemini) occupies one slot for minutes. With multiple tenants
  sharing the one `review-queue`, a big PR from one installation delays small PRs from everyone
  else — no fairness, no tenant isolation.
- **No horizontal scale-out per PR.** All of one PR's chunks run inside a single Node process's
  in-memory worker pool (`mapWithConcurrency`). Adding more worker pods doesn't speed up one
  large PR — its chunk parallelism is capped by that one process, not by fleet capacity.
- **All-or-nothing latency.** Nothing is visible to the user until 100% of chunks, the summary
  call, and the GitHub post all finish. A large PR can take minutes with zero feedback.
- **No resumability.** A crash, BullMQ stall, or failed job throws away all completed chunk
  work. Retry (`POST /reviews/:reviewId/retry`) re-runs the entire PR from scratch — every
  already-successful Gemini call is repeated, wasting time and LLM cost.
- **Rate limiting is per-job, not fleet-wide.** `lib/concurrency.ts`'s `mapWithConcurrency` caps
  parallelism *inside one job*. It does not coordinate across the 5 concurrently-running jobs
  each doing their own chunk pool — under concurrent PRs, the fleet can still overshoot Gemini's
  RPM quota, which is exactly the problem that cap was added to solve (see
  `knowledge/domains/review.md` implementation notes).
- **Unbounded worst case.** Nothing caps how many files/chunks one PR can generate. A
  5,000-file vendor-bump PR would enqueue thousands of chunk calls with no ceiling on cost or
  time.

## Decision
Split the pipeline into a **coordinator job** (fetch + filter + chunk + fan out) and many
**chunk jobs** (one Gemini call each), joined by a **finalize job**, using BullMQ's
`FlowProducer` for native parent/child fan-in. Each chunk becomes its own BullMQ job with a
deterministic `jobId`, persisted to a new `ReviewChunk` row before it runs. Full HLD/LLD,
schema, queue topology, and phased migration plan:
→ `knowledge/technical/backend/review-pipeline-scaling.md`

Summary of what changes:
1. **`review-chunk-queue`** (new) — one job per chunk, horizontally scalable by adding worker
   pods; a cluster-wide BullMQ `limiter` (Redis-backed) replaces the in-process
   `mapWithConcurrency` cap for Gemini rate limiting.
2. **`ReviewChunk` model** (new) — each chunk's status (`PENDING`/`RUNNING`/`DONE`/`FAILED`) is
   persisted before/after the Gemini call, keyed by `jobId = ${reviewId}:${chunkId}`. Retry
   re-enqueues only chunks that never reached `DONE`.
3. **Per-installation fairness** — chunk job `priority` is computed from that installation's
   current in-flight chunk count (Redis counter), so one tenant's huge PR can't starve others
   without needing BullMQ Pro's paid group-rate-limit feature.
4. **`MAX_CHUNKS_PER_REVIEW` cap** — PRs producing more chunks than the cap get a prioritized
   subset reviewed; `Review.truncated` records that it happened.
5. **Finalize job** (new, triggered automatically by Flow completion) — aggregates all
   `ReviewIssue` rows for the review, generates the summary, posts the single GitHub review
   comment, marks `Review` DONE/FAILED. GitHub still receives exactly one review comment per PR
   (keeps `event: 'COMMENT'`'s non-blocking UX from `architecture.md`) — live progress
   (`completedChunks`/`totalChunks`) is exposed to the dashboard instead of posting incrementally
   to GitHub, since GitHub's review API doesn't support editing a review-in-progress.

## Consequences
**Positive:**
- Large-PR latency becomes `chunks ÷ fleet chunk-throughput` instead of `chunks ÷ one process's
  pool size` — horizontally scalable by adding `review-chunk-queue` worker pods.
- Retry only re-runs incomplete chunks — no repeated Gemini spend on already-reviewed files.
- Gemini rate limiting is enforced fleet-wide via BullMQ's Redis-backed `Worker` limiter, fixing
  a real correctness gap in the current per-job cap.
- One noisy tenant's huge PR no longer blocks other tenants' small PRs behind it.
- Dashboard can show live per-review progress (`completedChunks`/`totalChunks`) instead of a
  silent RUNNING state.
- Bounded worst case: `MAX_CHUNKS_PER_REVIEW` puts a ceiling on cost/time for pathological PRs.

**Negative:**
- More moving parts: 3 queues instead of 1, a new `ReviewChunk` table, a fairness service.
- `FlowProducer` parent/child semantics (esp. `failParentOnFailure: false` per child) must be
  used correctly or a single stuck chunk could block finalization — needs test coverage.
- Migration touches the core production pipeline (currently live-verified against a real GitHub
  PR per `state/current.md`) — must ship in phases, not as one big-bang rewrite.
- Slightly higher Redis load (per-chunk job bookkeeping, fairness counters) — acceptable given
  Redis/ElastiCache is already a planned dependency (backend Step 7).

**Applies to:** backend (`apps/api/src/jobs/`, `apps/api/src/modules/reviews/`,
`packages/db/prisma/schema.prisma`)
