import { type FC } from "react";
import type { ReviewStats } from "@codeiq/types";
import { cn } from "@/lib/utils";

interface StatsGridProps {
  stats: ReviewStats;
  activeRepoCount: number;
}

interface StatCardProps {
  label: string;
  value: number;
  accent?: "red";
}

const StatCard: FC<StatCardProps> = ({ label, value, accent }) => (
  <div className="rounded-card border border-border bg-surface p-4">
    <div className="font-mono text-[10.5px] uppercase tracking-wide text-text3">{label}</div>
    <div
      className={cn(
        "mt-3 font-display text-3xl font-semibold tracking-tight",
        accent === "red" ? "text-red" : "text-text"
      )}
    >
      {value}
    </div>
  </div>
);

// .ai/knowledge/screens/dashboard-screens.md "Screen: Overview" — 4 cards backed by real
// GET /reviews/stats fields (no delta badge — see the mockup note there for why).
export const StatsGrid: FC<StatsGridProps> = ({ stats, activeRepoCount }) => (
  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
    <StatCard label="Total Reviews" value={stats.totalReviews} />
    <StatCard label="Issues Found" value={stats.totalIssues} />
    <StatCard label="Critical Issues" value={stats.issuesBySeverity.critical} accent="red" />
    <StatCard label="Active Repos" value={activeRepoCount} />
  </div>
);

export const StatsGridSkeleton: FC = () => (
  <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
    {[1, 2, 3, 4].map((i) => (
      <div key={i} className="h-24 animate-pulse rounded-card bg-surface3" />
    ))}
  </div>
);
