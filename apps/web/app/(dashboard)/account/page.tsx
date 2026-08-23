import { Suspense } from "react";
import { AccountTabs } from "@/components/account/AccountTabs";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";

export default function AccountPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-semibold text-text">Account</h1>
      <Suspense fallback={<LoadingSkeleton className="h-96 w-full max-w-md" />}>
        <AccountTabs />
      </Suspense>
    </div>
  );
}
