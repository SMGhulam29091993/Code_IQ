import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { Repo, RepoConfig, RepoStats } from "@codeiq/types";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";

interface RepoFilters {
  installationId?: string;
  isActive?: boolean;
}

// .ai/knowledge/technical/frontend/hooks-and-utils.md "useRepos".
export const useRepos = (filters?: RepoFilters) =>
  useQuery({
    queryKey: queryKeys.repos(filters?.installationId),
    queryFn: () =>
      api
        .get<{ data: { repos: Repo[] } }>("/repos", { params: filters })
        .then((r) => r.data.data.repos),
  });

export const useRepo = (repoId: string) =>
  useQuery({
    queryKey: queryKeys.repo(repoId),
    queryFn: () => api.get<{ data: { repo: Repo } }>(`/repos/${repoId}`).then((r) => r.data.data.repo),
    enabled: !!repoId,
  });

interface ActivateContext {
  prev?: Repo[];
}

// Optimistic update — see .ai/knowledge/screens/dashboard-screens.md "Screen: Repos List".
export const useActivateRepo = () => {
  const qc = useQueryClient();
  return useMutation<Repo, unknown, string, ActivateContext>({
    mutationFn: (repoId) =>
      api.post<{ data: { repo: Repo } }>(`/repos/${repoId}/activate`).then((r) => r.data.data.repo),
    onMutate: async (repoId) => {
      await qc.cancelQueries({ queryKey: ["repos"] });
      const prev = qc.getQueryData<Repo[]>(queryKeys.repos());
      qc.setQueryData<Repo[]>(queryKeys.repos(), (old) =>
        old?.map((r) => (r.id === repoId ? { ...r, isActive: true } : r))
      );
      return { prev };
    },
    onError: (_err, _repoId, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.repos(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
};

export const useDeactivateRepo = () => {
  const qc = useQueryClient();
  return useMutation<Repo, unknown, string, ActivateContext>({
    mutationFn: (repoId) =>
      api
        .post<{ data: { repo: Repo } }>(`/repos/${repoId}/deactivate`)
        .then((r) => r.data.data.repo),
    onMutate: async (repoId) => {
      await qc.cancelQueries({ queryKey: ["repos"] });
      const prev = qc.getQueryData<Repo[]>(queryKeys.repos());
      qc.setQueryData<Repo[]>(queryKeys.repos(), (old) =>
        old?.map((r) => (r.id === repoId ? { ...r, isActive: false } : r))
      );
      return { prev };
    },
    onError: (_err, _repoId, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKeys.repos(), ctx.prev);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["repos"] }),
  });
};

export const useRepoConfig = (repoId: string) =>
  useQuery({
    queryKey: queryKeys.repoConfig(repoId),
    queryFn: () =>
      api
        .get<{ data: { config: RepoConfig } }>(`/repos/${repoId}/config`)
        .then((r) => r.data.data.config),
    enabled: !!repoId,
  });

export const useUpdateRepoConfig = (repoId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<RepoConfig>) =>
      api
        .patch<{ data: { config: RepoConfig } }>(`/repos/${repoId}/config`, body)
        .then((r) => r.data.data.config),
    onSuccess: (config) => qc.setQueryData(queryKeys.repoConfig(repoId), config),
  });
};

export const useRepoStats = (repoId: string) =>
  useQuery({
    queryKey: queryKeys.repoStats(repoId),
    queryFn: () =>
      api.get<{ data: RepoStats }>(`/repos/${repoId}/stats`).then((r) => r.data.data),
    enabled: !!repoId,
  });
