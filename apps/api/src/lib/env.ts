import "dotenv/config";
import { z } from "zod";

// Fail fast: the process refuses to boot if any of these are missing or malformed.
// GitHub App / Stripe / Gemini vars are added here in their own plan step
// (.ai/plans/backend.md Step 3, Step 5, Step 6) once code actually consumes them.
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
