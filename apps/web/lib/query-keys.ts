// Centralized query key factory — see .ai/knowledge/technical/frontend/state-conventions.md.
// Filter param types tighten to their real shape (e.g. ReviewFilters) as each domain
// module is built; using Record<string, unknown> here would be a lie about what's
// actually enforced, so callers pass the literal shape until packages/types grows one.
export const queryKeys = {
  installations: ["installations"] as const,
  repos: (installationId?: string) => ["repos", installationId] as const,
  repoConfig: (repoId: string) => ["repos", repoId, "config"] as const,
  repoStats: (repoId: string) => ["repos", repoId, "stats"] as const,
  reviews: (filters: Record<string, unknown>) => ["reviews", filters] as const,
  review: (reviewId: string) => ["reviews", reviewId] as const,
  reviewStats: (filters: Record<string, unknown>) => ["reviews", "stats", filters] as const,
  billing: ["billing"] as const,
};
