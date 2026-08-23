import { Suspense } from "react";
import { BillingContent } from "@/components/billing/BillingContent";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function BillingPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-semibold text-text">Billing</h1>
      <Suspense fallback={<LoadingSkeleton className="h-96 w-full" />}>
        <BillingContent />
      </Suspense>
    </div>
  );
}
