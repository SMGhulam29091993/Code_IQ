import { type FC } from "react";
import { useRouter } from "next/navigation";
import type { ReviewSummary } from "@codeiq/types";
import { formatTimeAgo } from "@/lib/utils";
import { StatusBadge } from "./StatusBadge";

interface ReviewTableRowProps {
  review: ReviewSummary;
  repoName?: string;
}

// Mockup's dedicated Reviews List table — `64px 2.4fr 1.1fr .8fr .7fr` (PR/Title/Repository/
// Status/When), minus the mockup's "Issues" chip column: GET /reviews returns no per-review
// severity counts (see ReviewCard's note — same gap, this is the table variant of that row).
export const REVIEW_GRID_COLS = "64px 2.4fr 1.1fr .8fr .7fr";

export const ReviewTableHeader: FC = () => (
  <div
    className="grid items-center gap-4 border-b border-border bg-[#0D0D13] px-5 py-3 font-mono text-[10.5px] uppercase tracking-wide text-text3"
    style={{ gridTemplateColumns: REVIEW_GRID_COLS }}
  >
    <span>PR</span>
    <span>Title</span>
    <span>Repository</span>
    <span>Status</span>
    <span>When</span>
  </div>
);

export const ReviewTableRow: FC<ReviewTableRowProps> = ({ review, repoName }) => {
  const router = useRouter();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/reviews/${review.id}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/reviews/${review.id}`)}
      aria-label={`Review for PR #${review.prNumber}: ${review.prTitle}`}
      style={{ gridTemplateColumns: REVIEW_GRID_COLS }}
      className="grid cursor-pointer items-center gap-4 border-b border-white/5 px-5 py-3.5 last:border-b-0 hover:bg-surface2"
    >
      <span className="font-mono text-[13px] text-text2">#{review.prNumber}</span>
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-medium text-text">{review.prTitle}</div>
        <div className="mt-0.5 truncate font-mono text-[11px] text-text3">{review.prAuthor}</div>
      </div>
      <span className="truncate font-mono text-xs text-text2">{repoName ?? review.repoId}</span>
      <StatusBadge status={review.status} className="justify-self-start" />
      <span className="font-mono text-xs text-text3">{formatTimeAgo(review.createdAt)}</span>
    </div>
  );
};

export const ReviewTableRowSkeleton: FC = () => (
  <div className="h-14 animate-pulse border-b border-white/5 bg-surface last:border-b-0" />
);
