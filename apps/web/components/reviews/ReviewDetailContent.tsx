"use client";

import { type FC, useEffect, useMemo, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import type { IssueSeverity } from "@codeiq/types";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useRepo } from "@/hooks/useRepos";
import { useRetryReview, useReview } from "@/hooks/useReviews";
import { cn, getApiErrorStatus, getErrorMessage } from "@/lib/utils";
import { type FileGroup, FileRail } from "./FileRail";
import { IssueCard } from "./IssueCard";
import { ProcessingState } from "./ProcessingState";
import { ReviewHeader } from "./ReviewHeader";

interface ReviewDetailContentProps {
  reviewId: string;
}

const SEVERITY_FILTERS: Array<"All" | IssueSeverity> = ["All", "critical", "warning", "info"];

// .ai/knowledge/screens/dashboard-screens.md "Screen: Review Detail" — Split layout only
// (file rail + issue panel); Stream is documented but not built this pass.
export const ReviewDetailContent: FC<ReviewDetailContentProps> = ({ reviewId }) => {
  const router = useRouter();
  const { data: review, isLoading, error } = useReview(reviewId);
  const { data: repo } = useRepo(review?.repoId ?? "");
  const retryMutation = useRetryReview();
  const [activeFile, setActiveFile] = useState(0);
  const [severityFilter, setSeverityFilter] = useState<"All" | IssueSeverity>("All");

  useEffect(() => {
    if (getApiErrorStatus(error) === 403) router.replace("/reviews");
  }, [error, router]);

  const fileGroups: FileGroup[] = useMemo(() => {
    if (!review) return [];
    const filtered =
      severityFilter === "All"
        ? review.issues
        : review.issues.filter((i) => i.severity === severityFilter);
    const order: string[] = [];
    const byFile = new Map<string, FileGroup>();
    for (const issue of filtered) {
      if (!byFile.has(issue.file)) {
        byFile.set(issue.file, { file: issue.file, issues: [] });
        order.push(issue.file);
      }
      byFile.get(issue.file)!.issues.push(issue);
    }
    return order.map((f) => byFile.get(f)!);
  }, [review, severityFilter]);

  if (getApiErrorStatus(error) === 404) notFound();
  if (error && getApiErrorStatus(error) !== 403) {
    return <ErrorBanner message="Couldn't load this review." />;
  }
  if (isLoading || !review) {
    return <LoadingSkeleton className="h-96 w-full" />;
  }

  const prUrl = repo ? `https://github.com/${repo.fullName}/pull/${review.prNumber}` : undefined;
  const crumb = `${repo?.fullName ?? review.repoId} · #${review.prNumber}`;
  const openPrAction = prUrl && (
    <a
      href={prUrl}
      target="_blank"
      rel="noreferrer"
      className="flex-none whitespace-nowrap rounded-button bg-accent px-4 py-2 text-[13px] font-bold text-bg hover:bg-accent/90"
    >
      Open pull request
    </a>
  );

  if (review.status === "PENDING" || review.status === "RUNNING") {
    return (
      <div>
        <PageHeader crumb={crumb} title="Review" action={openPrAction} />
        <div className="flex flex-col gap-4">
          <ReviewHeader review={review} repoFullName={repo?.fullName} />
          <ProcessingState review={review} />
        </div>
      </div>
    );
  }

  if (review.status === "FAILED") {
    return (
      <div>
        <PageHeader crumb={crumb} title="Review" action={openPrAction} />
        <div className="flex flex-col gap-4">
          <ReviewHeader review={review} repoFullName={repo?.fullName} />
          <div className="flex flex-col items-center gap-3 rounded-card border border-red/20 bg-red/5 py-12 text-center">
            <p className="text-sm text-text2">This review failed to complete.</p>
            <Button
              variant="secondary"
              disabled={retryMutation.isPending}
              onClick={() => retryMutation.mutate(reviewId)}
            >
              {retryMutation.isPending ? "Retrying..." : "Retry"}
            </Button>
            {retryMutation.isError && (
              <ErrorBanner message={getErrorMessage(retryMutation.error)} />
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader crumb={crumb} title="Review" action={openPrAction} />
      <div className="flex flex-col gap-4">
        <ReviewHeader review={review} repoFullName={repo?.fullName} />

        {review.issues.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-card border border-border bg-surface py-16 text-center">
            <span className="text-2xl">🎉</span>
            <p className="text-sm text-text2">No issues found. Great work!</p>
          </div>
        ) : (
          <>
            <div className="flex gap-2">
              {SEVERITY_FILTERS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setSeverityFilter(s);
                    setActiveFile(0);
                  }}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs font-medium capitalize",
                    severityFilter === s
                      ? "border-accent/35 bg-accent/10 text-accent"
                      : "border-border text-text2"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
              <FileRail groups={fileGroups} activeIndex={activeFile} onSelect={setActiveFile} />
              <div className="flex flex-col gap-4">
                {fileGroups[activeFile]?.issues.map((issue) => (
                  <IssueCard key={issue.id} issue={issue} prUrl={prUrl} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
