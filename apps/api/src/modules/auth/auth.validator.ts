import { z } from "zod";

// Exact messages from .ai/knowledge/domains/auth.md "Edge cases" tables — do not deviate,
// the frontend matches on these strings.
export const RegisterSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128, "Password too long"),
  name: z.string().trim().min(1, "Name is required").max(100, "Name too long"),
});

export const VerifyOtpSchema = z.object({
  identifier: z.string().min(1, "Identifier is required"),
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});

export const LoginSchema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1, "Refresh token is required"),
});
