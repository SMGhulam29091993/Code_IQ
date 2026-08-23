import { Suspense } from "react";
import { OnboardingSteps } from "@/components/onboarding/OnboardingSteps";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function OnboardingPage() {
  return (
    <div>
      <p className="mb-2 font-mono text-xs uppercase tracking-wide text-text3">setup</p>
      <h1 className="mb-8 font-display text-2xl font-semibold text-text">
        Connect CodeIQ to GitHub
      </h1>
      {/* OnboardingSteps reads `?installation_id=` via useSearchParams, which Next.js
          requires a Suspense boundary around. */}
      <Suspense fallback={<LoadingSkeleton className="h-64 w-full max-w-2xl" />}>
        <OnboardingSteps />
      </Suspense>
    </div>
  );
}
