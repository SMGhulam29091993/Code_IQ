"use client";

import { type FC } from "react";
import { useRouter } from "next/navigation";
import type { Repo } from "@codeiq/types";
import { cn } from "@/lib/utils";

interface RepoCardProps {
  repo: Repo;
  onToggle: () => void;
  isToggling: boolean;
  overFreeLimit: boolean;
}

// .ai/knowledge/screens/dashboard-screens.md "Screen: Repos List" — single repo row with
// active/inactive toggle; clicking the row body (not the toggle) navigates to detail.
export const RepoCard: FC<RepoCardProps> = ({ repo, onToggle, isToggling, overFreeLimit }) => {
  const router = useRouter();
  const showUpgradeInstead = overFreeLimit && !repo.isActive;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => router.push(`/repos/${repo.id}`)}
      onKeyDown={(e) => e.key === "Enter" && router.push(`/repos/${repo.id}`)}
      aria-label={`Repository ${repo.fullName}`}
      className="flex cursor-pointer items-center gap-4 border-b border-white/5 px-4 py-3 last:border-b-0 hover:bg-surface2"
    >
      <span
        className={cn("h-2 w-2 flex-none rounded-sm", repo.isActive ? "bg-accent" : "bg-text3")}
      />
      <span className="flex-1 truncate font-mono text-sm text-text">{repo.fullName}</span>
      <span className="w-24 flex-none text-xs text-text2">{repo.language ?? "—"}</span>
      <span className="w-16 flex-none text-right font-mono text-xs text-text2">
        {repo.reviewCount}
      </span>
      {showUpgradeInstead ? (
        <span className="flex-none text-xs font-medium text-yellow">Upgrade to activate</span>
      ) : (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          disabled={isToggling}
          aria-pressed={repo.isActive}
          aria-label={repo.isActive ? "Deactivate" : "Activate"}
          className={cn(
            "flex h-6 w-10 flex-none items-center rounded-full border p-0.5 transition-colors disabled:opacity-50",
            repo.isActive ? "justify-end border-accent bg-accent/90" : "justify-start border-border2 bg-surface3"
          )}
        >
          <span className="h-4 w-4 rounded-full bg-bg" />
        </button>
      )}
    </div>
  );
};

export const RepoCardSkeleton: FC = () => (
  <div className="h-12 animate-pulse border-b border-white/5 bg-surface last:border-b-0" />
);
