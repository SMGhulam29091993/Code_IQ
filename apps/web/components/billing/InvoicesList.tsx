import { type FC } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useInvoices } from "@/hooks/useBilling";

// .ai/knowledge/screens/billing-screens.md "Screen: Billing" — invoice history from
// GET /billing/invoices, PDF link per row.
export const InvoicesList: FC = () => {
  const { data: invoices, isLoading, error, refetch } = useInvoices();

  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="mb-3 font-display text-sm font-semibold text-text">Invoices</div>

      {error && <ErrorBanner message="Couldn't load invoices." onRetry={() => refetch()} />}

      {!error && isLoading && (
        <div className="flex flex-col gap-2">
          {[1, 2].map((i) => (
            <LoadingSkeleton key={i} className="h-8 w-full" />
          ))}
        </div>
      )}

      {!error && !isLoading && invoices?.length === 0 && (
        <p className="text-sm text-text3">No invoices yet.</p>
      )}

      {!error && !isLoading && invoices && invoices.length > 0 && (
        <div className="flex flex-col">
          {invoices.map((invoice) => (
            <div
              key={invoice.date}
              className="flex items-center justify-between gap-3 border-b border-white/5 py-2.5 last:border-b-0"
            >
              <span className="text-xs text-text2">
                {new Date(invoice.date).toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "short",
                  year: "numeric",
                })}
              </span>
              <span className="font-mono text-xs text-text">${invoice.amount.toFixed(2)}</span>
              <span className="rounded bg-green/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-green">
                {invoice.status}
              </span>
              <a
                href={invoice.pdfUrl}
                target="_blank"
                rel="noreferrer"
                className="text-xs font-medium text-accent hover:underline"
              >
                PDF
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
