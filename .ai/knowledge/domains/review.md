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

### Full pipeline pseudocode:
```
processReviewJob(job):
  { installationId, repoId, prNumber, prTitle, prAuthor, headSha, repoFullName } = job.data

  // 1. Create Review row (status: RUNNING)
  review = reviewRepo.create({
    repoId, prNumber, prTitle, prAuthor, headSha,
    status: 'RUNNING',
  })

  // 2. Get installation-scoped Octokit
  installation = installationRepo.findById(installationId)
  octokit = getInstallationOctokit(installation.githubInstallationId)

  // 3. Fetch PR diff
  [owner, repo] = repoFullName.split('/')
  files = await octokit.pulls.listFiles({ owner, repo, pull_number: prNumber })
  // files: Array<{ filename, patch, status, additions, deletions }>

  // 4. Load repo config (DB config merged with .codeiq.yml)
  repoConfig = await configService.getEffectiveConfig(repoId, octokit, owner, repo)

  // 5. Filter files by ignore patterns and config
  filesToReview = diffService.filterFiles(files, repoConfig)
  if filesToReview.length === 0:
    reviewRepo.update(review.id, { status: 'DONE', summary: 'No reviewable files in this PR.' })
    return

  // 6. Chunk each file's diff
  chunks = diffService.chunkFiles(filesToReview)
  // chunks: Array<{ filename, patch, chunkIndex }>

  // 7. Call Gemini for each chunk in parallel (Promise.allSettled)
  results = await Promise.allSettled(
    chunks.map(chunk => geminiService.reviewDiff(chunk.patch, repoConfig, chunk.filename))
  )

  // 8. Aggregate issues (ignore rejected chunks — log warning)
  allIssues = []
  for [i, result] in results.entries():
    if result.status === 'fulfilled':
      allIssues.push(...result.value.issues.map(issue => ({
        ...issue,
        file: chunks[i].filename,
      })))
    else:
      log.warn(`Chunk failed for ${chunks[i].filename}: ${result.reason}`)

  // 9. Store issues
  reviewIssueRepo.createMany(review.id, allIssues)

  // 10. Generate PR-level summary
  summary = await geminiService.summarizePR(prTitle, allIssues)

  // 11. Post inline comments + summary to GitHub
  await commentService.postReview(octokit, {
    owner, repo, prNumber, headSha,
    issues: allIssues,
    summary,
  })

  // 12. Mark done
  reviewRepo.update(review.id, {
    status: 'DONE',
    summary,
    filesReviewed: filesToReview.length,
    githubReviewId: <id from step 11>,
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
