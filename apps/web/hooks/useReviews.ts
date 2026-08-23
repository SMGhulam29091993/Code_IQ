import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Review, ReviewListResult, ReviewStats } from "@codeiq/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

export interface ReviewFilters {
  repoId?: string;
  status?: string;
  page?: number;
  limit?: number;
}

// .ai/knowledge/technical/frontend/hooks-and-utils.md "useReviews".
export const useReviews = (filters: ReviewFilters) =>
  useQuery({
    queryKey: queryKeys.reviews(filters),
    queryFn: () =>
      api
        .get<{ data: ReviewListResult }>("/reviews", { params: filters })
        .then((r) => r.data.data),
    placeholderData: (prev) => prev, // smooth pagination — Tanstack Query v5's keepPreviousData
  });

const POLL_STATUSES = new Set(["PENDING", "RUNNING"]);

// GET /reviews/:id wraps the review in a `review` key (unlike the /reviews list, which
// doesn't) — see apps/api/src/modules/reviews/review.types.ts GetReviewResult. Caught live via
// a real browser session against the real API, not by any test — every component test mocks
// this handler directly returning the correctly-shaped `{ review: {...} }` envelope, matching
// what the code assumed rather than what the backend actually returns.
export const useReview = (reviewId: string) =>
  useQuery({
    queryKey: queryKeys.review(reviewId),
    queryFn: () =>
      api.get<{ data: { review: Review } }>(`/reviews/${reviewId}`).then((r) => r.data.data.review),
    enabled: !!reviewId,
    refetchInterval: (query) => {
      const data = query.state.data;
      return !data || POLL_STATUSES.has(data.status) ? 5_000 : false;
    },
  });

export const useRetryReview = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reviewId: string) =>
      api
        .post<{ data: { review: Review } }>(`/reviews/${reviewId}/retry`)
        .then((r) => r.data.data.review),
    onSuccess: (_data, reviewId) => {
      qc.invalidateQueries({ queryKey: queryKeys.review(reviewId) });
      qc.invalidateQueries({ queryKey: ["reviews"] });
    },
  });
};

export const useReviewStats = () =>
  useQuery({
    queryKey: queryKeys.reviewStats({}),
    queryFn: () => api.get<{ data: ReviewStats }>("/reviews/stats").then((r) => r.data.data),
    refetchInterval: 60_000,
  });
