import { type FC } from "react";
import type { ReviewIssue } from "@codeiq/types";
import { getSeverityColor } from "@/lib/utils";

interface IssueCardProps {
  issue: ReviewIssue;
  prUrl?: string;
}

// .ai/knowledge/screens/dashboard-screens.md "Screen: Review Detail" — severity+category
// header, message, suggestion box, actions. No diff snippet: ReviewIssue has no diff field in
// the schema (unlike the mockup's mock data) — file:line is the only location context available.
// Dismiss is rendered inert per the documented schema gap (knowledge/domains/review.md).
export const IssueCard: FC<IssueCardProps> = ({ issue, prUrl }) => {
  const colors = getSeverityColor(issue.severity);

  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface">
      <div className="flex items-center gap-3 border-b border-border px-5 py-3.5">
        <span
          className={`rounded px-2 py-1 font-mono text-[10.5px] font-medium uppercase tracking-wide ${colors.bg} ${colors.text}`}
        >
          {issue.severity}
        </span>
        <span className="font-mono text-[11.5px] text-text2">{issue.category}</span>
        <span className="ml-auto font-mono text-xs text-text3">
          {issue.file.split("/").pop()}:{issue.line}
        </span>
      </div>
      <div className="p-5">
        <p className="text-sm font-medium leading-relaxed text-text">{issue.message}</p>
        <div className="mt-3.5 flex gap-3 rounded-lg border border-accent/15 bg-accent/5 p-3.5">
          <span className="flex-none font-mono text-[10.5px] font-medium uppercase tracking-wide text-accent">
            fix
          </span>
          <span className="text-sm leading-relaxed text-text2">{issue.suggestion}</span>
        </div>
        <div className="mt-3.5 flex gap-2">
          {prUrl && (
            <a
              href={prUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-lg border border-border2 bg-surface2 px-3 py-1.5 text-xs font-medium text-text hover:bg-surface3"
            >
              View on GitHub
            </a>
          )}
          <button
            type="button"
            disabled
            title="Not available yet — see knowledge/domains/review.md"
            className="cursor-not-allowed rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text3"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
};
