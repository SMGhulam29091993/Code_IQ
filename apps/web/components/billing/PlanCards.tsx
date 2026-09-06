"use client";

import { type FC } from "react";
import type { PlanInfo, Subscription } from "@codeiq/types";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useBillingPlans, useBillingPortal, useCheckout } from "@/hooks/useBilling";
import { cn, getErrorMessage } from "@/lib/utils";

interface PlanCardsProps {
  subscription: Subscription | undefined;
}

// .ai/knowledge/screens/billing-screens.md "Screen: Billing" — 3 plan cards, all copy pulled
// from GET /billing/plans (real numbers), not the mockup's placeholder pricing — see the doc's
// pricing note for why.
export const PlanCards: FC<PlanCardsProps> = ({ subscription }) => {
  const { data: plans, isLoading, error } = useBillingPlans();
  const checkout = useCheckout();
  const portal = useBillingPortal();

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <LoadingSkeleton key={i} className="h-64 w-full" />
        ))}
      </div>
    );
  }
  if (error || !plans) {
    return <ErrorBanner message="Couldn't load plans." />;
  }

  const currentTier = subscription?.planTier ?? "FREE";

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.tier}
            plan={plan}
            isCurrent={plan.tier === currentTier}
            onSwitch={() => checkout.mutate({ planTier: plan.tier as "PRO" | "TEAM", seats: subscription?.seatCount ?? 1 })}
            onManage={() => portal.mutate()}
            switching={checkout.isPending}
          />
        ))}
      </div>
      {checkout.isError && <ErrorBanner message={getErrorMessage(checkout.error)} />}
      {portal.isError && <ErrorBanner message={getErrorMessage(portal.error)} />}
    </div>
  );
};

const PlanCard: FC<{
  plan: PlanInfo;
  isCurrent: boolean;
  onSwitch: () => void;
  onManage: () => void;
  switching: boolean;
}> = ({ plan, isCurrent, onSwitch, onManage, switching }) => (
  <div
    className={cn(
      "rounded-card border p-5",
      isCurrent ? "border-accent/35 bg-accent/[0.04]" : "border-border bg-surface"
    )}
  >
    <div className="flex items-center gap-2">
      <span className="font-display text-base font-semibold text-text">{plan.tier}</span>
      {isCurrent && (
        <span className="rounded bg-accent/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-accent">
          current
        </span>
      )}
    </div>
    <div className="mt-3 flex items-baseline gap-1.5">
      <span className="font-display text-2xl font-semibold text-text">${plan.price}</span>
      <span className="text-xs text-text2">{plan.price > 0 ? "per seat / month" : "forever"}</span>
    </div>
    <ul className="mt-4 flex flex-col gap-2 text-xs text-text2">
      <li>{plan.repoLimit === null ? "Unlimited repositories" : `${plan.repoLimit} repositories`}</li>
      <li>{plan.reviewLimit === null ? "Unlimited reviews" : `${plan.reviewLimit} reviews per month`}</li>
      {plan.aiQueries && <li>Dashboard analytics</li>}
    </ul>
    <div className="mt-5">
      {isCurrent ? (
        plan.tier !== "FREE" && (
          <Button variant="secondary" size="sm" className="w-full" onClick={onManage}>
            Manage
          </Button>
        )
      ) : plan.tier === "FREE" ? (
        <Button variant="secondary" size="sm" className="w-full" disabled>
          Downgrade in Stripe portal
        </Button>
      ) : (
        <Button size="sm" className="w-full" disabled={switching} onClick={onSwitch}>
          {switching ? "Redirecting..." : `Switch to ${plan.tier}`}
        </Button>
      )}
    </div>
  </div>
);
