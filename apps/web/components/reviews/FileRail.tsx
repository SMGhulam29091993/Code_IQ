import { type FC } from "react";
import type { ReviewIssue } from "@codeiq/types";
import { cn } from "@/lib/utils";

export interface FileGroup {
  file: string;
  issues: ReviewIssue[];
}

interface FileRailProps {
  groups: FileGroup[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

const SEVERITY_RANK = { critical: 0, warning: 1, info: 2 };
const SEVERITY_COLOR = { critical: "bg-red", warning: "bg-yellow", info: "bg-blue" };

function worstSeverity(issues: ReviewIssue[]) {
  return issues.reduce<ReviewIssue["severity"]>(
    (worst, i) => (SEVERITY_RANK[i.severity] < SEVERITY_RANK[worst] ? i.severity : worst),
    "info"
  );
}

// .ai/knowledge/screens/dashboard-screens.md "Screen: Review Detail" — the Split layout's
// left-column file list; one row per distinct file with issues, worst-severity tick + count.
export const FileRail: FC<FileRailProps> = ({ groups, activeIndex, onSelect }) => (
  <div className="overflow-hidden rounded-card border border-border bg-surface">
    <div className="border-b border-border px-4 py-3 font-mono text-[10.5px] uppercase tracking-wide text-text3">
      Files with issues
    </div>
    {groups.map((group, idx) => {
      const parts = group.file.split("/");
      const short = parts[parts.length - 1];
      const dir = parts.slice(0, -1).join("/");
      const active = idx === activeIndex;
      const worst = worstSeverity(group.issues);
      return (
        <button
          key={group.file}
          type="button"
          onClick={() => onSelect(idx)}
          className={cn(
            "flex w-full items-center gap-3 border-b border-white/5 px-4 py-2.5 text-left last:border-b-0",
            active ? "bg-surface2" : "bg-transparent hover:bg-surface2/50"
          )}
        >
          <span className={cn("h-6 w-[3px] flex-none rounded-sm", SEVERITY_COLOR[worst])} />
          <div className="min-w-0 flex-1">
            <div
              className={cn(
                "truncate font-mono text-xs",
                active ? "text-text" : "text-text2"
              )}
            >
              {short}
            </div>
            {dir && <div className="truncate font-mono text-[10.5px] text-text3">{dir}</div>}
          </div>
          <span className="flex-none font-mono text-[11px] text-text2">{group.issues.length}</span>
        </button>
      );
    })}
  </div>
);
