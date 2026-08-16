import "dotenv/config";
import { z } from "zod";

// Fail fast: the process refuses to boot if any of these are missing or malformed.
// Stripe / Gemini vars are added here in their own plan step
// (.ai/plans/backend.md Step 5, Step 6) once code actually consumes them.
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(4000),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  JWT_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),

  MAIL_HOST: z.string().min(1),
  MAIL_PORT: z.coerce.number().int().positive(),
  MAIL_USER: z.string().min(1),
  MAIL_PASSWORD: z.string().min(1),
  MAIL_FROM: z.string().min(1),

  FRONTEND_URL: z.string().url(),

  // GitHub App — installation-token auth for repo/PR access (ADR 001).
  GITHUB_APP_ID: z.string().min(1),
  // Base64-encoded PEM, decoded at runtime — see .ai/rules/security.md #4 and pitfall 002.
  GITHUB_APP_PRIVATE_KEY: z.string().min(1),
  GITHUB_WEBHOOK_SECRET: z.string().min(1),

  // GitHub App user-to-server OAuth — identity linking only (.ai/knowledge/domains/auth.md
  // #github-oauth-url), never a login bypass (.ai/rules/backend.md "Auth boundary").
  GITHUB_CLIENT_ID: z.string().min(1),
  GITHUB_CLIENT_SECRET: z.string().min(1),
  GITHUB_OAUTH_REDIRECT_URI: z.string().url(),

  // 32-byte key (hex-encoded, 64 chars) for AES-256-GCM encryption of githubAccessToken at
  // rest — see .ai/rules/security.md security-hardening-backlog "GitHub token encryption".
  ENCRYPTION_KEY: z.string().length(64, "ENCRYPTION_KEY must be a 64-char hex string (32 bytes)"),

  // Gemini 1.5 Pro — review pipeline (.ai/plans/backend.md Step 5).
  GEMINI_API_KEY: z.string().min(1),
}).refine((e) => e.JWT_SECRET !== e.JWT_REFRESH_SECRET, {
  message: "JWT_SECRET and JWT_REFRESH_SECRET must be different values (.ai/rules/security.md #5)",
  path: ["JWT_REFRESH_SECRET"],
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.errors.map((e) => `  ${e.path.join(".")}: ${e.message}`).join("\n");
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return result.data;
}

export const env = loadEnv();
