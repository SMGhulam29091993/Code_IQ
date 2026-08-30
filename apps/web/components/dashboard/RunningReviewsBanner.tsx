"use client";

import { type FC } from "react";
import { useRepos } from "@/hooks/useRepos";
import { useReviews } from "@/hooks/useReviews";

// .ai/knowledge/screens/dashboard-screens.md "Screen: Overview" — mockup's isProgress banner,
// backed by a real GET /reviews?status=RUNNING query rather than mock state.
export const RunningReviewsBanner: FC = () => {
  const { data } = useReviews({ status: "RUNNING", limit: 5 });
  const { data: repos } = useRepos();
  const running = data?.reviews ?? [];

  if (running.length === 0) return null;

  const refs = running
    .map((r) => `${repos?.find((repo) => repo.id === r.repoId)?.fullName ?? r.repoId} #${r.prNumber}`)
    .join(" · ");

  return (
    <div className="mb-4 flex items-center gap-3.5 rounded-card border border-accent/25 bg-accent/[0.07] px-4 py-3">
      <span className="h-3.5 w-3.5 flex-none animate-spin rounded-full border-2 border-accent/25 border-t-accent" />
      <span className="text-sm font-medium text-accent">
        {data?.total} review{data?.total === 1 ? "" : "s"} running
      </span>
      <span className="font-mono text-xs text-text2">{refs}</span>
    </div>
  );
};
