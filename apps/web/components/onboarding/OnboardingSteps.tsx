"use client";

import { type FC, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { useActivateRepo, useRepos } from "@/hooks/useRepos";
import { useInstallations, useSaveInstallation } from "@/hooks/useInstallations";
import { getErrorMessage } from "@/lib/utils";
import { ChooseReposStep } from "./ChooseReposStep";
import { InstallStep } from "./InstallStep";
import { OpenPrStep } from "./OpenPrStep";

// .ai/knowledge/screens/onboarding-screens.md — owns which step is current + the step-2
// repo-selection state, matching the OnboardingPage pseudocode there.
export const OnboardingSteps: FC = () => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const installationIdParam = searchParams.get("installation_id");

  const { data: installations, isLoading: installationsLoading } = useInstallations();
  const installation = installations?.[0];
  const saveInstallation = useSaveInstallation();

  // GitHub redirects back here with ?installation_id= after the app is installed.
  useEffect(() => {
    if (installationIdParam && !saveInstallation.isPending && !saveInstallation.isSuccess) {
      saveInstallation.mutate(Number(installationIdParam));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [installationIdParam]);

  const { data: repos, isLoading: reposLoading } = useRepos({
    installationId: installation?.id,
  });
  const activateRepo = useActivateRepo();
  const [selected, setSelected] = useState<string[]>([]);
  const [batchError, setBatchError] = useState<string | null>(null);

  const hasInstallation = !!installation || saveInstallation.isSuccess;
  const hasActiveRepo = repos?.some((r) => r.isActive) ?? false;
  const currentStep = !hasInstallation ? 1 : !hasActiveRepo ? 2 : 3;

  async function handleActivateSelected() {
    setBatchError(null);
    for (const repoId of selected) {
      try {
        await activateRepo.mutateAsync(repoId);
      } catch (err) {
        const repoName = repos?.find((r) => r.id === repoId)?.fullName ?? repoId;
        setBatchError(`Failed to activate ${repoName}: ${getErrorMessage(err)}`);
        return;
      }
    }
    router.push("/overview");
  }

  return (
    <div className="max-w-2xl">
      <p className="mb-8 text-sm leading-relaxed text-text2">
        CodeIQ reviews pull requests through a GitHub App installation. Three steps, about two
        minutes.
      </p>

      {saveInstallation.isError && (
        <div className="mb-6">
          <ErrorBanner message={getErrorMessage(saveInstallation.error)} />
        </div>
      )}
      {batchError && (
        <div className="mb-6">
          <ErrorBanner message={batchError} onRetry={() => setBatchError(null)} />
        </div>
      )}

      <InstallStep status={currentStep === 1 ? "current" : "done"} />
      <ChooseReposStep
        status={currentStep === 1 ? "upcoming" : currentStep === 2 ? "current" : "done"}
        repos={repos}
        isLoading={installationsLoading || reposLoading}
        selected={selected}
        onToggle={(repoId) =>
          setSelected((s) => (s.includes(repoId) ? s.filter((id) => id !== repoId) : [...s, repoId]))
        }
        onActivate={handleActivateSelected}
        isActivating={activateRepo.isPending}
      />
      <OpenPrStep status={currentStep === 3 ? "current" : "upcoming"} />
    </div>
  );
};
