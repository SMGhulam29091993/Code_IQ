import { type FC } from "react";
import { StepShell } from "./StepShell";

interface OpenPrStepProps {
  status: "current" | "done" | "upcoming";
}

// .ai/knowledge/screens/onboarding-screens.md "Step 3 — Open a pull request" — informational
// only, no CTA.
export const OpenPrStep: FC<OpenPrStepProps> = ({ status }) => (
  <StepShell
    n={3}
    status={status}
    title="Open a pull request"
    body="The first review lands within a minute of the PR opening. Severity threshold starts at WARNING, which posts blockers and warnings but keeps style notes in the dashboard."
  />
);
