import { type FC } from "react";
import type { Subscription } from "@codeiq/types";

interface NextInvoiceCardProps {
  subscription: Subscription;
}

// .ai/knowledge/screens/billing-screens.md "Screen: Billing" — amount + date + breakdown.
export const NextInvoiceCard: FC<NextInvoiceCardProps> = ({ subscription }) => {
  const { nextInvoice, paymentMethod, seatCount } = subscription;

  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="mb-3 font-display text-sm font-semibold text-text">Next invoice</div>
      {nextInvoice ? (
        <>
          <div className="font-display text-2xl font-semibold text-text">
            ${nextInvoice.amount.toFixed(2)}
          </div>
          <div className="mt-1 text-xs text-text2">
            on {new Date(nextInvoice.date).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </div>
          <div className="mt-2 font-mono text-[11px] text-text3">
            {seatCount} seats
            {paymentMethod && ` · ${paymentMethod.brand} ending ${paymentMethod.last4}`}
          </div>
        </>
      ) : (
        <p className="text-sm text-text3">No upcoming invoice — subscription is not renewing.</p>
      )}
    </div>
  );
};
