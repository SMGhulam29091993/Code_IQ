"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { type FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { AuthTokensResult, RegisterResult } from "@codeiq/types";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { passwordStrength } from "@/lib/password-strength";

// POST /auth/register issues an OTP, not tokens (.ai/knowledge/domains/auth.md — two-step
// registration). This form covers both steps: register, then verify the emailed code.
type Step = "register" | "verify-otp";

// Exact messages from .ai/knowledge/screens/auth-screens.md "Register" edge cases, mirroring
// the backend's own RegisterSchema (auth.validator.ts) for the shared fields.
const registerSchema = z
  .object({
    name: z.string().trim().min(1, "Name is required").max(100, "Name too long"),
    email: z.string().email("Invalid email format"),
    password: z.string().min(8, "Password must be at least 8 characters").max(128, "Password too long"),
    confirmPassword: z.string(),
    terms: z.boolean().refine((v) => v === true, { message: "You must accept the terms" }),
  })
  .refine((d) => d.password === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type RegisterFormData = z.infer<typeof registerSchema>;

const otpSchema = z.object({
  otp: z.string().regex(/^\d{6}$/, "OTP must be 6 digits"),
});
type OtpFormData = z.infer<typeof otpSchema>;

const STRENGTH_LABEL = { weak: "Weak", medium: "Medium", strong: "Strong" } as const;
const STRENGTH_COLOR = { weak: "text-red", medium: "text-yellow", strong: "text-green" } as const;

export const RegisterForm: FC = () => {
  const router = useRouter();
  const { isAuthenticated, login } = useAuth();
  const [step, setStep] = useState<Step>("register");
  const [identifier, setIdentifier] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  useEffect(() => {
    if (isAuthenticated) router.replace("/overview");
  }, [isAuthenticated, router]);

  const registerForm = useForm<RegisterFormData>({
    resolver: zodResolver(registerSchema),
    defaultValues: { terms: false },
  });
  const password = registerForm.watch("password");
  const strength = passwordStrength(password ?? "");

  const registerMutation = useMutation({
    mutationFn: (data: RegisterFormData) =>
      api
        .post<{ data: RegisterResult }>("/auth/register", {
          email: data.email,
          password: data.password,
          name: data.name,
        })
        .then((r) => r.data.data),
    onSuccess: (result) => {
      setIdentifier(result.identifier);
      setStep("verify-otp");
    },
    onError: (err: unknown) => {
      const status = axiosStatus(err);
      if (status === 409) {
        registerForm.setError("email", { message: "This email is already registered" });
      } else {
        setApiError(genericErrorMessage(err));
      }
    },
  });

  const otpForm = useForm<OtpFormData>({ resolver: zodResolver(otpSchema) });

  const verifyOtpMutation = useMutation({
    mutationFn: (data: OtpFormData) =>
      api
        .post<{ data: AuthTokensResult }>("/auth/verify-otp", { identifier, otp: data.otp })
        .then((r) => r.data.data),
    onSuccess: (result) => {
      login(result.token, result.refreshToken, result.user);
      router.push("/install");
    },
    onError: (err: unknown) => {
      setApiError(otpErrorMessage(err));
    },
  });

  if (isAuthenticated) return null;

  if (step === "verify-otp") {
    return (
      <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8">
        <h1 className="mb-2 text-xl font-semibold text-text">Check your email</h1>
        <p className="mb-6 text-sm text-text2">
          Enter the 6-digit code we sent to verify your account.
        </p>
        <form
          onSubmit={otpForm.handleSubmit((data) => {
            setApiError(null);
            verifyOtpMutation.mutate(data);
          })}
          noValidate
          className="flex flex-col gap-4"
        >
          <div>
            <label htmlFor="otp" className="mb-1 block text-sm font-medium text-text2">
              Verification code
            </label>
            <Input
              id="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              aria-invalid={!!otpForm.formState.errors.otp}
              {...otpForm.register("otp")}
            />
            {otpForm.formState.errors.otp && (
              <p role="alert" className="mt-1 text-xs text-red">
                {otpForm.formState.errors.otp.message}
              </p>
            )}
          </div>

          {apiError && <ErrorBanner message={apiError} />}

          <Button type="submit" disabled={verifyOtpMutation.isPending} className="mt-2">
            {verifyOtpMutation.isPending ? "Verifying..." : "Verify"}
          </Button>

          <button
            type="button"
            onClick={() => {
              setApiError(null);
              setStep("register");
            }}
            className="text-sm text-text2 hover:text-text"
          >
            Start over with a different email
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8">
      <h1 className="mb-6 text-xl font-semibold text-text">Create account</h1>
      <form
        onSubmit={registerForm.handleSubmit((data) => {
          setApiError(null);
          registerMutation.mutate(data);
        })}
        noValidate
        className="flex flex-col gap-4"
      >
        <div>
          <label htmlFor="name" className="mb-1 block text-sm font-medium text-text2">
            Name
          </label>
          <Input
            id="name"
            autoComplete="name"
            aria-invalid={!!registerForm.formState.errors.name}
            {...registerForm.register("name")}
          />
          {registerForm.formState.errors.name && (
            <p role="alert" className="mt-1 text-xs text-red">
              {registerForm.formState.errors.name.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-text2">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!registerForm.formState.errors.email}
            {...registerForm.register("email")}
          />
          {registerForm.formState.errors.email && (
            <p role="alert" className="mt-1 text-xs text-red">
              {registerForm.formState.errors.email.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="password" className="mb-1 block text-sm font-medium text-text2">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!registerForm.formState.errors.password}
            {...registerForm.register("password")}
          />
          {strength && (
            <p className={`mt-1 text-xs ${STRENGTH_COLOR[strength]}`}>
              Strength: {STRENGTH_LABEL[strength]}
            </p>
          )}
          {registerForm.formState.errors.password && (
            <p role="alert" className="mt-1 text-xs text-red">
              {registerForm.formState.errors.password.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-text2">
            Confirm password
          </label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            aria-invalid={!!registerForm.formState.errors.confirmPassword}
            {...registerForm.register("confirmPassword")}
          />
          {registerForm.formState.errors.confirmPassword && (
            <p role="alert" className="mt-1 text-xs text-red">
              {registerForm.formState.errors.confirmPassword.message}
            </p>
          )}
        </div>

        <div>
          <label htmlFor="terms" className="flex items-center gap-2 text-sm text-text2">
            <input
              id="terms"
              type="checkbox"
              aria-invalid={!!registerForm.formState.errors.terms}
              {...registerForm.register("terms")}
            />
            I agree to the terms of service
          </label>
          {registerForm.formState.errors.terms && (
            <p role="alert" className="mt-1 text-xs text-red">
              {registerForm.formState.errors.terms.message}
            </p>
          )}
        </div>

        {apiError && <ErrorBanner message={apiError} />}

        <Button type="submit" disabled={registerMutation.isPending} className="mt-2">
          {registerMutation.isPending ? "Creating account..." : "Create account"}
        </Button>

        <Link href="/login" className="text-center text-sm text-text2 hover:text-text">
          Already have an account?
        </Link>
      </form>
    </div>
  );
};

function axiosStatus(err: unknown): number | undefined {
  if (typeof err === "object" && err !== null && "response" in err) {
    return (err as { response?: { status?: number } }).response?.status;
  }
  return undefined;
}

function axiosMessage(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "response" in err) {
    return (err as { response?: { data?: { message?: string } } }).response?.data?.message;
  }
  return undefined;
}

function genericErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const hasResponse = (err as { response?: unknown }).response !== undefined;
    if (!hasResponse) return "No internet connection.";
    return axiosMessage(err) ?? "Something went wrong. Please try again.";
  }
  return "No internet connection.";
}

// The backend throws AppError subclasses with these exact user-facing strings for every
// documented verify-otp edge case (auth.service.ts / .ai/knowledge/domains/auth.md) — passing
// response.data.message straight through avoids re-deriving text that could drift from it.
function otpErrorMessage(err: unknown): string {
  return axiosMessage(err) ?? genericErrorMessage(err);
}
