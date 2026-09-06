import { type FC } from "react";
import type { Review } from "@codeiq/types";

interface ProcessingStateProps {
  review: Review;
}

// .ai/knowledge/screens/dashboard-screens.md "Screen: Review Detail" — shown while
// PENDING/RUNNING. No per-file progress counter — SanitizedReview only exposes filesReviewed
// once the pipeline updates it, not a live "file N of M" position, so this stays a generic
// in-progress indicator rather than fabricating step detail the API can't back.
export const ProcessingState: FC<ProcessingStateProps> = ({ review }) => (
  <div className="rounded-card border border-accent/25 bg-accent/5 p-5">
    <div className="flex flex-wrap items-center gap-3">
      <span className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
      <span className="text-sm font-medium text-accent">
        {review.status === "PENDING" ? "Queued for review" : "Reviewing pull request"}
      </span>
      <span className="font-mono text-xs text-text2">
        #{review.prNumber} · {review.prAuthor}
      </span>
    </div>
  </div>
);
