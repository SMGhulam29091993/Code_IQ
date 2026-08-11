# Domain: GitHub App
> Covers GitHub App installation, Octokit token generation, and webhook receipt.

## Bounded context
Manages the lifecycle of GitHub App installations (install, uninstall, repo selection).
Generates per-installation Octokit tokens used by the review pipeline.
Handles incoming GitHub webhooks and enqueues review jobs.

---

## API Routes

### POST /github/install
**Purpose:** Save a GitHub App installation after the user is redirected back from GitHub.
**Auth:** JWT

**Request body:**
```typescript
{ installationId: number }
```

**Acceptance criteria:**
- [ ] Fetches installation metadata from GitHub API (account login, account type)
- [ ] Creates `Installation` row linked to current user
- [ ] Idempotent — if installation already exists, update it (upsert)
- [ ] Returns the created/updated installation

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| installationId not a positive integer | 400 from Zod | |
| GitHub API returns 404 for installation | 404 `"Installation not found on GitHub"` | |
| GitHub API unreachable | 502 `"GitHub API unavailable"` | |
| Installation already owned by different user | 409 `"Installation already registered"` | |
| Same user installs same app twice | Upsert succeeds (idempotent) | |

**Implementation pseudocode:**
```
saveInstallation(userId, body):
  validate body with InstallationSchema
  ghInstall = await githubService.getInstallation(body.installationId)
    on 404 → throw NotFoundError("Installation not found on GitHub")
    on network error → throw AppError("GitHub API unavailable", 502)
  existing = installationRepo.findByGithubId(body.installationId)
  if existing && existing.userId !== userId
    → throw ConflictError("Installation already registered")
  installation = installationRepo.upsert({
    githubInstallationId: body.installationId,
    accountLogin: ghInstall.account.login,
    accountType: ghInstall.account.type,   // 'User' | 'Organization'
    userId,
    isActive: true,
  })
  return ok(installation, 201)
```

**Unit test cases:**
```typescript
describe('InstallationService.saveInstallation', () => {
  it('creates installation on first install')
  it('upserts installation on second install by same user')
  it('throws ConflictError when installation belongs to different user')
  it('throws NotFoundError when GitHub API returns 404')
  it('throws 502 AppError when GitHub API is unreachable')
  it('stores accountType as USER or ORGANIZATION correctly')
  it('links installation to the correct userId')
})
```

---

### GET /github/installations
**Purpose:** List all GitHub App installations belonging to the current user.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Returns only installations where `userId = req.user.id`
- [ ] Includes repo count per installation
- [ ] Active installations only (excludes `isActive: false`)

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| User has no installations | Returns `{ data: [] }` (not 404) | |
| Pagination (future) | Accepted with `?page` and `?limit` query params | |

**Unit test cases:**
```typescript
describe('InstallationService.listForUser', () => {
  it('returns only installations for the requesting user')
  it('excludes inactive installations')
  it('includes repo count in each result')
  it('returns empty array when user has no installations')
})
```

---

### DELETE /github/installations/:installationId
**Purpose:** Mark an installation as inactive (soft delete — GitHub may still send webhooks briefly).
**Auth:** JWT

**Acceptance criteria:**
- [ ] Verifies installation belongs to current user
- [ ] Sets `isActive = false` (soft delete — preserve historical data)
- [ ] Deactivates all repos under that installation
- [ ] Does NOT call GitHub API (GitHub triggers `installation.deleted` webhook instead)

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| installationId not found | 404 `"Installation not found"` | |
| installationId belongs to another user | 403 `"Forbidden"` | |
| Already inactive | 200 (idempotent) | |

**Implementation pseudocode:**
```
deleteInstallation(userId, installationId):
  installation = installationRepo.findById(installationId)
  if !installation → throw NotFoundError("Installation not found")
  if installation.userId !== userId → throw ForbiddenError("Forbidden")
  installationRepo.update(installationId, { isActive: false })
  repoRepo.deactivateAllForInstallation(installationId)
  return ok(null, "Installation removed")
```

**Unit test cases:**
```typescript
describe('InstallationService.deleteInstallation', () => {
  it('soft-deletes the installation')
  it('deactivates all repos under the installation')
  it('throws NotFoundError for unknown installationId')
  it('throws ForbiddenError when installation belongs to another user')
  it('returns 200 when already inactive (idempotent)')
})
```

---

### POST /webhooks/github
**Purpose:** Receive all GitHub App webhook events. Enqueue review jobs for PR events.
**Auth:** HMAC-SHA256 signature verification (not JWT)

**Headers required:**
```
X-Hub-Signature-256: sha256=<hmac>
X-GitHub-Event: pull_request | installation | installation_repositories | ...
```

**Acceptance criteria:**
- [ ] Verifies HMAC signature BEFORE any other processing
- [ ] Responds 200 immediately after enqueuing (never awaits job)
- [ ] Handles `pull_request` event: actions `opened`, `synchronize`, `reopened`
- [ ] Handles `installation.deleted`: marks installation `isActive = false`
- [ ] Handles `installation_repositories.removed`: deactivates affected repos
- [ ] Ignores all other event types gracefully (200, `"Event ignored"`)
- [ ] Skips enqueue if repo is inactive or installation plan is at limit

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| Signature missing | 401 `"Missing signature"` | |
| Signature invalid | 401 `"Invalid signature"` | |
| Repo is inactive | 200 `"Repo not active"` (no job enqueued) | |
| Installation is inactive | 200 `"Installation not active"` (no job enqueued) | |
| PR is a draft and config.reviewOnDraft = false | 200 `"Draft PR skipped"` | |
| Installation over plan limit | 200 `"Plan limit reached"` (no job enqueued) | |
| BullMQ unreachable | 503 (only edge case where webhook returns non-200) | |
| Duplicate delivery (X-GitHub-Delivery repeated) | Idempotency key on queue prevents duplicate job | |

**Implementation pseudocode:**
```
handleWebhook(req, res):
  // STEP 1: Verify signature (before reading body)
  sig = req.headers['x-hub-signature-256']
  if !sig → return res.status(401).json(fail("Missing signature"))
  expected = 'sha256=' + hmac(WEBHOOK_SECRET, req.rawBody)
  if !timingSafeEqual(sig, expected) → return res.status(401).json(fail("Invalid signature"))

  // STEP 2: Parse event type
  event = req.headers['x-github-event']
  body = req.body
  deliveryId = req.headers['x-github-delivery']

  // STEP 3: Route by event type
  if event === 'pull_request':
    if !['opened','synchronize','reopened'].includes(body.action)
      → return res.status(200).json(ok(null, "Action ignored"))
    installation = installationRepo.findByGithubId(body.installation.id)
    if !installation?.isActive → return res.status(200).json(ok(null, "Installation not active"))
    repo = repoRepo.findByGithubId(body.repository.id)
    if !repo?.isActive → return res.status(200).json(ok(null, "Repo not active"))
    if body.pull_request.draft && !repo.config.reviewOnDraft
      → return res.status(200).json(ok(null, "Draft PR skipped"))
    if isOverPlanLimit(installation) → return res.status(200).json(ok(null, "Plan limit reached"))
    await reviewQueue.add('review-pr', {
      installationId: installation.id,
      repoId: repo.id,
      prNumber: body.pull_request.number,
      prTitle: body.pull_request.title,
      prAuthor: body.pull_request.user.login,
      headSha: body.pull_request.head.sha,
      repoFullName: body.repository.full_name,
    }, { jobId: deliveryId })   // deliveryId as idempotency key

  else if event === 'installation' && body.action === 'deleted':
    installationRepo.updateByGithubId(body.installation.id, { isActive: false })

  else if event === 'installation_repositories' && body.action === 'removed':
    for repo in body.repositories_removed:
      repoRepo.deactivateByGithubId(repo.id)

  // Always respond 200 (unless signature failed)
  return res.status(200).json(ok(null, "OK"))
```

**Unit test cases:**
```typescript
describe('WebhookController.handleWebhook', () => {
  it('returns 401 when X-Hub-Signature-256 header is missing')
  it('returns 401 when signature does not match')
  it('returns 200 and enqueues job for pull_request.opened')
  it('returns 200 and enqueues job for pull_request.synchronize')
  it('returns 200 and enqueues job for pull_request.reopened')
  it('returns 200 without enqueue for pull_request.closed')
  it('returns 200 without enqueue when installation is inactive')
  it('returns 200 without enqueue when repo is inactive')
  it('returns 200 without enqueue when PR is draft and reviewOnDraft=false')
  it('returns 200 without enqueue when installation is over plan limit')
  it('uses X-GitHub-Delivery as BullMQ job idempotency key')
  it('marks installation inactive on installation.deleted event')
  it('deactivates repos on installation_repositories.removed event')
  it('returns 200 for unhandled event types (graceful ignore)')
  it('uses timingSafeEqual to prevent timing attacks on signature comparison')
})
```

---

## Octokit factory (`lib/octokit.ts`)

```typescript
// App-level client (for installation metadata)
export const appOctokit = new Octokit({
  authStrategy: createAppAuth,
  auth: {
    appId: process.env.GITHUB_APP_ID,
    privateKey: Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY!, 'base64').toString('utf-8'),
  },
});

// Installation-level client (for PR data, posting comments)
export const getInstallationOctokit = async (githubInstallationId: number) => {
  return new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: process.env.GITHUB_APP_ID,
      privateKey: Buffer.from(process.env.GITHUB_APP_PRIVATE_KEY!, 'base64').toString('utf-8'),
      installationId: githubInstallationId,
    },
  });
};
```

**Edge cases for Octokit factory:**
| Case | Expected behaviour |
|------|-------------------|
| Installation token expired (1hr) | Octokit handles refresh automatically via `createAppAuth` |
| Private key malformed (bad base64) | Startup check in `server.ts` — fail fast |
| Rate limit hit (5000 req/hr) | Retry with exponential backoff in `review.job.ts` |

---

## Implementation notes (discovered during Step 3)

- **Octokit version pinned to v19 / auth-app v6.** `@octokit/rest@20+` and `@octokit/auth-app@7+`
  are pure ESM and this repo builds CommonJS (Node16 module resolution, no `"type": "module"`).
  Importing them threw `TS1479` at typecheck. Pinned to the last CJS-compatible majors
  (`@octokit/rest@^19.0.13`, `@octokit/auth-app@^6.1.4`) instead of converting the whole API to
  ESM. Revisit if a future step needs an ESM-only Octokit feature.
- **`reviewQueue` (BullMQ producer) built now, not in Step 5.** The webhook pseudocode above
  enqueues into `review-queue` synchronously, so `src/jobs/queue.ts` (Queue producer only, no
  worker) shipped as part of Step 3 instead of waiting for Step 5. Step 5 adds `worker.ts` +
  `review.job.ts` alongside it; nothing here changes when that lands.
- **`isOverPlanLimit` (webhook pull_request handling)** — not detailed in the pseudocode above.
  Implemented as: non-FREE tiers always pass; FREE tier counts `Review` rows created since the
  start of the current calendar month across all repos under the installation, capped at the
  50 reviews/mo limit from `knowledge/domains/billing.md`. The `Review` table already exists in
  `packages/db/prisma/schema.prisma` even though the review pipeline itself (Step 5) hasn't
  shipped, so this counts real rows rather than a placeholder.
- **Repo sync (resolved in Step 4).** `Repo` rows are created/kept in sync from GitHub at two
  points, both funneling through `IRepoLookupRepository.upsertFromGithub` (upsert keyed on
  `githubRepoId`, never moves a repo to a different `installationId` on conflict):
  1. **`POST /github/install`** (`github.service.ts`) — right after the `Installation` upsert,
     `GithubService.syncRepos` calls the new `IGithubApiClient.listInstallationRepos` (Octokit
     `apps.listReposAccessibleToInstallation`, single page of up to 100 repos — no pagination
     loop yet, revisit if an installation with 100+ repos shows up) and upserts a `Repo` row per
     result, `isActive` defaulting to `false` per the Prisma schema. This is **best-effort**: a
     GitHub API failure here is caught and swallowed (returns a synced count of 0) rather than
     failing the install response, since the `Installation` row is already durably saved by that
     point.
  2. **`installation_repositories.added` webhook** (`webhook.service.ts`) — mirrors the existing
     `.removed` handler, for repos added to an installation later without a full reinstall. Looks
     up the local `Installation` by `githubInstallationId` first (webhook payloads only carry the
     GitHub ID); if unknown (e.g. the webhook races ahead of `/install` completing), no-ops and
     returns `"Installation unknown"` — the eventual `/install` call's own sync picks the repo up.
     Webhook payloads for this event don't include `language`, so it's stored as `null` here (the
     next `/install`-time sync, or a future repo-details refresh, backfills it).

  `pull_request` webhooks for a repo neither of these has ever seen still resolve to
  `"Repo not active"` (repo row genuinely doesn't exist) — this is expected, not a gap.
- **`installation.middleware.ts` exists but isn't mounted on this module's own routes.**
  `DELETE /github/installations/:installationId`'s ownership check (404 unknown / 403 wrong
  owner) is done inline in `GithubService.deleteInstallation`, matching the unit tests listed
  above exactly. The middleware is generic tenant-isolation infrastructure for Step 4 (Repos) and
  Step 5 (Reviews), which scope every query by `installationId` — see `memory/pitfalls.md` #005.
- **GitHub token encryption at rest** (security backlog item) implemented in `lib/crypto.ts`:
  AES-256-GCM, keyed by a new `ENCRYPTION_KEY` env var (32-byte, hex-encoded). Applied to
  `User.githubAccessToken` before it's ever written to the DB in the OAuth callback flow.
- **User-to-server OAuth is a second, separate GitHub App credential pair.** `GITHUB_CLIENT_ID` /
  `GITHUB_CLIENT_SECRET` (for `GET /github/oauth/url` and `/oauth/callback`, identity linking —
  spec lives in `knowledge/domains/auth.md`) are distinct from `GITHUB_APP_ID` /
  `GITHUB_APP_PRIVATE_KEY` (installation-token auth for repo/PR access, this file). Both pairs
  belong to the same GitHub App registration but are never interchangeable.
