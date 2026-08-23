"use client";

import { type FC } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useRepos } from "@/hooks/useRepos";
import { useRetryReview, useReviews } from "@/hooks/useReviews";
import { getErrorMessage } from "@/lib/utils";
import { Pagination } from "./Pagination";
import { ReviewCard, ReviewCardSkeleton } from "./ReviewCard";
import { ReviewFiltersBar } from "./ReviewFiltersBar";

const LIMIT = 20;

// .ai/knowledge/screens/dashboard-screens.md "Screen: Reviews List" — filters + pagination
// reflected in the URL (?status=&repoId=&page=), read from the URL on mount for shareable links.
export const ReviewsList: FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = searchParams.get("status") ?? "All";
  const repoId = searchParams.get("repoId") ?? "All";
  const page = Number(searchParams.get("page") ?? "1");

  const { data: repos } = useRepos();
  const { data, isLoading, error, refetch } = useReviews({
    status: status === "All" ? undefined : status,
    repoId: repoId === "All" ? undefined : repoId,
    page,
    limit: LIMIT,
  });
  const retryMutation = useRetryReview();

  function updateFilter(patch: { status?: string; repoId?: string; page?: number }) {
    const params = new URLSearchParams(searchParams);
    if (patch.status !== undefined) {
      if (patch.status === "All") params.delete("status");
      else params.set("status", patch.status);
    }
    if (patch.repoId !== undefined) {
      if (patch.repoId === "All") params.delete("repoId");
      else params.set("repoId", patch.repoId);
    }
    if (patch.page !== undefined) params.set("page", String(patch.page));
    else params.set("page", "1"); // reset page on filter change
    router.push(`/reviews?${params.toString()}`);
  }

  if (error) {
    return <ErrorBanner message="Couldn't load reviews." onRetry={() => refetch()} />;
  }

  const repoName = (id: string) => repos?.find((r) => r.id === id)?.fullName;
  const resultLabel = data ? `${data.reviews.length} of ${data.total} reviews` : "";

  return (
    <div className="flex flex-col gap-4">
      <ReviewFiltersBar
        status={status}
        repoId={repoId}
        repos={repos}
        resultLabel={resultLabel}
        onStatusChange={(s) => updateFilter({ status: s })}
        onRepoChange={(r) => updateFilter({ repoId: r })}
      />

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {isLoading && [1, 2, 3, 4, 5, 6].map((i) => <ReviewCardSkeleton key={i} />)}

        {!isLoading && data?.reviews.length === 0 && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-text3">
            <p className="text-sm">No review matches this combination of repository and status.</p>
            <Button variant="secondary" size="sm" onClick={() => router.push("/reviews")}>
              Clear filters
            </Button>
          </div>
        )}

        {!isLoading &&
          data?.reviews.map((review) => (
            <div key={review.id} className="flex items-center">
              <div className="flex-1">
                <ReviewCard review={review} repoName={repoName(review.repoId)} />
              </div>
              {review.status === "FAILED" && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="mr-4 flex-none"
                  disabled={retryMutation.isPending}
                  onClick={() => retryMutation.mutate(review.id)}
                >
                  Retry
                </Button>
              )}
            </div>
          ))}
      </div>

      {retryMutation.isError && <ErrorBanner message={getErrorMessage(retryMutation.error)} />}

      {data && (
        <Pagination
          page={data.page}
          totalPages={data.totalPages}
          onChange={(p) => updateFilter({ page: p })}
        />
      )}
    </div>
  );
};
