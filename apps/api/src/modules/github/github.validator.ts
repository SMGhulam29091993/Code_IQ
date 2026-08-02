import { z } from "zod";

// Exact messages from .ai/knowledge/domains/github-app.md "Edge cases" tables.
export const InstallationSchema = z.object({
  installationId: z
    .number({ invalid_type_error: "installationId must be a positive integer" })
    .int("installationId must be a positive integer")
    .positive("installationId must be a positive integer"),
});

// GET /github/oauth/callback query params — .ai/knowledge/domains/auth.md#github-oauth-callback.
export const OAuthCallbackQuerySchema = z.object({
  code: z.string().min(1, "code is required"),
  state: z.string().min(1, "state is required"),
});
