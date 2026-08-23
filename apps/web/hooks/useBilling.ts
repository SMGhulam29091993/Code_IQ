import { useMutation, useQuery } from "@tanstack/react-query";
import type { BillingSeat, Invoice, PlanInfo, Subscription } from "@codeiq/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

// .ai/knowledge/technical/frontend/hooks-and-utils.md "useBilling", extended with the
// subscription/seats/invoices reads added in .ai/knowledge/domains/billing.md.
export const useBillingPlans = () =>
  useQuery({
    queryKey: queryKeys.billingPlans,
    queryFn: () => api.get<{ data: { plans: PlanInfo[] } }>("/billing/plans").then((r) => r.data.data.plans),
  });

// 400 ("No active subscription found") is the expected FREE-tier response, not a real error —
// callers check `error` and render the empty state rather than an ErrorBanner for a 400 here.
export const useSubscription = () =>
  useQuery({
    queryKey: queryKeys.billingSubscription,
    queryFn: () => api.get<{ data: Subscription }>("/billing/subscription").then((r) => r.data.data),
    retry: false,
  });

export const useBillingSeats = () =>
  useQuery({
    queryKey: queryKeys.billingSeats,
    queryFn: () => api.get<{ data: { seats: BillingSeat[] } }>("/billing/seats").then((r) => r.data.data.seats),
  });

export const useInvoices = (limit?: number) =>
  useQuery({
    queryKey: queryKeys.billingInvoices(limit),
    queryFn: () =>
      api
        .get<{ data: { invoices: Invoice[] } }>("/billing/invoices", { params: { limit } })
        .then((r) => r.data.data.invoices),
  });

export const useCheckout = () =>
  useMutation({
    mutationFn: (body: { planTier: "PRO" | "TEAM"; seats: number }) =>
      api.post<{ data: { url: string } }>("/billing/checkout", body).then((r) => r.data.data),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });

export const useBillingPortal = () =>
  useMutation({
    mutationFn: () => api.post<{ data: { url: string } }>("/billing/portal").then((r) => r.data.data),
    onSuccess: ({ url }) => {
      window.location.href = url;
    },
  });
