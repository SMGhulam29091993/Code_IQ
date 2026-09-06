import { Suspense } from "react";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";
import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function OnboardingPage() {
  return (
    <div>
      <PageHeader crumb="setup" title="Connect CodeIQ to GitHub" />
      {/* OnboardingSteps reads `?installation_id=` via useSearchParams, which Next.js
          requires a Suspense boundary around. */}
      <Suspense fallback={<LoadingSkeleton className="h-64 w-full max-w-2xl" />}>
        <OnboardingSteps />
      </Suspense>
    </div>
  );
}
