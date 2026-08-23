"use client";

import { type FC } from "react";
import { useRouter } from "next/navigation";
import type { Repo } from "@codeiq/types";
import { cn, formatTimeAgo } from "@/lib/utils";

interface RepoCardProps {
  repo: Repo;
  onToggle: () => void;
  isToggling: boolean;
  overFreeLimit: boolean;
}

// Column widths match the mockup's `2.2fr .9fr .7fr 1fr .8fr 30px` repo table exactly, minus
// the "Open issues" column — GET /repos returns reviewCount only, no per-repo severity
// breakdown, so that column has no real data to show (documented gap, same stance as the
// Reviews list's missing per-row issue chips).
export const REPO_GRID_COLS = "2.2fr .9fr 1fr .8fr 30px";

export const RepoTableHeader: FC = () => (
  <div
    className="grid items-center gap-4 border-b border-border bg-[#0D0D13] px-5 py-3 font-mono text-[10.5px] uppercase tracking-wide text-text3"
    style={{ gridTemplateColumns: REPO_GRID_COLS }}
  >
    <span>Repository</span>
    <span>Language</span>
    <span>Reviews</span>
    <span>Last review</span>
    <span />
  </div>
);

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
      style={{ gridTemplateColumns: REPO_GRID_COLS }}
      className="grid cursor-pointer items-center gap-4 border-b border-white/5 px-5 py-3.5 last:border-b-0 hover:bg-surface2"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <span
          className={cn("h-2 w-2 flex-none rounded-sm", repo.isActive ? "bg-accent" : "bg-text3")}
        />
        <span className="truncate font-mono text-[13.5px] text-text">{repo.fullName}</span>
      </div>
      <span className="text-[13px] text-text2">{repo.language ?? "—"}</span>
      <span className="font-mono text-[13px] text-[#C9C9D6]">{repo.reviewCount}</span>
      <span className="font-mono text-xs text-text3">
        {repo.lastReviewAt ? formatTimeAgo(repo.lastReviewAt) : "never"}
      </span>
      {showUpgradeInstead ? (
        <span className="justify-self-end text-[11px] font-medium text-yellow">Upgrade</span>
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
            "flex h-6 w-10 flex-none items-center justify-self-end rounded-full border p-0.5 transition-colors disabled:opacity-50",
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
  <div className="h-14 animate-pulse border-b border-white/5 bg-surface last:border-b-0" />
);
