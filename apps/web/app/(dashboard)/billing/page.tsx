import { Suspense } from "react";
import { BillingContent } from "@/components/billing/BillingContent";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function BillingPage() {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96 w-full" />}>
      <BillingContent />
    </Suspense>
  );
}
