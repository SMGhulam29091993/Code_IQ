"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type FC, useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import type { User } from "@codeiq/types";
import { Button } from "@/components/ui/Button";
import { ErrorBanner } from "@/components/ui/ErrorBanner";
import { Input } from "@/components/ui/Input";
import { useUpdateProfile } from "@/hooks/useAccount";
import { getErrorMessage } from "@/lib/utils";

interface ProfileFormProps {
  user: User;
}

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100, "Name too long"),
});
type FormData = z.infer<typeof schema>;

// .ai/knowledge/screens/account-screens.md "Screen: Account" — Profile tab. Email is
// deliberately read-only, not an input — see PATCH /auth/me's doc note.
export const ProfileForm: FC<ProfileFormProps> = ({ user }) => {
  const updateMutation = useUpdateProfile();
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isDirty },
  } = useForm<FormData>({ resolver: zodResolver(schema), defaultValues: { name: user.name } });

  useEffect(() => reset({ name: user.name }), [user.name, reset]);

  return (
    <form
      onSubmit={handleSubmit((data) => updateMutation.mutate(data, { onSuccess: () => reset(data) }))}
      noValidate
      className="flex max-w-md flex-col gap-4 rounded-card border border-border bg-surface p-5"
    >
      <div>
        <label htmlFor="name" className="mb-1 block text-sm font-medium text-text2">
          Name
        </label>
        <Input id="name" aria-invalid={!!errors.name} {...register("name")} />
        {errors.name && (
          <p role="alert" className="mt-1 text-xs text-red">
            {errors.name.message}
          </p>
        )}
      </div>

      <div>
        <span className="mb-1 block text-sm font-medium text-text2">Email</span>
        <p className="text-sm text-text">{user.email}</p>
      </div>

      <p className="text-xs text-text3">
        Member since{" "}
        {new Date(user.createdAt).toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        })}
      </p>

      {updateMutation.isError && <ErrorBanner message={getErrorMessage(updateMutation.error)} />}
      {updateMutation.isSuccess && !isDirty && (
        <p className="text-xs text-green">Saved.</p>
      )}

      <Button type="submit" disabled={!isDirty || updateMutation.isPending} className="self-start">
        {updateMutation.isPending ? "Saving..." : "Save"}
      </Button>
    </form>
  );
};
