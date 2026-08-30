// Centralized query key factory — see .ai/knowledge/technical/frontend/state-conventions.md.
// Filter param types tighten to their real shape (e.g. ReviewFilters) as each domain
// module is built; using Record<string, unknown> here would be a lie about what's
// actually enforced, so callers pass the literal shape until packages/types grows one.
export const queryKeys = {
  me: ["me"] as const,
  installations: ["installations"] as const,
  repos: (installationId?: string) => ["repos", installationId] as const,
  repo: (repoId: string) => ["repos", repoId] as const,
  repoConfig: (repoId: string) => ["repos", repoId, "config"] as const,
  repoStats: (repoId: string) => ["repos", repoId, "stats"] as const,
  reviews: <T extends object>(filters: T) => ["reviews", filters] as const,
  review: (reviewId: string) => ["reviews", reviewId] as const,
  reviewStats: <T extends object>(filters: T) => ["reviews", "stats", filters] as const,
  billing: ["billing"] as const,
  billingPlans: ["billing", "plans"] as const,
  billingSubscription: ["billing", "subscription"] as const,
  billingSeats: ["billing", "seats"] as const,
  billingInvoices: (limit?: number) => ["billing", "invoices", limit] as const,
};
