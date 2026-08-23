"use client";

import { type FC, useEffect } from "react";
import { notFound, useRouter, useSearchParams } from "next/navigation";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useRepo } from "@/hooks/useRepos";
import { cn, getApiErrorStatus } from "@/lib/utils";
import { RepoConfigPanel } from "./RepoConfigPanel";
import { RepoInsightsPanel } from "./RepoInsightsPanel";
import { RepoReviewsPanel } from "./RepoReviewsPanel";

interface RepoDetailTabsProps {
  repoId: string;
}

const TABS = [
  { id: "config", label: "Configuration" },
  { id: "reviews", label: "Reviews" },
  { id: "insights", label: "Insights" },
] as const;
type TabId = (typeof TABS)[number]["id"];

// .ai/knowledge/screens/dashboard-screens.md "Screen: Repo Detail" — one route, 3 tabs
// (replaces the old two-route Repo Detail / Repo Settings design).
export const RepoDetailTabs: FC<RepoDetailTabsProps> = ({ repoId }) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const activeTab: TabId = TABS.some((t) => t.id === tabParam) ? (tabParam as TabId) : "config";

  const { data: repo, isLoading, error } = useRepo(repoId);

  useEffect(() => {
    if (getApiErrorStatus(error) === 403) router.replace("/repos");
  }, [error, router]);

  if (getApiErrorStatus(error) === 404) notFound();
  if (error && getApiErrorStatus(error) !== 403) {
    return <ErrorBanner message="Couldn't load this repository." />;
  }
  if (isLoading || !repo) {
    return <LoadingSkeleton className="h-96 w-full" />;
  }

  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-wide text-text3">{repo.fullName}</p>
      <h1 className="mb-6 font-display text-2xl font-semibold text-text">
        Repository settings
      </h1>

      <div className="mb-6 flex gap-6 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => router.push(`/repos/${repoId}?tab=${tab.id}`)}
            className={cn(
              "border-b-2 pb-3 text-sm font-medium",
              activeTab === tab.id
                ? "border-accent text-text"
                : "border-transparent text-text2 hover:text-text"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "config" && <RepoConfigPanel repoId={repoId} />}
      {activeTab === "reviews" && <RepoReviewsPanel repoId={repoId} />}
      {activeTab === "insights" && <RepoInsightsPanel repoId={repoId} />}
    </div>
  );
};
