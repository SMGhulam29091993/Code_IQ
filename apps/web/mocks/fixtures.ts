// Shared fixtures for MSW handlers and component tests. See
// .ai/workflows/frontend-testing.md "Mock fixtures".
export const mockUser = {
  id: "usr_1",
  email: "test@example.com",
  name: "Test User",
  githubId: null,
  githubLogin: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const mockInstallation = {
  id: "inst_1",
  githubInstallationId: 111,
  accountLogin: "acme-corp",
  accountType: "Organization",
  planTier: "TEAM",
  repoCount: 2,
};

export const mockRepoConfig = {
  severityThreshold: "WARNING" as const,
  enabledCategories: ["bug", "security", "performance", "logic"] as const,
  ignorePatterns: ["*.test.ts", "*.spec.ts", "dist/**"],
  reviewOnDraft: false,
  postSummaryComment: true,
};

export const mockRepo = {
  id: "repo_1",
  fullName: "acme/checkout-api",
  language: "TypeScript",
  isActive: true,
  reviewCount: 128,
  config: mockRepoConfig,
};

export const mockInactiveRepo = {
  id: "repo_2",
  fullName: "acme/web-dashboard",
  language: "TypeScript",
  isActive: false,
  reviewCount: 0,
  config: mockRepoConfig,
};

export const mockReviewSummary = {
  id: "rev_1",
  repoId: "repo_1",
  prNumber: 482,
  prTitle: "Add idempotency keys to webhook handler",
  prAuthor: "dparker",
  status: "DONE" as const,
  filesReviewed: 14,
  createdAt: "2026-01-01T00:00:00.000Z",
};

export const mockReviewIssue = {
  id: "iss_1",
  file: "src/modules/webhooks/webhook.controller.ts",
  line: 64,
  severity: "critical" as const,
  category: "security" as const,
  message: "The GitHub signature is compared with ===, which leaks timing information.",
  suggestion: "Compare with crypto.timingSafeEqual over equal-length buffers.",
};

export const mockReview = {
  ...mockReviewSummary,
  headSha: "4f9c2a1",
  summary: "Keying idempotency on the delivery id is the right move.",
  githubReviewId: 1,
  issues: [mockReviewIssue],
};

export const mockPlans = [
  { tier: "FREE", price: 0, repoLimit: 3, reviewLimit: 50, aiQueries: false, stripePriceId: null },
  { tier: "PRO", price: 15, repoLimit: null, reviewLimit: null, aiQueries: false, stripePriceId: "price_pro" },
  { tier: "TEAM", price: 12, repoLimit: null, reviewLimit: null, aiQueries: true, stripePriceId: "price_team" },
];

export const mockSubscription = {
  planTier: "TEAM" as const,
  seatCount: 8,
  nextInvoice: { date: "2026-09-01T00:00:00.000Z", amount: 228 },
  paymentMethod: { brand: "visa", last4: "4242" },
};

export const mockSeats = [
  { login: "dparker", role: "admin" as const, prsReviewed: 34 },
  { login: "sfarrow", role: "member" as const, prsReviewed: 0 },
];

export const mockInvoices = [
  { date: "2026-08-01T00:00:00.000Z", amount: 228, status: "paid", pdfUrl: "https://stripe.com/invoice/1" },
];
