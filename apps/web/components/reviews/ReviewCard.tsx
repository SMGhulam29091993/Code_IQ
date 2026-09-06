import { type FC } from "react";
import { useRouter } from "next/navigation";
import type { ReviewSummary } from "@codeiq/types";
import { formatTimeAgo } from "@/lib/utils";
import { STATUS_DOT, StatusBadge } from "./StatusBadge";

interface ReviewCardProps {
  review: ReviewSummary;
  repoName?: string;
}

// Reused by Overview's RecentReviewsList, the Reviews List screen, and Repo Detail's Reviews
// tab (.ai/knowledge/technical/frontend/design-system.md "Custom components inventory").
// GET /reviews only returns SanitizedReviewSummary — no per-review severity counts — so, unlike
// the mockup's list rows, this shows status only (no crit/warn/info chips); those appear on the
// review detail page once the full issues array is fetched.
export const ReviewCard: FC<ReviewCardProps> = ({ review, repoName }) => {
  const router = useRouter();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/reviews/${review.id}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/reviews/${review.id}`)}
      aria-label={`Review for PR #${review.prNumber}: ${review.prTitle}`}
      className="flex cursor-pointer items-center gap-3 border-b border-white/5 px-4 py-3 last:border-b-0 hover:bg-surface2"
    >
      <span className={`h-1.5 w-1.5 flex-none rounded-full ${STATUS_DOT[review.status]}`} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{review.prTitle}</div>
        <div className="mt-0.5 font-mono text-[11px] text-text3">
          {repoName ?? review.repoId} · #{review.prNumber} · {review.prAuthor}
        </div>
      </div>
      <StatusBadge status={review.status} className="flex-none" />
      <span className="w-16 flex-none text-right font-mono text-[11px] text-text3">
        {formatTimeAgo(review.createdAt)}
      </span>
    </div>
  );
};

export const ReviewCardSkeleton: FC = () => (
  <div className="h-14 animate-pulse border-b border-white/5 bg-surface last:border-b-0" />
);
