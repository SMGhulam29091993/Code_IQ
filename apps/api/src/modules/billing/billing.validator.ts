import { z } from "zod";

// Shape only — the exact-wording business rules (seats < 1, seats > 500, FREE tier, already
// subscribed) live in BillingService.createCheckout, not here, matching the unit test list in
// .ai/knowledge/domains/billing.md "POST /billing/checkout" (all under
// `describe('BillingService.createCheckout')`, not a routes/validator test).
export const CheckoutSchema = z.object({
  planTier: z.enum(["FREE", "PRO", "TEAM"]),
  seats: z.number().int(),
});

// GET /billing/invoices query params — .ai/knowledge/domains/billing.md "GET /billing/invoices".
// The clamp to MAX_INVOICES_LIMIT (50) happens in BillingService.getInvoices, not here — this
// schema only coerces the query string to a number.
export const GetInvoicesQuerySchema = z.object({
  limit: z.coerce.number().int().positive().optional(),
});
