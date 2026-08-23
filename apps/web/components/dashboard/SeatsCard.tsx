"use client";

import { type FC } from "react";
import Link from "next/link";
import { useBillingSeats, useSubscription } from "@/hooks/useBilling";

// .ai/knowledge/screens/dashboard-screens.md "Screen: Overview" — mockup's Seats mini-card.
// Only rendered for a subscribed installation (FREE tier has no seats to show). "Assigned"
// count comes from GET /billing/seats (real GitHub org membership); if that call fails — e.g.
// no real GitHub App credentials — the card still shows the billed seat count with the
// assigned half omitted, rather than a broken "undefined of N".
export const SeatsCard: FC = () => {
  const { data: subscription } = useSubscription();
  const { data: seats } = useBillingSeats();

  if (!subscription) return null;

  const assigned = seats?.length;
  const pct = assigned ? Math.min(100, Math.round((assigned / subscription.seatCount) * 100)) : 0;

  return (
    <div className="rounded-card border border-border bg-surface p-[18px]">
      <div className="mb-3.5 font-display text-sm font-semibold text-text">Seats</div>
      <div className="flex items-baseline gap-2">
        <span className="font-display text-[28px] font-semibold leading-none text-text">
          {assigned ?? "—"}
        </span>
        <span className="text-[13px] text-text2">
          of {subscription.seatCount} on {subscription.planTier}
        </span>
      </div>
      <div className="my-3.5 h-[5px] overflow-hidden rounded-full bg-surface3">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <Link href="/billing" className="text-xs font-medium text-accent hover:underline">
        Manage seats
      </Link>
    </div>
  );
};
