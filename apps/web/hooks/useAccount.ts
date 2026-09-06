import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { User } from "@codeiq/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

// .ai/knowledge/domains/auth.md "GET /auth/me" / "PATCH /auth/me" / "POST /auth/change-password".
export const useMe = () =>
  useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.get<{ data: { user: User } }>("/auth/me").then((r) => r.data.data.user),
  });

export const useUpdateProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string }) =>
      api.patch<{ data: { user: User } }>("/auth/me", body).then((r) => r.data.data.user),
    onSuccess: (user) => qc.setQueryData(queryKeys.me, user),
  });
};

export const useChangePassword = () =>
  useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) =>
      api.post("/auth/change-password", body),
  });
