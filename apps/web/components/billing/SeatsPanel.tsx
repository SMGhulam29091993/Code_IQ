import { type FC } from "react";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { LoadingSkeleton } from "@/components/ui/LoadingSkeleton";
import { useBillingSeats } from "@/hooks/useBilling";
import { useInstallations } from "@/hooks/useInstallations";

// .ai/knowledge/screens/billing-screens.md "Screen: Billing" — GitHub org members + role + PR
// review count, from GET /billing/seats (GitHub org membership, not a locally-invited list —
// see knowledge/domains/billing.md's "Where seats come from" resolution).
export const SeatsPanel: FC = () => {
  const { data: seats, isLoading, error, refetch } = useBillingSeats();
  const { data: installations } = useInstallations();
  const accountLogin = installations?.[0]?.accountLogin;

  return (
    <div className="rounded-card border border-border bg-surface p-5">
      <div className="mb-4 font-display text-sm font-semibold text-text">Seats</div>

      {error && <ErrorBanner message="Couldn't load seats." onRetry={() => refetch()} />}

      {!error && isLoading && (
        <div className="flex flex-col gap-2">
          {[1, 2, 3].map((i) => (
            <LoadingSkeleton key={i} className="h-10 w-full" />
          ))}
        </div>
      )}

      {!error && !isLoading && seats?.length === 0 && (
        <p className="text-sm text-text3">No org members found.</p>
      )}

      {!error && !isLoading && seats && seats.length > 0 && (
        <div className="flex flex-col gap-1">
          {seats.map((seat) => (
            <div key={seat.login} className="flex items-center gap-3 py-2">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-surface3 font-display text-[11px] font-semibold text-text2">
                {seat.login.slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-mono text-xs text-text">{seat.login}</div>
                <div className="mt-0.5 text-[11px] text-text3">
                  {seat.prsReviewed > 0
                    ? `${seat.prsReviewed} pull requests reviewed`
                    : "no reviews this period"}
                </div>
              </div>
              <span className="flex-none font-mono text-[10.5px] uppercase tracking-wide text-text3">
                {seat.role}
              </span>
            </div>
          ))}
        </div>
      )}

      {accountLogin && (
        <a
          href={`https://github.com/orgs/${accountLogin}/people`}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-block text-xs font-medium text-accent hover:underline"
        >
          Invite from GitHub org
        </a>
      )}
    </div>
  );
};
