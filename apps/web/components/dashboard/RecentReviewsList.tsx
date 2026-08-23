"use client";

import { type FC } from "react";
import Link from "next/link";
import { ReviewCard, ReviewCardSkeleton } from "@/components/reviews/ReviewCard";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useReviews } from "@/hooks/useReviews";

// .ai/knowledge/screens/dashboard-screens.md "Screen: Overview" — last 5 reviews, own
// loading/error/empty state (each Overview section fails independently).
export const RecentReviewsList: FC = () => {
  const { data, isLoading, error, refetch } = useReviews({ limit: 5, page: 1 });

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="font-display text-sm font-semibold text-text">Recent reviews</span>
        <Link href="/reviews" className="text-xs font-medium text-accent hover:underline">
          View all
        </Link>
      </div>

      {error && (
        <div className="p-4">
          <ErrorBanner message="Couldn't load recent reviews." onRetry={() => refetch()} />
        </div>
      )}

      {!error && isLoading && (
        <div>
          {[1, 2, 3, 4, 5].map((i) => (
            <ReviewCardSkeleton key={i} />
          ))}
        </div>
      )}

      {!error && !isLoading && data?.reviews.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-center text-text3">
          <span className="mb-2 text-2xl">🔍</span>
          <p className="text-sm">No reviews yet. Connect a repo and open a PR.</p>
        </div>
      )}

      {!error &&
        !isLoading &&
        data?.reviews.map((review) => <ReviewCard key={review.id} review={review} />)}
    </div>
  );
};
