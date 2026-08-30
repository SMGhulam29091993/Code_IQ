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

## Core pipeline: review.job.ts

This is the BullMQ worker. It is called only from the job queue — never from a controller.

### Full pipeline pseudocode

Updated for decisions/007 Phase 2 (chunk persistence + resumable retry) — still one BullMQ job
per PR/retry; see `knowledge/technical/backend/review-pipeline-scaling.md` for the queue-split
Phase 3 that comes later.
```
processReviewJob(job):
  { installationId, repoId, prNumber, prTitle, prAuthor, headSha, repoFullName, reviewId } = job.data
  isRetry = Boolean(reviewId)

  // 1. Create a Review row (status: RUNNING) for a fresh review, or load the existing one for a
  // retry — ReviewService.retryReview already reset it to PENDING before enqueueing.
  review = isRetry ? reviewRepo.findById(reviewId) : reviewRepo.create({
    repoId, prNumber, prTitle, prAuthor, headSha, status: 'RUNNING',
  })

  // 2. Get installation-scoped Octokit
  installation = installationRepo.findById(installationId)
  octokit = getInstallationOctokit(installation.githubInstallationId)
  [owner, repo] = repoFullName.split('/')

  // 3. Load repo config (DB config merged with .codeiq.yml) — needed for every Gemini call
  repoConfig = await configService.getEffectiveConfig(repoId, octokit, owner, repo)

  if isRetry:
    reviewRepo.update(review.id, { status: 'RUNNING' })
    // Patches are already persisted on ReviewChunk rows from the original run — no GitHub
    // diff re-fetch. Only chunks that never reached DONE re-run; DONE ones are never re-billed.
    chunksToRun = reviewChunkRepo.findIncomplete(review.id)  // status PENDING or FAILED
  else:
    // 4. Fetch PR diff
    files = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber })

    // 5. Filter files by ignore patterns and config
    filesToReview = diffService.filterFiles(files, repoConfig)
    if filesToReview.length === 0:
      reviewRepo.update(review.id, { status: 'DONE', summary: 'No reviewable files in this PR.', filesReviewed: 0 })
      return

    // 6. Chunk each file's diff and persist a ReviewChunk row (PENDING) per chunk *before* any
    // Gemini call — a crash from here on always has something to resume from on retry.
    chunks = diffService.chunkFiles(filesToReview)
    chunksToRun = reviewChunkRepo.createMany(review.id, chunks)
    reviewRepo.update(review.id, { totalChunks: chunksToRun.length })

  // 7. Call Gemini for each pending/failed chunk, capped at CHUNK_CONCURRENCY (3) in flight,
  // persisting chunk status around each call
  await mapWithConcurrency(chunksToRun, CHUNK_CONCURRENCY, async (chunk) => {
    reviewChunkRepo.markRunning(chunk.id)
    try:
      result = await geminiService.reviewDiff(chunk.patch, repoConfig, chunk.filename)
      reviewIssueRepo.createMany(review.id, result.issues.map(issue => ({ ...issue, file: chunk.filename, chunkId: chunk.id })))
      reviewChunkRepo.markDone(chunk.id)
    catch (err):
      log.warn(`Chunk failed for ${chunk.filename}: ${err}`)
      reviewChunkRepo.markFailed(chunk.id, String(err))
    finally:
      reviewRepo.incrementCompletedChunks(review.id)  // UI progress only, never trusted for gating
  })

  // 8. Aggregate every issue persisted for this review so far — including issues from chunks
  // that reached DONE in an earlier (failed) attempt, on a retry
  allChunks = reviewChunkRepo.findByReviewId(review.id)
  allIssues = reviewIssueRepo.findByReviewId(review.id)

  if allChunks.length > 0 and allChunks.every(c => c.status === 'FAILED'):
    throw new Error('All Gemini review calls failed')  // BullMQ retries; review marked FAILED below

  // 9. Generate PR-level summary
  summary = await geminiService.summarizePR(prTitle, allIssues)

  // 10. Post inline comments + summary to GitHub
  githubReviewId = await commentService.postReview(octokit, { owner, repo, prNumber, headSha, issues: allIssues, summary })

  // 11. Mark done
  reviewRepo.update(review.id, {
    status: 'DONE',
    summary,
    filesReviewed: new Set(allChunks.filter(c => c.status === 'DONE').map(c => c.filename)).size,
    githubReviewId,
  })

ON ANY UNHANDLED ERROR:
  reviewRepo.update(review.id, { status: 'FAILED' })
  throw error  // BullMQ will retry (max 3 attempts with exponential backoff)
```

### Edge cases in the review pipeline:
| Case | Handling |
|------|----------|
| PR has 0 reviewable files after filtering | Mark DONE with note, no GitHub comment |
| A Gemini chunk call fails | Log warning, skip that chunk, continue with others |
| ALL Gemini calls fail | Mark review FAILED, BullMQ retries |
| GitHub rate limit hit (403) | BullMQ retry with exponential backoff |
| PR deleted before review finishes | GitHub API returns 404 — mark DONE, log warning |
| Gemini returns malformed JSON | Zod parse fails → mark chunk as failed → warning |
| Gemini returns > 50 issues for one chunk | Truncate at 50 (Zod schema `.max(50)`) |
| File is binary (no `patch`) | Filter out in `diffService.filterFiles` |
| File is in ignore pattern | Filter out in `diffService.filterFiles` |
| Review job re-delivered (same deliveryId) | BullMQ `jobId` dedup — second enqueue is a no-op |
| Concurrent jobs for same PR | Last one wins (headSha differs → separate Review row) |
| Retry (job.data.reviewId set) | Resumes the existing Review; only re-runs `ReviewChunk` rows not yet `DONE` — no diff re-fetch, no re-billing already-successful chunks |
| Retry where every chunk fails again | Review marked `FAILED` again, same as a fresh run |

### Unit test cases for review.job.ts:
```typescript
describe('ReviewJob.processReviewJob', () => {
  it('creates a Review row with status RUNNING at start')
  it('marks review DONE on successful completion')
  it('marks review FAILED when unhandled error occurs')
  it('calls geminiService for each file chunk')
  it('uses Promise.allSettled — continues when one chunk fails')
  it('skips chunks with no patch (binary files)')
  it('applies ignore patterns from repo config')
  it('posts all issues in a single GitHub review API call')
  it('stores filesReviewed count correctly')
  it('marks DONE with no-issues summary when all files are filtered out')
  it('stores githubReviewId after successful GitHub post')
})

describe('ReviewJob.processReviewJob — retry (job.data.reviewId set)', () => {
  it('resumes the existing review instead of creating a new one')
  it('only re-runs chunks that are not DONE, never re-billing an already-successful chunk')
  it('aggregates issues from previously-DONE chunks together with newly-run chunks')
  it('marks the resumed review FAILED again if the retry\'s chunks fail too')
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
