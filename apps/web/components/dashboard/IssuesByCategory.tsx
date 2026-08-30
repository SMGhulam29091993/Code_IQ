import { type FC } from "react";
import type { ReviewStats } from "@codeiq/types";

interface IssuesByCategoryProps {
  issuesByCategory: ReviewStats["issuesByCategory"];
}

const CATEGORY_LABELS: Array<[keyof ReviewStats["issuesByCategory"], string]> = [
  ["bug", "bug"],
  ["security", "security"],
  ["performance", "performance"],
  ["logic", "logic"],
  ["style", "style"],
];

const CATEGORY_COLOR: Record<string, string> = {
  bug: "bg-red",
  security: "bg-yellow",
  performance: "bg-blue",
  logic: "bg-purple",
  style: "bg-text3",
};

// .ai/knowledge/screens/dashboard-screens.md "Screen: Overview" — category breakdown bars,
// from the real issuesByCategory field (GET /reviews/stats).
export const IssuesByCategory: FC<IssuesByCategoryProps> = ({ issuesByCategory }) => {
  const max = Math.max(1, ...Object.values(issuesByCategory));

  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <div className="mb-4 font-display text-sm font-semibold text-text">Issues by category</div>
      <div className="flex flex-col gap-3">
        {CATEGORY_LABELS.map(([key, label]) => {
          const count = issuesByCategory[key];
          const pct = Math.round((count / max) * 100);
          return (
            <div key={key}>
              <div className="mb-1.5 flex justify-between text-xs text-text2">
                <span>{label}</span>
                <span className="font-mono text-text">{count}</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-surface3">
                <div
                  className={`h-full rounded-full ${CATEGORY_COLOR[key]}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
