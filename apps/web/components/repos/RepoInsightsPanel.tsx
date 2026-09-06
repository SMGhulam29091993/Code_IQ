import { type FC } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useRepoStats } from "@/hooks/useRepos";

interface RepoInsightsPanelProps {
  repoId: string;
}

// .ai/knowledge/screens/dashboard-screens.md "Screen: Repo Detail" — Insights tab. Only ships
// the metric derivable from real data (issues per PR) plus the severity/category breakdown —
// see the doc's note on why the mockup's other two metrics (most-flagged path, fix rate) aren't
// built: no schema field backs either one yet.
export const RepoInsightsPanel: FC<RepoInsightsPanelProps> = ({ repoId }) => {
  const { data: stats, isLoading, error, refetch } = useRepoStats(repoId);

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <LoadingSkeleton key={i} className="h-28 w-full" />
        ))}
      </div>
    );
  }
  if (error || !stats) {
    return <ErrorBanner message="Couldn't load repo insights." onRetry={() => refetch()} />;
  }

  const issuesPerPr = stats.totalReviews > 0 ? (stats.totalIssues / stats.totalReviews).toFixed(1) : "0";

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <div className="rounded-card border border-border bg-surface p-5">
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-text3">
          Issues per PR
        </div>
        <div className="mt-3 font-display text-2xl font-semibold text-text">{issuesPerPr}</div>
        <div className="mt-2 text-xs leading-relaxed text-text2">
          average issues found across {stats.totalReviews} reviewed pull requests.
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface p-5">
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-text3">
          By severity
        </div>
        <div className="mt-3 font-display text-2xl font-semibold text-text">
          {stats.issuesBySeverity.critical}
        </div>
        <div className="mt-2 text-xs leading-relaxed text-text2">
          critical · {stats.issuesBySeverity.warning} warning · {stats.issuesBySeverity.info} info
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface p-5">
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-text3">
          By category
        </div>
        <div className="mt-3 font-display text-2xl font-semibold text-text">
          {stats.issuesByCategory.bug}
        </div>
        <div className="mt-2 text-xs leading-relaxed text-text2">bugs — the most common category</div>
      </div>
    </div>
  );
};
