import { type FC } from "react";
import Link from "next/link";
import type { Installation } from "@codeiq/types";

interface WorkspacePanelProps {
  installation: Installation;
}

// .ai/knowledge/screens/account-screens.md "Screen: Account" — Workspace tab.
export const WorkspacePanel: FC<WorkspacePanelProps> = ({ installation }) => (
  <div className="max-w-md rounded-card border border-border bg-surface p-5">
    <h2 className="mb-4 font-display text-sm font-semibold text-text">Workspace</h2>
    <div className="flex flex-col gap-4">
      <div>
        <span className="mb-1 block text-sm font-medium text-text2">GitHub account</span>
        <p className="font-mono text-sm text-text">{installation.accountLogin}</p>
      </div>
      <div className="flex gap-8">
        <div>
          <span className="mb-1 block text-sm font-medium text-text2">Plan</span>
          <p className="text-sm text-text">{installation.planTier}</p>
        </div>
        <div>
          <span className="mb-1 block text-sm font-medium text-text2">Repos</span>
          <p className="text-sm text-text">{installation.repoCount}</p>
        </div>
      </div>
    </div>
  </div>
);

export const NoInstallationState: FC = () => (
  <div className="max-w-md rounded-card border border-dashed border-border2 bg-surface p-6 text-center">
    <p className="text-sm text-text2">No GitHub installation connected.</p>
    <Link href="/onboarding" className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
      Connect GitHub
    </Link>
  </div>
);
