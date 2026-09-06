import { type FC } from "react";
import type { Repo } from "@codeiq/types";
import { cn } from "@/lib/utils";

interface ReviewFiltersBarProps {
  status: string;
  repoId: string;
  repos: Repo[] | undefined;
  resultLabel: string;
  onStatusChange: (status: string) => void;
  onRepoChange: (repoId: string) => void;
}

const STATUSES = ["All", "PENDING", "RUNNING", "DONE", "FAILED"];

// .ai/knowledge/screens/dashboard-screens.md "Screen: Reviews List" — status + repo chip
// filters, both reflected in the URL by the owning ReviewsList component.
export const ReviewFiltersBar: FC<ReviewFiltersBarProps> = ({
  status,
  repoId,
  repos,
  resultLabel,
  onStatusChange,
  onRepoChange,
}) => (
  <div className="flex flex-wrap items-center gap-6 rounded-card border border-border bg-surface p-4">
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-wide text-text3">Status</span>
      <div className="flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onStatusChange(s)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-xs font-medium",
              status === s
                ? "border-accent/35 bg-accent/10 text-accent"
                : "border-border bg-transparent text-text2"
            )}
          >
            {s}
          </button>
        ))}
      </div>
    </div>
    <div className="flex items-center gap-2">
      <span className="font-mono text-[10.5px] uppercase tracking-wide text-text3">Repo</span>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          onClick={() => onRepoChange("All")}
          className={cn(
            "rounded-full border px-2.5 py-1 text-xs font-medium",
            repoId === "All"
              ? "border-accent/35 bg-accent/10 text-accent"
              : "border-border bg-transparent text-text2"
          )}
        >
          All
        </button>
        {repos?.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => onRepoChange(r.id)}
            className={cn(
              "rounded-full border px-2.5 py-1 font-mono text-xs font-medium",
              repoId === r.id
                ? "border-accent/35 bg-accent/10 text-accent"
                : "border-border bg-transparent text-text2"
            )}
          >
            {r.fullName}
          </button>
        ))}
      </div>
    </div>
    <span className="ml-auto font-mono text-xs text-text3">{resultLabel}</span>
  </div>
);
