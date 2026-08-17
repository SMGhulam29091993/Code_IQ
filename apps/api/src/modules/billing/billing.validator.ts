import { z } from "zod";

// Shape only — the exact-wording business rules (seats < 1, seats > 500, FREE tier, already
// subscribed) live in BillingService.createCheckout, not here, matching the unit test list in
// .ai/knowledge/domains/billing.md "POST /billing/checkout" (all under
// `describe('BillingService.createCheckout')`, not a routes/validator test).
export const CheckoutSchema = z.object({
  planTier: z.enum(["FREE", "PRO", "TEAM"]),
  seats: z.number().int(),
});
