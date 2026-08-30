import { type FC } from "react";
import type { ReviewStatus } from "@codeiq/types";
import { cn } from "@/lib/utils";

const STATUS_STYLES: Record<ReviewStatus, string> = {
  DONE: "bg-green/10 text-green",
  RUNNING: "bg-accent/10 text-accent",
  FAILED: "bg-red/10 text-red",
  PENDING: "bg-white/5 text-text3",
};

// design-system.md's "severity is colour plus a word" rule applies to status too — colour dot
// or pill always carries the label, never colour alone.
export const StatusBadge: FC<{ status: ReviewStatus; className?: string }> = ({
  status,
  className,
}) => (
  <span
    className={cn(
      "rounded px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wide",
      STATUS_STYLES[status],
      className
    )}
  >
    {status}
  </span>
);

export const STATUS_DOT: Record<ReviewStatus, string> = {
  DONE: "bg-green",
  RUNNING: "bg-accent",
  FAILED: "bg-red",
  PENDING: "bg-text3",
};
