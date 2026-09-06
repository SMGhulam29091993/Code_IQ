"use client";

import { type FC } from "react";
import { ReviewCard, ReviewCardSkeleton } from "@/components/reviews/ReviewCard";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useReviews } from "@/hooks/useReviews";

interface RepoReviewsPanelProps {
  repoId: string;
}

// .ai/knowledge/screens/dashboard-screens.md "Screen: Repo Detail" — Reviews tab, reuses
// ReviewCard rather than duplicating row rendering (same component as the Reviews List screen).
export const RepoReviewsPanel: FC<RepoReviewsPanelProps> = ({ repoId }) => {
  const { data, isLoading, error, refetch } = useReviews({ repoId, limit: 20, page: 1 });

  if (error) {
    return <ErrorBanner message="Couldn't load reviews for this repo." onRetry={() => refetch()} />;
  }

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      {isLoading && [1, 2, 3, 4].map((i) => <ReviewCardSkeleton key={i} />)}

      {!isLoading && data?.reviews.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center text-text3">
          <p className="text-sm font-medium text-text2">No reviews for this repo</p>
          <p className="mt-1 max-w-sm text-xs">
            This repository is connected but hasn&apos;t seen a pull request since it was added.
          </p>
        </div>
      )}

      {!isLoading && data?.reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
    </div>
  );
};
