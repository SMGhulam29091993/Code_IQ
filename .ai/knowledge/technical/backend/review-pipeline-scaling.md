# Review Pipeline Scaling — HLD & LLD
> Full design behind [decisions/007](../../decisions/007-chunk-level-fanout-review-pipeline.md).
> Read that ADR first for the *why*; this doc is the *how*. All 4 phases are implemented
> backend-side (see "Migration phases" at the bottom); real behavior now lives in
> `knowledge/domains/review.md` "Core pipeline" — this doc stays the design record. Not yet
> load-tested against a real large PR, and Phase 4's dashboard UI wiring is still open (frontend,
> tracked separately). See `plans/backend.md` Step 8 for status.

## Design goals
1. Large-PR latency scales with fleet capacity, not with one process's in-memory pool.
2. No tenant can starve another tenant's queue (multi-tenant fairness).
3. A crash/retry never re-does already-completed chunk work (resumability).
4. Gemini rate limits are enforced fleet-wide, not per-job.
5. A pathological PR (thousands of files) has a hard cost/time ceiling.
6. Dashboard shows live progress instead of a silent RUNNING state.

---

## HLD — architecture

### Queue topology (3 BullMQ queues, up from 1)

```
                        ┌─────────────────────────┐
  GitHub webhook  ───►  │  review-coordinator-queue │   concurrency: 20 (cheap: 1 diff fetch)
                        └────────────┬─────────────┘
                                     │ fetch diff, filter, chunk,
                                     │ create Review + ReviewChunk rows,
                                     │ FlowProducer.add(parent + children)
                                     ▼
                        ┌─────────────────────────┐
                        │   review-chunk-queue      │   concurrency: N per pod (horizontally
                        │   (1 job per chunk)       │   scaled — add pods under load)
                        │   limiter: fleet-wide      │   limiter: { max: GEMINI_RPM_BUDGET,
                        │   Gemini RPM cap           │             duration: 60_000 }
                        └────────────┬─────────────┘
                                     │ BullMQ Flow: parent auto-fires
                                     │ once all children settle
                                     ▼
                        ┌─────────────────────────┐
                        │  review-finalize-queue    │   aggregate issues, summarize,
                        │   (1 job per review)      │   post single GitHub review, mark DONE
                        └─────────────────────────┘
```

Today's single `review-queue` becomes `review-coordinator-queue` (same trigger point, same
`jobId = X-GitHub-Delivery` dedup). Everything downstream of "chunk the diff" moves out of that
job and into the two new queues.

### Why `FlowProducer` over hand-rolled fan-in
BullMQ's `FlowProducer` gives parent/child jobs natively: the parent (`finalize-review`) only
activates once every child (`review-chunk`) has settled. No hand-rolled "decrement a counter,
check if zero" coordination and no race between the last chunk finishing and the finalize logic
checking too early. `failParentOnFailure: false` on each child means one Gemini call failing
(after its own retries) doesn't block the whole PR's summary — it just gets noted as a gap.

### Why fleet-wide rate limiting via `Worker.limiter`, not per-job pooling
`lib/concurrency.ts`'s `mapWithConcurrency` only bounds parallelism *inside one job*. Five
concurrent coordinator jobs, each running their own pool, can still collectively exceed Gemini's
RPM quota — the current cap doesn't coordinate across jobs. BullMQ's `Worker` `limiter` option is
enforced via Redis across every worker process consuming that queue, so it's correct under
horizontal scale-out (add pods, the limiter still gates total fleet throughput) in a way an
in-process pool structurally cannot be.

### Why fairness via priority score, not BullMQ Pro groups
BullMQ's per-group rate limiting/fair-queuing is a Pro (paid) feature. A practical open-source
substitute: track each installation's currently-in-flight chunk count in Redis
(`INCR`/`DECR` around each chunk job), and set that installation's next chunk jobs' BullMQ
`priority` proportionally to it. Installations with many chunks already in flight get
deprioritized relative to quiet ones — approximate weighted fair queuing with no new
infrastructure. Revisit BullMQ Pro if this proves insufficient at real scale.

### Why one GitHub comment at the end, not streaming comments
GitHub's `pulls.createReview` posts a review as a single atomic unit — there's no supported way
to edit a review-in-progress incrementally the way `issueComment`s can be edited. True per-file
streaming to GitHub would mean switching to issue-comment-based posting (noisier PR timeline,
different formatting, loses the single collapsible review UI). Given `architecture.md`'s existing
`event: 'COMMENT'` rationale (avoid overwhelming/frustrating developers), keep one final GitHub
post; expose live progress in-app instead via `Review.completedChunks`/`totalChunks` (dashboard
can poll or subscribe). Flag as a config toggle to revisit later if customers ask for
per-file streaming.

### Backpressure: `MAX_CHUNKS_PER_REVIEW`
If chunking produces more chunks than the cap (config, suggested default 200), prioritize a
subset instead of reviewing everything:
1. Drop files already excluded by `ignorePatterns` (existing behavior).
2. Sort remaining files by `additions + deletions` descending (bigger diffs are more likely to
   carry real issues than a one-line version bump).
3. Take the top N chunks; mark `Review.truncated = true`; finalize job appends a note to the
   summary (`"Reviewed the N largest files of this PR; M files were skipped — PR exceeds the
   per-review analysis limit."`).

This bounds worst-case cost/time for vendor-bump or generated-code PRs without silently doing
nothing.

---

## LLD

### Schema changes (`packages/db/prisma/schema.prisma`)

```prisma
model ReviewChunk {
  id          String      @id @default(cuid())
  reviewId    String
  review      Review      @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  filename    String
  chunkIndex  Int
  patch       String      @db.Text
  status      ChunkStatus @default(PENDING)
  attempts    Int         @default(0)
  error       String?
  startedAt   DateTime?
  completedAt DateTime?
  createdAt   DateTime    @default(now())

  @@unique([reviewId, filename, chunkIndex])
  @@index([reviewId, status])
}

enum ChunkStatus {
  PENDING
  RUNNING
  DONE
  FAILED
}
```

`Review` gains:
```prisma
totalChunks     Int     @default(0)
completedChunks Int     @default(0)   // denormalized live-progress counter, UI-only —
                                       // finalize job re-queries ReviewChunk rows directly
                                       // for the DONE/FAILED gating decision, never trusts this
truncated       Boolean @default(false)
chunks          ReviewChunk[]
```

`ReviewIssue` gains `chunkId String?` (nullable FK to `ReviewChunk`) so issues trace back to the
chunk that produced them — useful for debugging and for the finalize job's per-chunk failure
notes.

### Coordinator job (`review-coordinator-queue`)
```
processCoordinatorJob(job):
  { installationId, repoId, prNumber, prTitle, prAuthor, headSha, repoFullName } = job.data

  review = reviewRepo.create({ repoId, prNumber, prTitle, prAuthor, headSha, status: 'RUNNING' })
  octokit = getInstallationOctokit(...)
  files = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber })
  repoConfig = await configService.getEffectiveConfig(repoId, octokit, owner, repo)
  filesToReview = diffService.filterFiles(files, repoConfig)
  chunks = diffService.chunkFiles(filesToReview)   // unchanged from today

  truncated = false
  if chunks.length > MAX_CHUNKS_PER_REVIEW:
    chunks = prioritizeAndTruncate(chunks, MAX_CHUNKS_PER_REVIEW)  // sort by additions+deletions desc
    truncated = true

  if chunks.length === 0:
    reviewRepo.update(review.id, { status: 'DONE', summary: 'No reviewable files in this PR.' })
    return

  chunkRows = reviewChunkRepo.createMany(review.id, chunks)  // status PENDING
  reviewRepo.update(review.id, { totalChunks: chunkRows.length, truncated })

  priority = await fairnessService.priorityFor(installationId)

  await flowProducer.add({
    name: 'finalize-review',
    queueName: 'review-finalize-queue',
    data: { reviewId: review.id, installationId, owner, repo, prNumber, headSha: review.headSha },
    children: chunkRows.map(row => ({
      name: 'review-chunk',
      queueName: 'review-chunk-queue',
      data: {
        reviewId: review.id, chunkId: row.id, installationId,
        filename: row.filename, patch: row.patch, repoConfig,
      },
      opts: {
        jobId: `${review.id}:${row.id}`,
        priority,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        failParentOnFailure: false,
      },
    })),
  })
```

### Chunk job (`review-chunk-queue`)
```
processChunkJob(job):
  { reviewId, chunkId, installationId, filename, patch, repoConfig } = job.data

  await reviewChunkRepo.update(chunkId, { status: 'RUNNING', startedAt: now(), attempts: { increment: 1 } })
  await fairnessService.markInFlight(installationId, +1)

  try:
    result = await geminiService.reviewDiff(patch, repoConfig, filename)  // fleet-wide rate
                                                                            // limit is enforced
                                                                            // at the Worker level,
                                                                            // not in this call
    await reviewIssueRepo.createMany(
      result.issues.map(issue => ({ ...issue, reviewId, chunkId, file: filename }))
    )
    await reviewChunkRepo.update(chunkId, { status: 'DONE', completedAt: now() })
  catch (err):
    await reviewChunkRepo.update(chunkId, { status: 'FAILED', error: String(err) })
    throw err   // lets BullMQ's attempts/backoff retry; failParentOnFailure:false means the
                // parent still proceeds once retries are exhausted
  finally:
    await reviewRepo.increment(reviewId, 'completedChunks', 1)   // UI progress only
    await fairnessService.markInFlight(installationId, -1)
```

### Finalize job (`review-finalize-queue`, triggered by Flow completion)
```
processFinalizeJob(job):
  { reviewId, owner, repo, prNumber, headSha } = job.data

  review = await reviewRepo.findById(reviewId)
  issues = await reviewIssueRepo.findByReviewId(reviewId)
  chunks = await reviewChunkRepo.findByReviewId(reviewId)
  failed = chunks.filter(c => c.status === 'FAILED')

  summary = await geminiService.summarizePR(review.prTitle, issues)
  if review.truncated:
    summary += `\n\n_This PR exceeded the per-review file limit — the ${chunks.length} largest
                 files were reviewed._`
  if failed.length > 0:
    summary += `\n\n_${failed.length} file section(s) could not be analyzed after retries._`

  octokit = getInstallationOctokit(...)
  githubReviewId = await commentService.postReview(octokit, {
    owner, repo, prNumber, headSha, issues, summary,
  })

  await reviewRepo.update(reviewId, {
    status: failed.length === chunks.length ? 'FAILED' : 'DONE',
    summary,
    filesReviewed: chunks.length - failed.length,
    githubReviewId,
  })
```
Gating on real `ReviewChunk` rows (not the denormalized `completedChunks` counter) avoids any
race between the counter and Flow-completion timing — the counter exists purely so the dashboard
has something cheap to poll for "X/Y files reviewed" without a `COUNT(*)` query.

### Retry (`POST /reviews/:reviewId/retry`) — now resumable
```
retryReview(reviewId):
  review = findOwnedReview(reviewId)
  if review.status !== 'FAILED': throw BadRequestError
  incomplete = await reviewChunkRepo.findByReviewId(reviewId, { status: ['PENDING', 'FAILED'] })
  await reviewRepo.update(reviewId, { status: 'RUNNING' })

  priority = await fairnessService.priorityFor(review.repo.installationId)
  await flowProducer.add({
    name: 'finalize-review', queueName: 'review-finalize-queue',
    data: { reviewId, ... },
    children: incomplete.map(c => ({
      name: 'review-chunk', queueName: 'review-chunk-queue',
      data: { reviewId, chunkId: c.id, filename: c.filename, patch: c.patch, ... },
      opts: {
        jobId: `${reviewId}:${c.id}:retry${c.attempts}`,  // new jobId per retry generation —
                                                            // old jobId is already DONE/terminal
                                                            // in BullMQ, needs a fresh one to re-run
        priority, attempts: 3, backoff: { type: 'exponential', delay: 2000 },
        failParentOnFailure: false,
      },
    })),
  })
```
This is the direct payoff of persisting chunk state: retry only re-pays for chunks that never
reached `DONE`, not the entire PR.

### Fairness service (new, `lib/fairness.ts` or similar)
```
priorityFor(installationId):
  inFlight = Number(await redis.get(`chunks:inflight:${installationId}`) ?? 0)
  return clamp(1 + Math.floor(inFlight / 20), 1, 10)   // BullMQ: lower number = higher priority

markInFlight(installationId, delta):
  key = `chunks:inflight:${installationId}`
  await redis.incrby(key, delta)
  await redis.expire(key, 300)   // safety net so a crashed pod can't leak a permanently-inflated counter
```

### Worker registration changes (`jobs/worker.ts`)
```ts
// review-coordinator-queue: cheap jobs, high concurrency
new Worker('review-coordinator-queue', coordinatorProcessor.process, { connection, concurrency: 20 });

// review-chunk-queue: the actual LLM-call workload — this is what you scale horizontally
// (multiple pods/processes, all sharing the same fleet-wide limiter via Redis)
new Worker('review-chunk-queue', chunkProcessor.process, {
  connection,
  concurrency: CHUNK_WORKER_POD_CONCURRENCY,     // e.g. 10, per pod
  limiter: { max: GEMINI_RPM_BUDGET, duration: 60_000 },  // fleet-wide, Redis-enforced
});

// review-finalize-queue: one job per review, low volume
new Worker('review-finalize-queue', finalizeProcessor.process, { connection, concurrency: 10 });
```

---

## Migration phases
The current pipeline is live-verified against a real GitHub App/PR (see `state/current.md`) —
this ships incrementally, not as one rewrite, so each phase can be verified independently before
the next.

### Phase 1 — Schema only (additive, no behavior change) [ shipped 2026-08-30 ]
Add `ReviewChunk` model + `Review.totalChunks/completedChunks/truncated` + `ReviewIssue.chunkId`.
Migrate. Nothing reads/writes the new table yet. Zero risk.

### Phase 2 — Chunk persistence inside the existing single-job pipeline [ shipped 2026-08-30 ]
Keep today's one-BullMQ-job-per-PR execution model (still `mapWithConcurrency` in-process), but
have `ReviewJobProcessor` write a `ReviewChunk` row (PENDING → RUNNING → DONE/FAILED) around each
chunk's Gemini call, and stamp `ReviewIssue.chunkId`. Change `retryReview` to only re-run chunks
that aren't `DONE`. **This alone fixes the worst production risk (wasted re-work on retry)**
without touching queue topology — low risk, ships independently, immediately valuable.
Superseded by Phase 3's queue split below (the single `ReviewJobProcessor` no longer exists), but
the `ReviewChunk` persistence and resumable-retry behavior it introduced carried straight through
unchanged.

### Phase 3 — Queue split (the horizontal-scaling + fairness unlock) [ shipped 2026-08-30 ]
Introduced `review-chunk-queue` and `review-finalize-queue`, moved chunk execution out of the
coordinator job into real BullMQ jobs via `FlowProducer` (`ReviewCoordinatorJobProcessor`,
`ReviewChunkJobProcessor`, `ReviewFinalizeJobProcessor` — `jobs/review-{coordinator,chunk,finalize}.job.ts`),
added the chunk queue's Worker-level `limiter` (`GEMINI_RPM_BUDGET`, fleet-wide via Redis).
`ReviewService.retryReview` now calls `reviewFlowProducer.add` directly with the review's
incomplete `ReviewChunk` rows as children, instead of going through `review-coordinator-queue`.
See `knowledge/domains/review.md` "Core pipeline" for the current (real) pseudocode and unit test
list — that doc, not this one, is now the source of truth for pipeline *behavior*.
**Not yet load-tested against a real large PR** — unit/integration-verified only
(`pnpm test`, 328/328); real-PR load testing and `failParentOnFailure: false` verification under
actual partial-chunk-failure conditions is still open before this is trusted at scale in
production.

### Phase 4 — Fairness + backpressure + live progress [ shipped 2026-08-30, backend only ]
Per-installation priority scoring (`FairnessService`, `lib/fairness.ts` — Redis in-flight
counter → BullMQ `priority`), `MAX_CHUNKS_PER_REVIEW` (200) truncation +
`DiffService.prioritizeFiles` in the coordinator, and the API side of live progress:
`SanitizedReviewSummary`/`packages/types` `ReviewSummary` now carry `totalChunks`/
`completedChunks`/`truncated`. **Not done**: actually wiring `completedChunks`/`totalChunks`
into the dashboard UI (poll `GET /reviews/:reviewId` more frequently while RUNNING, or a future
SSE/WebSocket channel — still no decision on which) — that's a frontend step, tracked separately,
not part of this backend-scoped pass. Also not done: a real load test with a 200+-chunk PR to
confirm truncation and fairness behave as designed end-to-end.

Each phase needs `knowledge/domains/review.md` updated to match (pseudocode there currently
describes today's single-job pipeline) once actually built — not before, per this project's
usual practice of documenting what's real, not what's planned.
