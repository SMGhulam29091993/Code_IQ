import { type FC } from "react";
import type { Review } from "@codeiq/types";
import { StatusBadge } from "./StatusBadge";

interface ReviewHeaderProps {
  review: Review;
  repoFullName?: string;
}

// .ai/knowledge/screens/dashboard-screens.md "Screen: Review Detail". No Duration stat here —
// SanitizedReview has no completedAt/duration field, unlike the mockup's 4th meta stat.
export const ReviewHeader: FC<ReviewHeaderProps> = ({ review, repoFullName }) => {
  const criticalCount = review.issues.filter((i) => i.severity === "critical").length;

  return (
    <div className="flex flex-wrap items-start gap-6 rounded-card border border-border bg-surface p-5">
      <div className="min-w-[300px] flex-1">
        <div className="flex items-center gap-2 font-mono text-xs text-text3">
          <span>{repoFullName ?? review.repoId}</span>
          <span>·</span>
          <span>#{review.prNumber}</span>
          <span>·</span>
          <span>{review.headSha.slice(0, 7)}</span>
          <span>·</span>
          <span>{review.prAuthor}</span>
          <StatusBadge status={review.status} className="ml-2" />
        </div>
        <h1 className="mt-2 font-display text-lg font-semibold text-text">{review.prTitle}</h1>
        {review.summary && (
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text2">{review.summary}</p>
        )}
      </div>
      <div className="flex gap-6">
        <Stat label="Files" value={review.filesReviewed} />
        <Stat label="Issues" value={review.issues.length} />
        <Stat label="Critical" value={criticalCount} accent={criticalCount > 0} />
      </div>
    </div>
  );
};

const Stat: FC<{ label: string; value: number; accent?: boolean }> = ({ label, value, accent }) => (
  <div>
    <div className="font-mono text-[10.5px] uppercase tracking-wide text-text3">{label}</div>
    <div className={`mt-2 font-display text-xl font-semibold ${accent ? "text-red" : "text-text"}`}>
      {value}
    </div>
  </div>
);
