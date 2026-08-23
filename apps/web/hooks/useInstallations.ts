import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Installation } from "@codeiq/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

// .ai/knowledge/technical/frontend/hooks-and-utils.md "useInstallations".
export const useInstallations = () =>
  useQuery({
    queryKey: queryKeys.installations,
    queryFn: () =>
      api.get<{ data: { installations: Installation[] } }>("/github/installations").then(
        (r) => r.data.data.installations
      ),
  });

// POST /github/install — .ai/knowledge/domains/github-app.md. Called from the Onboarding
// screen once GitHub redirects back with `?installation_id=`.
export const useSaveInstallation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installationId: number) =>
      api
        .post<{ data: { installation: Installation } }>("/github/install", { installationId })
        .then((r) => r.data.data.installation),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.installations }),
  });
};

// Shared header breadcrumb across every dashboard page — the mockup shows the installation's
// account login (e.g. "acme-corp") as the crumb on Overview/Repos/Reviews/Billing. Used with
// components/layout/PageHeader.tsx.
export const useAccountLogin = () => {
  const { data: installations } = useInstallations();
  return installations?.[0]?.accountLogin;
};

// DELETE /github/installations/:id — .ai/knowledge/screens/account-screens.md "Workspace tab".
export const useDeleteInstallation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (installationId: string) => api.delete(`/github/installations/${installationId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: queryKeys.installations }),
  });
};
