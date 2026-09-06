import { type FC, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StepShellProps {
  n: number;
  status: "current" | "done" | "upcoming";
  title: string;
  body: string;
  children?: ReactNode;
}

// Shared numbered-step layout for all three onboarding steps — ring + title dim when not
// current, matching the mockup's terminal-step treatment for step 3.
// .ai/knowledge/screens/onboarding-screens.md.
export const StepShell: FC<StepShellProps> = ({ n, status, title, body, children }) => {
  const dimmed = status !== "current";
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex h-8 w-8 flex-none items-center justify-center rounded-full border font-display text-sm font-semibold",
            status === "current" && "border-accent/40 bg-accent/10 text-accent",
            status === "done" && "border-accent/40 bg-accent text-bg",
            status === "upcoming" && "border-border bg-transparent text-text3"
          )}
        >
          {status === "done" ? "✓" : n}
        </span>
        {n < 3 && <span className="mt-2 w-px flex-1 bg-border" />}
      </div>
      <div className="flex-1 pb-8">
        <h2
          className={cn(
            "font-display text-base font-semibold",
            dimmed ? "text-text2" : "text-text"
          )}
        >
          {title}
        </h2>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-text2">{body}</p>
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  );
};
