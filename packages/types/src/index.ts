// Shared between apps/api and apps/web. Backend responses and frontend consumers
// both type against these — see .ai/rules/frontend.md #1 and .ai/rules/coding-standards.md.

export interface ApiResponse<T = null> {
  success: boolean;
  message: string;
  data: T | null;
}

// Sanitized user shape returned by the API — never includes passwordHash.
export interface User {
  id: string;
  email: string;
  name: string;
  githubId: string | null;
  githubLogin: string | null;
  createdAt: string;
}

export interface AuthTokens {
  token: string;
  refreshToken: string;
}

// POST /auth/login and POST /auth/verify-otp response — matches apps/api/src/modules/auth/
// auth.types.ts AuthTokensResult.
export interface AuthTokensResult extends AuthTokens {
  user: User;
}

// POST /auth/register response — registration issues an OTP, not tokens (two-step flow, see
// .ai/knowledge/domains/auth.md). Matches apps/api/src/modules/auth/auth.types.ts
// RegisterResult.
export interface RegisterResult {
  identifier: string;
  user: User;
}

// GitHub App installation summary — matches
// apps/api/src/modules/github/github.types.ts SanitizedInstallation.
export interface Installation {
  id: string;
  githubInstallationId: number;
  accountLogin: string;
  accountType: string;
  planTier: string;
  repoCount: number;
}

// Matches apps/api/src/modules/repos/repo.types.ts SanitizedRepoConfig.
export interface RepoConfig {
  severityThreshold: "CRITICAL" | "WARNING" | "INFO";
  enabledCategories: Array<"bug" | "security" | "style" | "performance" | "logic">;
  ignorePatterns: string[];
  reviewOnDraft: boolean;
  postSummaryComment: boolean;
}

// Matches apps/api/src/modules/repos/repo.types.ts SanitizedRepo.
export interface Repo {
  id: string;
  fullName: string;
  language: string | null;
  isActive: boolean;
  reviewCount: number;
  config: RepoConfig;
}

// Matches apps/api/src/modules/repos/repo.types.ts RepoStatsResult.
export interface RepoStats {
  totalReviews: number;
  totalIssues: number;
  issuesBySeverity: { critical: number; warning: number; info: number };
  issuesByCategory: {
    bug: number;
    security: number;
    style: number;
    performance: number;
    logic: number;
  };
  recentTrend: Array<{ date: string; count: number }>;
}

export type ReviewStatus = "PENDING" | "RUNNING" | "DONE" | "FAILED";
export type IssueSeverity = "critical" | "warning" | "info";
export type IssueCategory = "bug" | "security" | "style" | "performance" | "logic";

// Matches apps/api/src/modules/reviews/review.types.ts SanitizedReviewIssue.
export interface ReviewIssue {
  id: string;
  file: string;
  line: number;
  severity: IssueSeverity;
  category: IssueCategory;
  message: string;
  suggestion: string;
}

// Matches apps/api/src/modules/reviews/review.types.ts SanitizedReviewSummary — the shape
// returned by GET /reviews (list). GET /reviews/:id adds the fields in `Review` below.
export interface ReviewSummary {
  id: string;
  repoId: string;
  prNumber: number;
  prTitle: string;
  prAuthor: string;
  status: ReviewStatus;
  filesReviewed: number;
  createdAt: string;
}

// Matches apps/api/src/modules/reviews/review.types.ts SanitizedReview.
export interface Review extends ReviewSummary {
  headSha: string;
  summary: string | null;
  githubReviewId: number | null;
  issues: ReviewIssue[];
}

export interface ReviewListResult {
  reviews: ReviewSummary[];
  total: number;
  page: number;
  totalPages: number;
}

// Matches apps/api/src/modules/reviews/review.types.ts ReviewStatsResult.
export interface ReviewStats {
  totalReviews: number;
  totalIssues: number;
  issuesBySeverity: { critical: number; warning: number; info: number };
  issuesByCategory: {
    bug: number;
    security: number;
    style: number;
    performance: number;
    logic: number;
  };
  recentTrend: Array<{ date: string; count: number }>;
}

export type PlanTier = "FREE" | "PRO" | "TEAM";

// Matches apps/api/src/modules/billing/billing.types.ts PlanInfo.
export interface PlanInfo {
  tier: PlanTier;
  price: number;
  repoLimit: number | null;
  reviewLimit: number | null;
  aiQueries: boolean;
  stripePriceId: string | null;
}

// Matches apps/api/src/modules/billing/billing.types.ts SubscriptionResult.
export interface Subscription {
  planTier: Exclude<PlanTier, "FREE">;
  seatCount: number;
  nextInvoice: { date: string; amount: number } | null;
  paymentMethod: { brand: string; last4: string } | null;
}

// Matches apps/api/src/modules/billing/billing.types.ts SeatsResult — role is GitHub's own
// two org roles, not a three-way owner/admin/member split (knowledge/domains/billing.md).
export interface BillingSeat {
  login: string;
  role: "admin" | "member";
  prsReviewed: number;
}

// Matches apps/api/src/modules/billing/billing.types.ts InvoicesResult.
export interface Invoice {
  date: string;
  amount: number;
  status: string;
  pdfUrl: string;
}
