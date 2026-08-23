"use client";

import { type FC, useState } from "react";
import { PlanLimitBanner } from "@/components/repos/PlanLimitBanner";
import { RepoCard, RepoCardSkeleton } from "@/components/repos/RepoCard";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { useInstallations } from "@/hooks/useInstallations";
import { useActivateRepo, useDeactivateRepo, useRepos } from "@/hooks/useRepos";
import { getApiErrorStatus } from "@/lib/utils";

const FREE_TIER_REPO_LIMIT = 3;

type Filter = "all" | "active" | "inactive";

// .ai/knowledge/screens/dashboard-screens.md "Screen: Repos List".
export const ReposList: FC = () => {
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [planLimitHit, setPlanLimitHit] = useState(false);

  const { data: repos, isLoading, error, refetch } = useRepos();
  const { data: installations } = useInstallations();
  const activateMutation = useActivateRepo();
  const deactivateMutation = useDeactivateRepo();

  const displayed = repos
    ?.filter((r) => (filter === "all" ? true : filter === "active" ? r.isActive : !r.isActive))
    .filter((r) => r.fullName.toLowerCase().includes(search.toLowerCase()));

  // Proactive hint only — POST /repos/:id/activate's 403 is still the source of truth (handled
  // in handleToggle below), this just avoids showing a toggle that's guaranteed to fail.
  const activeCount = repos?.filter((r) => r.isActive).length ?? 0;
  const overFreeLimit =
    installations?.[0]?.planTier === "FREE" && activeCount >= FREE_TIER_REPO_LIMIT;
  const overFreeLimitBool = !!overFreeLimit;

  function handleToggle(repoId: string, isActive: boolean) {
    setPlanLimitHit(false);
    if (isActive) {
      deactivateMutation.mutate(repoId);
      return;
    }
    activateMutation.mutate(repoId, {
      onError: (err) => {
        if (getApiErrorStatus(err) === 403) setPlanLimitHit(true);
      },
    });
  }

  if (error) {
    return <ErrorBanner message="Couldn't load repositories." onRetry={() => refetch()} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-button border border-border bg-surface p-1">
          {(["all", "active", "inactive"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={`rounded px-3 py-1 text-xs font-medium capitalize ${
                filter === f ? "bg-surface3 text-text" : "text-text3 hover:text-text2"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <Input
          placeholder="Search repositories..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs"
          aria-label="Search repositories"
        />
      </div>

      {planLimitHit && <PlanLimitBanner />}

      <div className="overflow-hidden rounded-card border border-border bg-surface">
        {isLoading && [1, 2, 3, 4].map((i) => <RepoCardSkeleton key={i} />)}

        {!isLoading && displayed?.length === 0 && repos && repos.length > 0 && (
          <div className="py-12 text-center text-sm text-text3">
            No repos matching your search
          </div>
        )}

        {!isLoading && repos?.length === 0 && (
          <div className="py-12 text-center text-sm text-text3">
            Connect GitHub to see your repos
          </div>
        )}

        {!isLoading &&
          displayed?.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              onToggle={() => handleToggle(repo.id, repo.isActive)}
              isToggling={
                (activateMutation.isPending && activateMutation.variables === repo.id) ||
                (deactivateMutation.isPending && deactivateMutation.variables === repo.id)
              }
              overFreeLimit={overFreeLimitBool}
            />
          ))}
      </div>
    </div>
  );
};
