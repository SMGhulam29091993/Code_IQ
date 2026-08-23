"use client";

import { type FC } from "react";
import { useSearchParams } from "next/navigation";
import { useSubscription } from "@/hooks/useBilling";
import { useInstallations } from "@/hooks/useInstallations";
import { InvoicesList } from "./InvoicesList";
import { NextInvoiceCard } from "./NextInvoiceCard";
import { PlanCards } from "./PlanCards";
import { SeatsPanel } from "./SeatsPanel";

// .ai/knowledge/screens/billing-screens.md "Screen: Billing".
export const BillingContent: FC = () => {
  const searchParams = useSearchParams();
  const showSuccess = searchParams.get("success") === "true";

  const { data: subscription, error } = useSubscription();
  const { data: installations } = useInstallations();
  const isOrg = installations?.[0]?.accountType === "Organization";
  const subscribed = !!subscription && !error;

  return (
    <div className="flex flex-col gap-4">
      {showSuccess && (
        <div className="rounded-card border border-green/20 bg-green/10 p-4 text-sm text-green">
          You&apos;re all set! Your plan is now active. 🎉
        </div>
      )}

      {!subscribed && (
        <div className="max-w-lg rounded-card border border-dashed border-border2 bg-surface p-6 text-center">
          <h2 className="font-display text-lg font-semibold text-text">No subscription yet</h2>
          <p className="mt-2 text-sm leading-relaxed text-text2">
            {installations?.[0]?.accountLogin ?? "This account"} is on the free tier. Add a card
            to move to Pro or Team and unlock private repositories.
          </p>
        </div>
      )}

      <PlanCards subscription={subscription} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_1fr]">
        {isOrg && <SeatsPanel />}
        {subscribed && (
          <div className="flex flex-col gap-4">
            <NextInvoiceCard subscription={subscription} />
            <InvoicesList />
          </div>
        )}
      </div>
    </div>
  );
};
