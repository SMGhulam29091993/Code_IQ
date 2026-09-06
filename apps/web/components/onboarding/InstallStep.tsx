import { type FC } from "react";
import { Button } from "@/components/ui/Button";
import { StepShell } from "./StepShell";

interface InstallStepProps {
  status: "current" | "done" | "upcoming";
}

const GITHUB_APP_SLUG = process.env.NEXT_PUBLIC_GITHUB_APP_SLUG;

// .ai/knowledge/screens/onboarding-screens.md "Step 1 — Install the GitHub App".
export const InstallStep: FC<InstallStepProps> = ({ status }) => (
  <StepShell
    n={1}
    status={status}
    title="Install the GitHub App"
    body="CodeIQ asks for read access to code and write access to pull requests. Nothing is reviewed until you pick repositories in step two."
  >
    {status === "current" && (
      <div className="flex items-center gap-3">
        <Button
          onClick={() => {
            window.location.href = `https://github.com/apps/${GITHUB_APP_SLUG}/installations/new`;
          }}
        >
          Install the GitHub App
        </Button>
        <span className="text-xs text-text3">opens github.com</span>
      </div>
    )}
  </StepShell>
);
