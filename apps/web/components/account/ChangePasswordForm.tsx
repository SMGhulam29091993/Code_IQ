"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type FC, useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { useChangePassword } from "@/hooks/useAccount";
import { getApiErrorStatus, getErrorMessage } from "@/lib/utils";

const schema = z
  .object({
    currentPassword: z.string().min(1, "Current password is required"),
    newPassword: z
      .string()
      .min(8, "Password must be at least 8 characters")
      .max(128, "Password too long"),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: "Passwords do not match",
    path: ["confirmPassword"],
  });
type FormData = z.infer<typeof schema>;

// .ai/knowledge/screens/account-screens.md "Screen: Account" — Profile tab. Only rendered by
// the caller when user.githubId is null (real password account) — matches the backend's own
// rejection of POST /auth/change-password for GitHub-only accounts.
export const ChangePasswordForm: FC = () => {
  const changePasswordMutation = useChangePassword();
  const [apiError, setApiError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors, isDirty },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  function onSubmit(data: FormData) {
    setApiError(null);
    changePasswordMutation.mutate(
      { currentPassword: data.currentPassword, newPassword: data.newPassword },
      {
        onSuccess: () => reset(),
        onError: (err) => {
          if (getApiErrorStatus(err) === 401) {
            setError("currentPassword", { message: "Current password is incorrect" });
          } else {
            setApiError(getErrorMessage(err));
          }
        },
      }
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      noValidate
      className="flex max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-5"
    >
      <h2 className="font-display text-sm font-semibold text-text">Change password</h2>

      <div>
        <label htmlFor="currentPassword" className="mb-1 block text-sm font-medium text-text2">
          Current password
        </label>
        <Input
          id="currentPassword"
          type="password"
          autoComplete="current-password"
          aria-invalid={!!errors.currentPassword}
          {...register("currentPassword")}
        />
        {errors.currentPassword && (
          <p role="alert" className="mt-1 text-xs text-red">
            {errors.currentPassword.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-text2">
          New password
        </label>
        <Input
          id="newPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.newPassword}
          {...register("newPassword")}
        />
        {errors.newPassword && (
          <p role="alert" className="mt-1 text-xs text-red">
            {errors.newPassword.message}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-text2">
          Confirm new password
        </label>
        <Input
          id="confirmPassword"
          type="password"
          autoComplete="new-password"
          aria-invalid={!!errors.confirmPassword}
          {...register("confirmPassword")}
        />
        {errors.confirmPassword && (
          <p role="alert" className="mt-1 text-xs text-red">
            {errors.confirmPassword.message}
          </p>
        )}
      </div>

      {apiError && <ErrorBanner message={apiError} />}
      {changePasswordMutation.isSuccess && !isDirty && (
        <p className="text-xs text-green">Password updated.</p>
      )}

      <Button type="submit" disabled={changePasswordMutation.isPending} className="self-start">
        {changePasswordMutation.isPending ? "Updating..." : "Update password"}
      </Button>
    </form>
  );
};
