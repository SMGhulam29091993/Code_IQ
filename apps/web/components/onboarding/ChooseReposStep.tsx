import { type FC } from "react";
import type { Repo } from "@codeiq/types";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { StepShell } from "./StepShell";

interface ChooseReposStepProps {
  status: "current" | "done" | "upcoming";
  repos: Repo[] | undefined;
  isLoading: boolean;
  selected: string[];
  onToggle: (repoId: string) => void;
  onActivate: () => void;
  isActivating: boolean;
}

// .ai/knowledge/screens/onboarding-screens.md "Step 2 — Choose repositories".
export const ChooseReposStep: FC<ChooseReposStepProps> = ({
  status,
  repos,
  isLoading,
  selected,
  onToggle,
  onActivate,
  isActivating,
}) => (
  <StepShell
    n={2}
    status={status}
    title="Choose repositories"
    body="Start with one active repository. You can add the rest once you have seen how the comments read on a real pull request."
  >
    {status === "current" && (
      <div className="flex flex-col gap-4">
        {isLoading && (
          <div className="flex flex-col gap-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-button bg-surface3" />
            ))}
          </div>
        )}
        {!isLoading && repos?.length === 0 && (
          <p className="text-sm text-text3">No repositories found in this installation.</p>
        )}
        {!isLoading && repos && repos.length > 0 && (
          <ul className="flex flex-col gap-2">
            {repos.map((repo) => {
              const isSelected = selected.includes(repo.id);
              return (
                <li key={repo.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(repo.id)}
                    aria-pressed={isSelected}
                    className="flex w-full items-center gap-3 rounded-button border border-border bg-surface p-3 text-left hover:bg-surface2"
                  >
                    <span
                      className={cn(
                        "flex h-4 w-4 flex-none items-center justify-center rounded border",
                        isSelected ? "border-accent bg-accent" : "border-border2"
                      )}
                    >
                      {isSelected && <span className="text-[10px] text-bg">✓</span>}
                    </span>
                    <span className="flex-1 font-mono text-sm text-text">{repo.fullName}</span>
                    <span className="text-xs text-text2">{repo.language ?? "—"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex items-center gap-3">
          <Button onClick={onActivate} disabled={selected.length === 0 || isActivating}>
            {isActivating
              ? "Activating..."
              : `Activate ${selected.length} ${selected.length === 1 ? "repository" : "repositories"}`}
          </Button>
          <span className="text-xs text-text3">changeable any time</span>
        </div>
      </div>
    )}
  </StepShell>
);
