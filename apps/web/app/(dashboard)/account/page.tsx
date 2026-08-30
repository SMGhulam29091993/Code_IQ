import { Suspense } from "react";
import { AccountTabs } from "@/components/account/AccountTabs";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function AccountPage() {
  return (
    <Suspense fallback={<LoadingSkeleton className="h-96 w-full max-w-md" />}>
      <AccountTabs />
    </Suspense>
  );
}
