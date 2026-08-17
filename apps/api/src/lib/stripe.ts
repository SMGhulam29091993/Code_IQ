import Stripe from "stripe";
import { env } from "./env";
import type { IStripeClient } from "../modules/billing/billing.types";

// Typed against the narrow IStripeClient (not the SDK's own Stripe type) so BillingService
// only ever depends on the methods it actually calls — same stance as lib/gemini.ts's
// IGeminiClient. Stripe's real client structurally satisfies IStripeClient.
export const stripeClient: IStripeClient = new Stripe(env.STRIPE_SECRET_KEY);
