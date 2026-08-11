# Domain: Repos
> Covers repo listing, activation, deactivation, and per-repo config management.

## Bounded context
A `Repo` represents a GitHub repository connected via a GitHub App installation.
Repos are activated/deactivated to control whether reviews are triggered.
Per-repo config (`RepoConfig`) controls AI behaviour for that repo.

---

## API Routes

### GET /repos
**Purpose:** List all repos accessible via the current user's installations.
**Auth:** JWT

**Query params:**
```typescript
{ installationId?: string; isActive?: boolean }
```

**Acceptance criteria:**
- [ ] Returns repos from all of the user's installations
- [ ] Supports filtering by installationId and isActive
- [ ] Includes review count per repo
- [ ] Includes active config summary per repo

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| installationId belongs to another user | 403 | |
| User has no installations | `{ data: [] }` | |
| User has installations but all repos inactive | Returns inactive repos (not filtered unless `?isActive=true`) | |

**Unit test cases:**
```typescript
describe('RepoService.listRepos', () => {
  it('returns repos for all of current user\'s installations')
  it('filters by installationId when provided')
  it('filters by isActive when provided')
  it('throws ForbiddenError when installationId belongs to another user')
  it('returns empty array when user has no repos')
  it('includes review count per repo')
})
```

---

### POST /repos/:repoId/activate
**Purpose:** Enable AI reviews for a repo.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Verifies repo belongs to current user's installation
- [ ] Sets `isActive = true`
- [ ] Creates default `RepoConfig` if none exists
- [ ] Idempotent (already active → 200)

**Default RepoConfig values:**
```typescript
{
  severityThreshold: 'WARNING',
  enabledCategories: ['bug', 'security', 'performance', 'logic'],
  ignorePatterns: ['*.test.ts', '*.spec.ts', 'dist/**', 'node_modules/**'],
  reviewOnDraft: false,
  postSummaryComment: true,
}
```

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| repoId not found | 404 | |
| repoId belongs to another user | 403 | |
| Already active | 200 (idempotent) | |
| Plan limit reached (e.g. Free tier: 3 repos max) | 403 `"Plan limit: upgrade to activate more repos"` | |

**Unit test cases:**
```typescript
describe('RepoService.activateRepo', () => {
  it('sets isActive = true')
  it('creates default RepoConfig if none exists')
  it('does not overwrite existing RepoConfig on re-activation')
  it('returns 200 when already active (idempotent)')
  it('throws NotFoundError for unknown repoId')
  it('throws ForbiddenError when repo belongs to another user')
  it('throws ForbiddenError with plan limit message when Free tier exceeded')
})
```

---

### POST /repos/:repoId/deactivate
**Purpose:** Pause AI reviews for a repo.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Sets `isActive = false`
- [ ] Idempotent
- [ ] Does NOT delete RepoConfig (preserved for re-activation)

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| repoId not found | 404 | |
| repoId belongs to another user | 403 | |
| Already inactive | 200 (idempotent) | |

---

### GET /repos/:repoId/config
**Purpose:** Get the current per-repo review configuration.
**Auth:** JWT

**Acceptance criteria:**
- [ ] Returns `RepoConfig` for the repo
- [ ] Returns default config values if no config row exists

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| repoId not found | 404 | |
| repoId belongs to another user | 403 | |
| No RepoConfig row exists | Returns default config (not 404) | |

---

### PATCH /repos/:repoId/config
**Purpose:** Update per-repo review configuration.
**Auth:** JWT

**Request body:**
```typescript
{
  severityThreshold?: 'CRITICAL' | 'WARNING' | 'INFO';
  enabledCategories?: Array<'bug' | 'security' | 'style' | 'performance' | 'logic'>;
  ignorePatterns?: string[];
  reviewOnDraft?: boolean;
  postSummaryComment?: boolean;
}
```

**Acceptance criteria:**
- [ ] Partial update (PATCH semantics — only provided fields are updated)
- [ ] Validates `ignorePatterns` are valid glob strings
- [ ] Creates config row if none exists (upsert)
- [ ] Returns updated config

**Edge cases:**
| Case | Expected behaviour | Status |
|------|--------------------|-|
| repoId not found | 404 | |
| repoId belongs to another user | 403 | |
| `enabledCategories` is empty array | 400 `"At least one category must be enabled"` | |
| Invalid glob pattern in `ignorePatterns` | 400 `"Invalid glob pattern: <pattern>"` | |
| Body is empty `{}` | 200 (no-op PATCH) | |

**Unit test cases:**
```typescript
describe('RepoService.updateConfig', () => {
  it('partially updates only provided fields')
  it('creates RepoConfig row if none exists (upsert)')
  it('throws BadRequestError when enabledCategories is empty array')
  it('throws BadRequestError for invalid glob pattern in ignorePatterns')
  it('throws ForbiddenError when repo belongs to another user')
  it('returns no-op 200 for empty body')
  it('returns full updated config after partial update')
})
```

---

### GET /repos/:repoId/stats
**Purpose:** Per-repo aggregate review stats.
**Auth:** JWT

**Response:**
```typescript
{
  totalReviews: number;
  totalIssues: number;
  issuesBySeverity: { critical: number; warning: number; info: number };
  issuesByCategory: { bug: number; security: number; style: number; performance: number; logic: number };
  recentTrend: Array<{ date: string; count: number }>;  // last 30 days
}
```

---

## config.service.ts — effective config resolution

The effective config for a review is the DB config merged with `.codeiq.yml` from the repo root.
`.codeiq.yml` always wins (repo-level config overrides dashboard config).

```
getEffectiveConfig(repoId, octokit, owner, repo):
  dbConfig = repoConfigRepo.findByRepoId(repoId) ?? DEFAULT_CONFIG
  try:
    fileContent = await octokit.repos.getContent({ owner, repo, path: '.codeiq.yml' })
    yamlConfig = parseYaml(Buffer.from(fileContent.data.content, 'base64').toString())
    fileConfig = YamlConfigSchema.parse(yamlConfig)  // Zod validate
    return mergeConfigs(dbConfig, fileConfig)  // fileConfig wins on overlap
  catch (404):
    return dbConfig  // no .codeiq.yml — use DB config only
  catch (ZodError):
    log.warn('.codeiq.yml has invalid schema — using DB config')
    return dbConfig
```

**Unit test cases for config.service.ts:**
```typescript
describe('ConfigService.getEffectiveConfig', () => {
  it('returns DB config when no .codeiq.yml exists')
  it('merges .codeiq.yml over DB config when file exists')
  it('.codeiq.yml values win on conflict with DB config')
  it('returns DB config when .codeiq.yml has invalid schema (logs warning)')
  it('returns default config when no DB config and no .codeiq.yml')
})
```

---

## Implementation notes (discovered during Step 4)

- **`config.service.ts` isn't wired into any Step 4 route.** `GET`/`PATCH /repos/:repoId/config`
  read and write the raw `RepoConfig` DB row only (matching their documented acceptance
  criteria — no `.codeiq.yml` merge). `ConfigService.getEffectiveConfig` takes an installation
  `Octokit` + `owner`/`repo`, which only exist once a review is actually running — it's built
  now and unit-tested, but its first real caller is the review pipeline
  (`.ai/plans/backend.md` Step 5).
- **Default config: schema.prisma's column `@default` on `ignorePatterns` doesn't match this
  doc's default.** The Prisma column default is `["*.test.ts", "*.spec.ts", "dist/**"]` (missing
  `"node_modules/**"`). `repo-config.repository.ts`'s `createDefault`/`upsertPartial` never rely
  on that column default — every field is passed explicitly from `DEFAULT_REPO_CONFIG` in
  `repo.types.ts`, which does match this doc — so the drift is currently harmless but worth
  fixing in schema.prisma directly (a migration) before anything else ever inserts a
  `RepoConfig` row without going through this repository.
- **FREE tier repo limit is 3, enforced in `RepoService.activateRepo`.** Mirrors the FREE-tier
  review-count limit pattern from `github-app.md`'s `isOverPlanLimit` (Step 3): counts active
  `Repo` rows under the installation via `IRepoRepository.countActiveForInstallation`, only for
  `planTier === 'FREE'`, skipped entirely when the repo is already active (idempotent
  activation never re-triggers the limit check).
- **`GET /repos?installationId=` distinguishes 404 from 403.** Unknown `installationId` → 404
  `"Installation not found"`; known but owned by another user → 403 `"Forbidden"`. The
  documented edge case only mentions the 403 case; the 404 split follows the same convention
  already used by `installation.middleware.ts` (`.ai/knowledge/domains/github-app.md`).
- **`GET /repos/:repoId/stats` currently always returns zeros.** The route, auth, and
  ownership check are real; the actual `Review`/`ReviewIssue` aggregation queries are left for
  whoever wires up the review pipeline in Step 5, once there's real data to aggregate. No
  edge cases were documented for this endpoint in the spec above, so this is a placeholder
  return, not a bug.
