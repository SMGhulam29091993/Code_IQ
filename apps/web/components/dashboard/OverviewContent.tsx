"use client";

import { type FC } from "react";
import { PageHeader } from "@/components/layout/PageHeader";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useAccountLogin } from "@/hooks/useInstallations";
import { useReviewStats } from "@/hooks/useReviews";
import { useRepos } from "@/hooks/useRepos";
import { IssuesByCategory } from "./IssuesByCategory";
import { RecentReviewsList } from "./RecentReviewsList";
import { RunningReviewsBanner } from "./RunningReviewsBanner";
import { SeatsCard } from "./SeatsCard";
import { StatsGrid, StatsGridSkeleton } from "./StatsGrid";

// .ai/knowledge/screens/dashboard-screens.md "Screen: Overview" — each section (stats, recent
// reviews, category breakdown, seats) loads and fails independently.
export const OverviewContent: FC = () => {
  const crumb = useAccountLogin();
  const { data: stats, isLoading: statsLoading, error: statsError, refetch: refetchStats } =
    useReviewStats();
  const { data: repos } = useRepos();
  const activeRepoCount = repos?.filter((r) => r.isActive).length ?? 0;

  return (
    <div>
      <PageHeader crumb={crumb ?? ""} title="Overview" />
      <RunningReviewsBanner />

      <div className="flex flex-col gap-4">
        {statsError && (
          <ErrorBanner message="Couldn't load review stats." onRetry={() => refetchStats()} />
        )}
        {!statsError && statsLoading && <StatsGridSkeleton />}
        {!statsError && stats && <StatsGrid stats={stats} activeRepoCount={activeRepoCount} />}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
          <RecentReviewsList />
          <div className="flex flex-col gap-4">
            {stats && <IssuesByCategory issuesByCategory={stats.issuesByCategory} />}
            <SeatsCard />
          </div>
        </div>
      </div>
    </div>
  );
};
