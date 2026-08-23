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

export const useReview = (reviewId: string) =>
  useQuery({
    queryKey: queryKeys.review(reviewId),
    queryFn: () => api.get<{ data: Review }>(`/reviews/${reviewId}`).then((r) => r.data.data),
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
      api.post<{ data: Review }>(`/reviews/${reviewId}/retry`).then((r) => r.data.data),
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
