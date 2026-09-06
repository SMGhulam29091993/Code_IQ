"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { type FC, useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { z } from "zod";
import type { AuthTokensResult } from "@codeiq/types";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { Logo } from "@/components/ui/Logo";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth.store";

// Exact messages from .ai/knowledge/screens/auth-screens.md "Login" edge cases table.
const schema = z.object({
  email: z.string().email("Invalid email format"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

export const LoginForm: FC = () => {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const login = useAuthStore((s) => s.login);
  const [apiError, setApiError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (isAuthenticated) router.replace("/overview");
  }, [isAuthenticated, router]);

  const loginMutation = useMutation({
    mutationFn: (data: FormData) =>
      api.post<{ data: AuthTokensResult }>("/auth/login", data).then((r) => r.data.data),
    onSuccess: (result) => {
      login(result.token, result.refreshToken, result.user);
      router.push("/overview");
    },
    onError: (err: unknown) => {
      setApiError(loginErrorMessage(err));
    },
  });

  const onSubmit = (data: FormData) => {
    setApiError(null);
    loginMutation.mutate(data);
  };

  if (isAuthenticated) return null;

  return (
    <div className="w-full max-w-sm rounded-card border border-border bg-surface p-8">
      <Logo className="mb-8" />
      <h1 className="mb-6 font-display text-xl font-semibold text-text">Sign in</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate className="flex flex-col gap-4">
        <div>
          <label htmlFor="email" className="mb-1 block text-sm font-medium text-text2">
            Email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            aria-invalid={!!errors.email}
            {...register("email")}
          />
          {errors.email && (
            <p role="alert" className="mt-1 text-xs text-red">
              {errors.email.message}
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
            autoComplete="current-password"
            aria-invalid={!!errors.password}
            {...register("password")}
          />
          {errors.password && (
            <p role="alert" className="mt-1 text-xs text-red">
              {errors.password.message}
            </p>
          )}
        </div>

        {apiError && <ErrorBanner message={apiError} />}

        <Button type="submit" disabled={loginMutation.isPending} className="mt-2">
          {loginMutation.isPending ? "Signing in..." : "Sign in"}
        </Button>

        <div className="flex items-center justify-between text-sm text-text2">
          <Link href="/forgot-password" className="hover:text-text">
            Forgot password?
          </Link>
          <Link href="/register" className="hover:text-text">
            Create account
          </Link>
        </div>
      </form>
    </div>
  );
};

function loginErrorMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "response" in err) {
    const response = (err as { response?: { status?: number; data?: { message?: string } } })
      .response;
    if (!response) return "No internet connection.";
    if (response.status === 401) return "Invalid email or password";
    if (response.status === 429) return "Too many attempts. Try again in 15 minutes.";
    return response.data?.message ?? "Something went wrong. Please try again.";
  }
  return "No internet connection.";
}
