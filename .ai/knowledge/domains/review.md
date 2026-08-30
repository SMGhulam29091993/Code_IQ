# Domain: Review
> The core feature. Covers the full AI review pipeline from job pickup to GitHub comment posting.

## Bounded context
Owns everything from "job dequeued from BullMQ" to "inline comments posted to GitHub PR".
Also owns the review history endpoints for the dashboard.

---

## API Routes

### GET /reviews
**Purpose:** List all PR reviews for the current user's installations.
**Auth:** JWT

**Query params:**
```typescript
{
  repoId?: string;
  status?: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  page?: number;   // default 1
  limit?: number;  // default 20, max 100
}
```

**Acceptance criteria:**
- [ ] Returns only reviews scoped to the current user's installations (tenant isolation)
- [ ] Supports pagination via `page` + `limit`
- [ ] Supports filtering by `repoId` and `status`
- [ ] Returns review summary fields (not full transcript — use GET /reviews/:id for that)
- [ ] Returns total count for pagination UI
- [ ] Each review includes `totalChunks`/`completedChunks` (live progress, decisions/007 Phase 4
  — UI-only, poll while `status` is `RUNNING` for a coarse progress bar) and `truncated`
  (whether `MAX_CHUNKS_PER_REVIEW` cut this PR down to its largest files)

**Response shape:**
```typescript
{
  data: {
    reviews: Review[];
    total: number;
    page: number;
    totalPages: number;
  }
}
```

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| `repoId` belongs to another user's installation | 403 `"Forbidden"` | |
| `limit` > 100 | 400 `"Limit cannot exceed 100"` | |
| `page` < 1 | 400 `"Page must be at least 1"` | |
| No reviews exist | `{ reviews: [], total: 0, page: 1, totalPages: 0 }` | |
| Invalid `status` value | 400 from Zod | |

**Implementation pseudocode:**
```
listReviews(userId, query):
  validate query with ListReviewsSchema
  installationIds = installationRepo.findIdsByUserId(userId)
  if query.repoId:
    repo = repoRepo.findById(query.repoId)
    if !repo || !installationIds.includes(repo.installationId)
      → throw ForbiddenError("Forbidden")
  reviews = reviewRepo.findMany({
    installationIds,
    repoId: query.repoId,
    status: query.status,
    skip: (page - 1) * limit,
    take: limit,
  })
  return ok({ reviews, total, page, totalPages })
```

**Unit test cases:**
```typescript
describe('ReviewService.listReviews', () => {
  it('returns only reviews for the current user\'s installations')
  it('filters by repoId when provided')
  it('filters by status when provided')
  it('paginates correctly with page and limit')
  it('throws ForbiddenError when repoId belongs to another user')
  it('throws BadRequestError when limit > 100')
  it('returns empty array with total:0 when no reviews exist')
  it('does not include issues array in list response (performance)')
})
```

---

### GET /reviews/:reviewId
**Purpose:** Get a single review with all issues.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Verifies review belongs to current user's installation (tenant isolation)
- [ ] Returns full review: summary, all `ReviewIssue` rows, file list, PR metadata

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| reviewId not found | 404 `"Review not found"` | |
| reviewId belongs to another user | 403 `"Forbidden"` | |
| Review status is PENDING | Returns review with empty `issues: []` | |
| Review status is RUNNING | Returns review with partial data (whatever is stored) | |

**Unit test cases:**
```typescript
describe('ReviewService.getReview', () => {
  it('returns full review with issues for authorized user')
  it('throws NotFoundError for unknown reviewId')
  it('throws ForbiddenError when review belongs to another user')
  it('returns empty issues array when review is PENDING')
  it('includes all ReviewIssue fields: file, line, severity, category, message, suggestion')
})
```

---

### POST /reviews/:reviewId/retry
**Purpose:** Re-run a failed review job.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Only works on reviews with status `FAILED`
- [ ] Resets review status to `PENDING`
- [ ] Enqueues a new review job
- [ ] Returns the updated review

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| Review is not FAILED | 400 `"Only failed reviews can be retried"` | |
| Review not found | 404 | |
| Review belongs to another user | 403 | |
| BullMQ unavailable | 503 | |

**Unit test cases:**
```typescript
describe('ReviewService.retryReview', () => {
  it('resets status to PENDING and enqueues job')
  it('throws BadRequestError when review status is not FAILED')
  it('throws NotFoundError for unknown reviewId')
  it('throws ForbiddenError when review belongs to another user')
})
```

---

### GET /reviews/stats
**Purpose:** Aggregate issue stats for the dashboard.
**Auth:** JWT

**Query params:**
```typescript
{ repoId?: string; days?: number }  // days default 30, max 90
```

**Acceptance criteria:**
- [ ] Returns issue counts by severity (critical, warning, info)
- [ ] Returns issue counts by category (bug, security, style, performance, logic)
- [ ] Returns daily trend (issues per day for the `days` window)
- [ ] Scoped to current user's installations

**Unit test cases:**
```typescript
describe('ReviewService.getStats', () => {
  it('returns severity breakdown')
  it('returns category breakdown')
  it('returns daily trend for default 30-day window')
  it('respects days param up to 90')
  it('throws BadRequestError when days > 90')
  it('scopes stats to current user\'s installations only')
})
```

---

## Core pipeline: 3 BullMQ processors (decisions/007 Phase 3)

The pipeline is 3 separate processors on 3 queues, fanned out/in via BullMQ's `FlowProducer` —
see `knowledge/technical/backend/review-pipeline-scaling.md` "Queue topology" for the full
rationale. Each is called only from the BullMQ worker (`jobs/worker.ts`) — never from a
controller. `ReviewChunk` persistence (Phase 2) and resumable retry are unchanged in spirit, just
spread across processors instead of living in one job.

### 1. review-coordinator.job.ts — `ReviewCoordinatorJobProcessor` (`review-coordinator-queue`)

The only processor that creates a *new* `Review` row — enqueued solely by
`webhook.service.ts`. Fetches the diff, persists `ReviewChunk` rows, and hands off to
`reviewFlowProducer`; never runs a Gemini call itself, so it stays fast and cheap
(`concurrency: 20`).
```
processCoordinatorJob(job):
  { installationId, repoId, prNumber, prTitle, prAuthor, headSha, repoFullName } = job.data

  // 1. Create Review row (status: RUNNING)
  review = reviewRepo.create({ repoId, prNumber, prTitle, prAuthor, headSha, status: 'RUNNING' })

  // 2-3. Installation-scoped Octokit + effective repo config, resolved once here and threaded
  // through every chunk job's data (resolve-review-context.ts) — never re-fetched per chunk.
  { octokit, owner, repo, repoConfig } = await resolveReviewContext(repoId, repoFullName, installationId, ...)

  // 4. Fetch PR diff
  files = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber })

  // 5. Filter files by ignore patterns and config
  filesToReview = diffService.filterFiles(files, repoConfig)
  if filesToReview.length === 0:
    reviewRepo.update(review.id, { status: 'DONE', summary: 'No reviewable files in this PR.', filesReviewed: 0 })
    return

  // 6. Chunk the largest diffs first (diffService.prioritizeFiles — additions+deletions desc)
  // and persist a ReviewChunk row (PENDING) per chunk *before* fanning out — a crash here still
  // leaves chunks a retry can discover via findIncomplete. Truncate to MAX_CHUNKS_PER_REVIEW
  // (200) if the PR produced more chunks than that — a pathological PR (thousands of files)
  // gets a bounded cost/time instead of an unbounded number of Gemini calls.
  chunks = diffService.chunkFiles(diffService.prioritizeFiles(filesToReview))
  truncated = false
  if chunks.length > MAX_CHUNKS_PER_REVIEW:
    chunks = chunks.slice(0, MAX_CHUNKS_PER_REVIEW)
    truncated = true
  chunkRows = reviewChunkRepo.createMany(review.id, chunks)
  reviewRepo.update(review.id, { totalChunks: chunkRows.length, truncated })

  // Per-installation fairness: an installation with many chunks already in flight gets a lower
  // BullMQ priority for its next chunk jobs, so one tenant's huge PR can't starve everyone
  // else's small ones. See fairnessService below.
  priority = await fairnessService.priorityFor(installationId)

  // 7. Fan out: one review-chunk job per chunk under a review-finalize parent. BullMQ activates
  // the parent automatically once every child has settled; failParentOnFailure: false means one
  // chunk exhausting its own retries doesn't block finalization.
  await flowProducer.add({
    name: 'finalize-review', queueName: 'review-finalize-queue',
    data: { reviewId: review.id, installationId, owner, repo, prNumber, prTitle, headSha, truncated },
    children: chunkRows.map(row => ({
      name: 'review-chunk', queueName: 'review-chunk-queue',
      data: { reviewId: review.id, chunkId: row.id, installationId, filename: row.filename, patch: row.patch, repoConfig },
      opts: { jobId: `${review.id}:${row.id}`, priority, attempts: 3, backoff: { type: 'exponential', delay: 2000 }, failParentOnFailure: false },
    })),
  })

ON ANY UNHANDLED ERROR:
  reviewRepo.update(review.id, { status: 'FAILED' })
  throw error  // BullMQ retries (max 3 attempts, exponential backoff)
```

### 2. review-chunk.job.ts — `ReviewChunkJobProcessor` (`review-chunk-queue`)

One job per chunk — the actual LLM-call workload, and the one queue you scale horizontally by
adding worker pods. Rate-limited fleet-wide via the queue's `Worker.limiter` (Redis-backed), not
an in-process pool. `attempts: 3` on each job (set by whoever created the Flow) means a failed
Gemini call gets BullMQ's own retry/backoff before this processor ever needs `failParentOnFailure`
to matter.

```
processChunkJob(job):
  { reviewId, chunkId, installationId, filename, patch, repoConfig } = job.data

  reviewChunkRepo.markRunning(chunkId)
  fairnessService.markInFlight(installationId, +1)
  try:
    result = await geminiService.reviewDiff(patch, repoConfig, filename)
    reviewIssueRepo.createMany(reviewId, result.issues.map(issue => ({ ...issue, file: filename, chunkId })))
    reviewChunkRepo.markDone(chunkId)
  catch (err):
    reviewChunkRepo.markFailed(chunkId, String(err))
    throw err   // lets BullMQ's attempts/backoff retry; failParentOnFailure:false means the
                // parent still proceeds once retries are exhausted
  finally:
    reviewRepo.incrementCompletedChunks(reviewId)  // UI progress only — may over-count across
                                                     // this job's own retries; never trusted for
                                                     // the finalize job's DONE/FAILED gate
    fairnessService.markInFlight(installationId, -1)
```

### 3. review-finalize.job.ts — `ReviewFinalizeJobProcessor` (`review-finalize-queue`)

The Flow parent — BullMQ activates it automatically once every `review-chunk` child of the same
Flow has settled (DONE or exhausted-retries FAILED). Aggregates whatever issues exist for the
review (this run's chunks, plus — on a retry — chunks that already reached DONE in an earlier
attempt), posts the single GitHub review, and marks the review DONE/FAILED.

```
processFinalizeJob(job):
  { reviewId, installationId, owner, repo, prNumber, prTitle, headSha, truncated } = job.data

  allChunks = reviewChunkRepo.findByReviewId(reviewId)
  failedChunks = allChunks.filter(c => c.status === 'FAILED')

  if allChunks.length > 0 and failedChunks.length === allChunks.length:
    reviewRepo.update(reviewId, { status: 'FAILED' })   // no GitHub post — nothing succeeded
    return

  allIssues = reviewIssueRepo.findByReviewId(reviewId)
  summary = await geminiService.summarizePR(prTitle, allIssues)
  if truncated:
    summary += `\n\n_This PR exceeded the per-review analysis limit — only the largest files were reviewed._`
  if failedChunks.length > 0:
    summary += `\n\n_${failedChunks.length} file section(s) could not be analyzed after retries._`

  octokit = getInstallationOctokit(installationRepo.findById(installationId).githubInstallationId)
  githubReviewId = await commentService.postReview(octokit, { owner, repo, prNumber, headSha, issues: allIssues, summary })

  reviewRepo.update(reviewId, {
    status: 'DONE',
    summary,
    filesReviewed: new Set(allChunks.filter(c => c.status === 'DONE').map(c => c.filename)).size,
    githubReviewId,
  })
```

### fairnessService (`lib/fairness.ts`) — per-installation fair queuing (decisions/007 Phase 4)

Substitute for BullMQ Pro's paid per-group rate limiting: track each installation's currently
in-flight chunk count in Redis (`chunks:inflight:${installationId}`, `INCR`/`DECR` around each
chunk job, 300s TTL as a safety net against a crashed pod leaking the counter), and set that
installation's next chunk jobs' BullMQ `priority` from it — one priority tier lower (numerically
higher = lower priority in BullMQ) per 20 in-flight chunks, clamped to `[1, 10]`. An installation
with nothing in flight stays at the top tier; a huge PR gradually cedes ground to quieter tenants.
See `knowledge/technical/backend/review-pipeline-scaling.md` "Why fairness via priority score,
not BullMQ Pro groups".

### Retry (`POST /reviews/:reviewId/retry`)

`ReviewService.retryReview` never touches `review-coordinator-queue` — a retry's chunks (and
their already-persisted patches) are already known, so it resolves repo context once
(`resolve-review-context.ts`, same helper the coordinator uses), scores priority via
`fairnessService.priorityFor`, and calls `reviewFlowProducer.add` directly with only the review's
incomplete (`PENDING`/`FAILED`) `ReviewChunk` rows as children. Each child gets a fresh `jobId`
(`${reviewId}:${chunkId}:retry${chunk.attempts}`) since the chunk's original job id is already
terminal in BullMQ. A `DONE` chunk is never in the incomplete list, so it's never re-run and
never re-billed. `truncated` on the finalize job's data comes straight from the `Review` row
already loaded — a retry never re-runs the truncation decision, only the coordinator does that.

### Edge cases in the review pipeline:
| Case | Handling |
|------|----------|
| PR has 0 reviewable files after filtering | Coordinator marks DONE with note, no fan-out, no GitHub comment |
| PR produces more chunks than `MAX_CHUNKS_PER_REVIEW` (200) | Coordinator keeps the largest-diff chunks (`diffService.prioritizeFiles`), marks `Review.truncated = true`; finalize appends a note to the summary |
| A Gemini chunk call fails (after its own retries) | That chunk stays FAILED; finalize still posts the DONE chunks' issues, with a note about the gap |
| ALL chunks fail | Finalize marks review FAILED without posting to GitHub |
| One installation has many chunks in flight | `fairnessService` lowers that installation's next chunk jobs' BullMQ priority — doesn't block them, just deprioritizes relative to quieter installations |
| GitHub rate limit hit (403) | BullMQ retry with exponential backoff (whichever job made the call) |
| PR deleted before review finishes | GitHub API returns 404 — mark DONE, log warning |
| Gemini returns malformed JSON | Zod parse fails → chunk job throws → chunk marked FAILED |
| Gemini returns > 50 issues for one chunk | Truncate at 50 (Zod schema `.max(50)`) |
| File is binary (no `patch`) | Filter out in `diffService.filterFiles` |
| File is in ignore pattern | Filter out in `diffService.filterFiles` |
| Coordinator job re-delivered (same deliveryId) | BullMQ `jobId` dedup on `review-coordinator-queue` — second enqueue is a no-op |
| Concurrent coordinator jobs for same PR | Last one wins (headSha differs → separate Review row) |
| Retry | Re-enters the Flow directly with only non-`DONE` `ReviewChunk` rows as children — no diff re-fetch, no re-billing already-successful chunks |
| Retry where every chunk fails again | Review marked `FAILED` again, same as a fresh run |
| One review-chunk job's Gemini call fails all 3 attempts | `failParentOnFailure: false` lets the finalize job run anyway once every sibling has also settled |

### Unit test cases
```typescript
describe('ReviewCoordinatorJobProcessor.process', () => {
  it('creates a Review row at start')
  it('marks review FAILED when the installation is not found')
  it('applies ignore patterns from repo config via diffService.filterFiles')
  it('marks DONE with no-issues summary when all files are filtered out, without fanning out')
  it('persists a ReviewChunk row per chunk and records totalChunks before fanning out')
  it('fans out one review-chunk job per chunk under a finalize-review parent')
  it('truncates to MAX_CHUNKS_PER_REVIEW and marks the review truncated when a PR produces more chunks than the cap')
  it('prioritizes the largest diffs before chunking')
})

describe('ReviewChunkJobProcessor.process', () => {
  it('marks the chunk RUNNING before calling Gemini')
  it('calls Gemini with the chunk\'s patch, config, and filename')
  it('persists returned issues tagged with the review, file, and chunk id')
  it('marks the chunk DONE on success')
  it('marks the chunk FAILED and rethrows (so BullMQ retries) when Gemini fails')
  it('increments completedChunks whether the chunk succeeds or fails')
  it('marks the installation in flight around the Gemini call, on success or failure')
})

describe('ReviewFinalizeJobProcessor.process', () => {
  it('posts a single GitHub review with every issue aggregated for the review')
  it('marks the review DONE with distinct-filename filesReviewed and the githubReviewId')
  it('marks the review FAILED without posting when every chunk failed')
  it('still posts and marks DONE on a partial failure, noting the gap in the summary')
  it('notes the per-review analysis limit in the summary when the review was truncated')
})

describe('FairnessService', () => {
  it('returns the highest priority (1) when nothing is in flight')
  it('drops one priority tier per 20 in-flight chunks')
  it('clamps at the lowest priority (10) for very high in-flight counts')
  it('scopes the in-flight key to the installation')
  it('increments the installation\'s counter and refreshes its TTL')
  it('supports decrementing when a chunk finishes')
})
```

---

## diff.service.ts

### filterFiles pseudocode:
```
filterFiles(files, config):
  return files.filter(file =>
    file.patch !== undefined &&  // no binary files
    file.status !== 'removed' &&  // skip deleted files
    !config.ignorePatterns.some(pattern => micromatch(file.filename, pattern))
  )
```

### chunkFiles pseudocode:
```
chunkFiles(files):
  chunks = []
  for file in files:
    lines = file.patch.split('\n')
    if lines.length <= 300:
      chunks.push({ filename: file.filename, patch: file.patch, chunkIndex: 0 })
    else:
      // Split into 300-line chunks with 20-line overlap
      i = 0
      chunkIndex = 0
      while i < lines.length:
        end = min(i + 300, lines.length)
        chunks.push({ filename: file.filename, patch: lines.slice(i, end).join('\n'), chunkIndex })
        i += 280  // 20-line overlap
        chunkIndex++
  return chunks
```

### prioritizeFiles pseudocode (decisions/007 Phase 4)
```
prioritizeFiles(files):
  return [...files].sort((a, b) => diffSize(b) - diffSize(a))
  // diffSize(file) = (file.additions ?? 0) + (file.deletions ?? 0)
```
Used by the coordinator job to chunk the largest diffs first, so a `MAX_CHUNKS_PER_REVIEW`
truncation keeps the files most likely to carry real issues.

### Unit test cases for diff.service.ts:

```typescript
describe('DiffService.filterFiles', () => {
  it('excludes binary files (no patch property)')
  it('excludes deleted files (status: removed)')
  it('excludes files matching ignore patterns')
  it('includes files not matching any ignore pattern')
  it('handles empty ignore patterns list')
  it('uses glob matching for patterns (e.g. "*.test.ts")')
})

describe('DiffService.prioritizeFiles', () => {
  it('sorts files by additions+deletions descending')
  it('treats files with no additions/deletions info as size 0')
  it('does not mutate the input array')
})

describe('DiffService.chunkFiles', () => {
  it('returns single chunk for files under 300 lines')
  it('splits large files into multiple chunks')
  it('maintains 20-line overlap between chunks')
  it('correctly numbers chunkIndex')
  it('handles empty patch string')
})
```

---

## gemini.service.ts

### reviewDiff pseudocode:
```
reviewDiff(patch, config, filename):
  systemPrompt = buildSystemPrompt(config, filename)
  result = await geminiClient.generateContent({
    systemInstruction: systemPrompt,
    contents: [{ role: 'user', parts: [{ text: patch }] }],
    generationConfig: { responseMimeType: 'application/json' },
  })
  raw = JSON.parse(result.response.text())
  return ReviewResultSchema.parse(raw)  // throws ZodError on bad output
```

### buildSystemPrompt:
```
You are an expert code reviewer. Analyze the git diff for file: ${filename}.
Return ONLY valid JSON matching this exact schema:
{
  "issues": [{
    "line": number,
    "severity": "critical" | "warning" | "info",
    "category": "bug" | "security" | "style" | "performance" | "logic",
    "message": string (max 200 chars),
    "suggestion": string (max 500 chars)
  }],
  "summary": string (max 500 chars)
}
Rules:
- Only report ${config.enabledCategories.join(', ')} categories.
- Minimum severity to report: ${config.severityThreshold}.
- Maximum 50 issues. Prioritize by severity.
- No markdown. No explanation outside the JSON.
```

### Unit test cases for gemini.service.ts:
```typescript
describe('GeminiService.reviewDiff', () => {
  it('parses valid Gemini JSON response correctly')
  it('throws ZodError when Gemini returns invalid schema')
  it('limits issues to 50 (Zod .max(50))')
  it('passes responseMimeType: application/json to force JSON output')
  it('includes filename in system prompt')
  it('includes enabled categories in system prompt')
  it('includes severity threshold in system prompt')
  it('handles empty patch (returns 0 issues)')
})
```

---

## comment.service.ts

### postReview pseudocode:
```
postReview(octokit, { owner, repo, prNumber, headSha, issues, summary }):
  // Format inline comments
  comments = issues.map(issue => ({
    path: issue.file,
    line: issue.line,
    body: formatComment(issue),
  }))

  // Single GitHub review API call
  response = await octokit.pulls.createReview({
    owner, repo,
    pull_number: prNumber,
    commit_id: headSha,
    event: 'COMMENT',  // non-blocking — does not REQUEST_CHANGES
    body: formatSummary(summary, issues),
    comments,
  })
  return response.data.id

formatComment(issue):
  icon = { critical: '🔴', warning: '🟡', info: '🔵' }[issue.severity]
  return `${icon} **${capitalize(issue.severity)} · ${capitalize(issue.category)}**
${issue.message}

**Suggestion:** ${issue.suggestion}`

formatSummary(summary, issues):
  critical = issues.filter(i => i.severity === 'critical').length
  warning = issues.filter(i => i.severity === 'warning').length
  info = issues.filter(i => i.severity === 'info').length
  return `## CodeIQ Review
${summary}

| Severity | Count |
|----------|-------|
| 🔴 Critical | ${critical} |
| 🟡 Warning | ${warning} |
| 🔵 Info | ${info} |`
```

### Unit test cases for comment.service.ts:
```typescript
describe('CommentService.postReview', () => {
  it('calls createReview with event: COMMENT (not REQUEST_CHANGES)')
  it('batches all issues into a single createReview call')
  it('maps issue.file to path correctly')
  it('maps issue.line to line correctly')
  it('formats comment body with severity icon, category, message, suggestion')
  it('formats summary with issue count breakdown by severity')
  it('returns the GitHub review ID')
  it('handles empty issues array (posts summary-only review)')
})
```

---

## Implementation notes (discovered during Step 5)

- **Ownership-check pattern for `GET/POST /reviews/:reviewId*`.** `IReviewRepository.findById`
  is deliberately *not* pre-scoped to `userId` (unlike `findManyForUser`, which is) — it fetches
  by `reviewId` alone, including `repo.installation.userId`, and `ReviewService`'s private
  `findOwnedReview` does the ownership check itself. This is what lets it return 404 for an
  unknown `reviewId` and 403 for one that belongs to another user, matching the edge-case table
  above — the same split `modules/repos/repo.service.ts`'s `findOwnedRepo` uses (see
  `repos.md`'s implementation notes for pitfall #005's tenant-isolation stance).
- **`GET /reviews/stats` scopes every field to the `days` window** — `totalReviews`,
  `totalIssues`, both breakdowns, and `recentTrend` are all filtered by `ReviewIssue.createdAt >=
  now - days`. This isn't explicit in the acceptance criteria above (only `recentTrend` says "for
  the `days` window"), but treating the other three inconsistently would make the `days` query
  param meaningless for them. `GET /repos/:repoId/stats` (`repos.md`) intentionally does *not*
  follow this — its totals are all-time and only `recentTrend` is windowed (fixed 30 days) — so
  don't assume the two stats endpoints share a filtering convention.
- **`ReviewJobProcessor` (not `review.job.ts` as a bare function) is the pipeline entry point.**
  It's a class taking all eight dependencies via constructor (mirrors every other module's
  DI pattern) with a single `process(job)` method; `container.ts` wires the concrete instance as
  `reviewJobProcessor`, and `jobs/worker.ts`'s `startReviewWorker(processor)` is what `server.ts`
  calls at boot to register the BullMQ consumer. Nothing else calls `.process()` directly.
- **Retry re-enqueues with `jobId: retry-${reviewId}`**, not the original GitHub delivery ID —
  `ReviewService.retryReview` has no delivery ID to reuse. This still gets BullMQ's dedup
  protection (pitfall #004) if a user double-clicks retry while the first retry is in flight. One
  side effect (unchanged by decisions/007 Phase 2, pre-existing): because the jobId is a pure
  function of `reviewId` and BullMQ refuses to re-add a job whose id already exists (even
  terminal/completed), retrying the *same* review a second time after its first retry already
  completed silently no-ops rather than enqueueing — hasn't come up in practice yet, flagging in
  case it does.
- **decisions/007 Phase 2 (chunk-level fan-out, groundwork): `ReviewChunk` rows are now persisted
  around every Gemini call**, and `ReviewJobData.reviewId` (set only by `retryReview`) tells the
  processor to resume that review's non-`DONE` chunks instead of creating a new `Review` row and
  re-fetching/re-chunking the diff from GitHub. `Review.completedChunks` is incremented
  atomically (`{ increment: 1 }`) in each chunk's `finally` block for UI progress only — the
  "did everything fail" gate at finalize time always re-queries real `ReviewChunk` rows via
  `findByReviewId`, never that counter. This is still one BullMQ job per PR/retry (chunk
  execution isn't its own queue yet — see `review-pipeline-scaling.md` Phase 3).
- **`postSummaryComment` (a `RepoConfig` field) is not consulted by the pipeline.** Step 11 of
  the pseudocode above always calls `commentService.postReview`, unconditionally — there's no
  gate in this doc's pseudocode, so `ReviewJobProcessor` doesn't add one. The field exists in
  the schema and `modules/repos`' config CRUD but currently has no effect on review behavior;
  flag this if a future step is expected to make it do something.
- **`micromatch`'s `{ basename: true }` option does not behave as "apply basename matching only
  to slash-less patterns"** — passing it globally broke matching for slash-containing patterns
  like `"dist/**"` (verified empirically: `isMatch('dist/out.js', 'dist/**', {basename:true})` →
  `false`). `diff.service.ts`'s `filterFiles` branches on `pattern.includes("/")` itself:
  slash-less patterns (e.g. `"*.test.ts"`) get `{ basename: true }` so they match at any depth
  like `.gitignore`; patterns with a slash match the full path only, with no options passed.
- **`ReviewIssue` has no dismiss/resolution state.** The Claude Design mockup's Review Detail
  screen (`knowledge/screens/dashboard-screens.md`) shows a Dismiss button on every issue card,
  but there's no column here for it and no endpoint. The mockup's own design notes flag this as
  an open product question, not a build decision — the frontend renders the button inert (no API
  call) rather than this doc inventing a `dismissed` column speculatively. If dismiss becomes
  real, it needs a decision on semantics first (per-user dismissal vs. global, does it affect
  `GET /reviews/stats` counts, etc.) before a migration.
- **`GeminiService` depends on `IGeminiClient`, not the `@google/generative-ai` SDK's own
  `GenerativeModel` type** — a narrow interface (`generateContent` only) declared in
  `review.types.ts`. `lib/gemini.ts` constructs the real `GenerativeModel` via
  `genAI.getGenerativeModel(...)` and types the export against `IGeminiClient`, so unit tests
  mock a plain object instead of the SDK, same pattern as `IGithubApiClient`.
