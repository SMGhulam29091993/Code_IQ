# Database Plan

## Schema (Prisma — packages/db/prisma/schema.prisma)

```prisma
model User {
  id               String          @id @default(cuid())
  email            String          @unique
  name             String
  passwordHash     String?
  status           UserStatus      @default(ACTIVE)  // LOCKED after 3 failed OTP attempts — knowledge/domains/auth.md
  githubId         String?         @unique
  githubLogin      String?
  githubAccessToken String?        // encrypted at rest
  lastLoginAt      DateTime?
  installations    Installation[]
  otp              Otp?
  createdAt        DateTime        @default(now())
  updatedAt        DateTime        @updatedAt
}

// Refresh tokens are Redis-backed, not a Postgres model — see decisions/006-redis-for-refresh-tokens.md
// and apps/api/src/modules/auth/refresh-token.repository.ts.

// One active OTP per user, upserted on each register/resend — knowledge/domains/auth.md "OTP Service"
model Otp {
  id               String   @id @default(cuid())
  userId           String   @unique
  user             User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  hashedIdentifier String   @unique
  hashedOtp        String
  expiresAt        DateTime
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt
}

enum UserStatus {
  ACTIVE
  LOCKED
}

model Installation {
  id                    String   @id @default(cuid())
  githubInstallationId  Int      @unique
  accountLogin          String
  accountType           String   // 'User' | 'Organization'
  userId                String
  user                  User     @relation(fields: [userId], references: [id])
  stripeCustomerId      String?
  stripeSubId           String?
  planTier              PlanTier @default(FREE)
  seatCount             Int      @default(0)
  isActive              Boolean  @default(true)
  repos                 Repo[]
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
}

model Repo {
  id               String       @id @default(cuid())
  githubRepoId     Int          @unique
  fullName         String
  language         String?
  installationId   String
  installation     Installation @relation(fields: [installationId], references: [id])
  isActive         Boolean      @default(false)
  config           RepoConfig?
  reviews          Review[]
  createdAt        DateTime     @default(now())
  updatedAt        DateTime     @updatedAt
}

model RepoConfig {
  id                   String   @id @default(cuid())
  repoId               String   @unique
  repo                 Repo     @relation(fields: [repoId], references: [id], onDelete: Cascade)
  severityThreshold    String   @default("WARNING")  // CRITICAL | WARNING | INFO
  enabledCategories    String[] @default(["bug","security","performance","logic"])
  ignorePatterns       String[] @default(["*.test.ts","*.spec.ts","dist/**"])
  reviewOnDraft        Boolean  @default(false)
  postSummaryComment   Boolean  @default(true)
  updatedAt            DateTime @updatedAt
}

model Review {
  id              String        @id @default(cuid())
  repoId          String
  repo            Repo          @relation(fields: [repoId], references: [id])
  prNumber        Int
  prTitle         String
  prAuthor        String
  headSha         String
  status          ReviewStatus  @default(PENDING)
  summary         String?
  filesReviewed   Int           @default(0)
  githubReviewId  Int?
  issues          ReviewIssue[]
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
}

model ReviewIssue {
  id          String   @id @default(cuid())
  reviewId    String
  review      Review   @relation(fields: [reviewId], references: [id], onDelete: Cascade)
  file        String
  line        Int
  severity    String   // critical | warning | info
  category    String   // bug | security | style | performance | logic
  message     String
  suggestion  String
  createdAt   DateTime @default(now())
}

model ProcessedStripeEvent {
  id          String   @id  // Stripe event.id
  processedAt DateTime @default(now())
}

enum ReviewStatus {
  PENDING
  RUNNING
  DONE
  FAILED
}

enum PlanTier {
  FREE
  PRO
  TEAM
}
```

## Indexes (add after baseline migration)
```sql
CREATE INDEX idx_review_repo_status ON "Review"("repoId", "status");
CREATE INDEX idx_review_issue_review ON "ReviewIssue"("reviewId");
CREATE INDEX idx_review_issue_severity ON "ReviewIssue"("severity");
CREATE INDEX idx_repo_installation ON "Repo"("installationId");
```

## Migrations
- [x] 001_init (`20260823095713_init`) — baseline schema above, applied 2026-08-23. Ran as one
  migration since `ProcessedStripeEvent` was already part of the schema by the time the first
  migration was ever created (billing module landed before this database was first migrated) —
  003 below is already covered, not a separate step.
- [ ] 002_indexes — indexes listed above (`idx_refresh_token_user` dropped from this list —
  see 004 below)
- ~~003_processed_stripe_events~~ — covered by 001_init, see above
- [x] 004_drop_refresh_token_table (`20260823105451_drop_refresh_token_table`) — refresh
  tokens moved to Redis, applied 2026-08-23. See `decisions/006-redis-for-refresh-tokens.md`.

## Prisma version
`packages/db` runs Prisma 7 (`prisma`/`@prisma/adapter-pg`/`@prisma/client-runtime-utils`
`^7.9.1`) via the `pg` driver adapter, not the classic Rust-engine client — schema.prisma's
`datasource` block has no `url` (removed in Prisma 7; see `.ai/memory/pitfalls.md` #013),
connection config lives in `packages/db/prisma.config.ts` (CLI) and
`packages/db/src/index.ts` (runtime, via `PrismaPg`). Generated client output is pinned to
`packages/db/generated/client` (`generator client { output = ... }`) instead of the default
hashed `node_modules/.pnpm/...` path, so Docker builds can copy it between stages by a stable
path.
