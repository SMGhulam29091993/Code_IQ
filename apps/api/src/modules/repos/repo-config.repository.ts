import { prisma } from "@codeiq/db";
import { DEFAULT_REPO_CONFIG } from "./repo.types";
import type { IRepoConfigRepository, UpdateConfigInput } from "./repo.types";

export class RepoConfigRepository implements IRepoConfigRepository {
  findByRepoId(repoId: string) {
    return prisma.repoConfig.findUnique({ where: { repoId } });
  }

  // Explicit field values rather than relying on the Prisma column @default — see
  // .ai/memory/pitfalls.md for the schema.prisma vs. repos.md default drift on ignorePatterns.
  createDefault(repoId: string) {
    return prisma.repoConfig.create({
      data: {
        repoId,
        severityThreshold: DEFAULT_REPO_CONFIG.severityThreshold,
        enabledCategories: DEFAULT_REPO_CONFIG.enabledCategories,
        ignorePatterns: DEFAULT_REPO_CONFIG.ignorePatterns,
        reviewOnDraft: DEFAULT_REPO_CONFIG.reviewOnDraft,
        postSummaryComment: DEFAULT_REPO_CONFIG.postSummaryComment,
      },
    });
  }

  upsertPartial(repoId: string, patch: UpdateConfigInput) {
    return prisma.repoConfig.upsert({
      where: { repoId },
      create: {
        repoId,
        severityThreshold: patch.severityThreshold ?? DEFAULT_REPO_CONFIG.severityThreshold,
        enabledCategories: patch.enabledCategories ?? DEFAULT_REPO_CONFIG.enabledCategories,
        ignorePatterns: patch.ignorePatterns ?? DEFAULT_REPO_CONFIG.ignorePatterns,
        reviewOnDraft: patch.reviewOnDraft ?? DEFAULT_REPO_CONFIG.reviewOnDraft,
        postSummaryComment: patch.postSummaryComment ?? DEFAULT_REPO_CONFIG.postSummaryComment,
      },
      update: patch,
    });
  }
}
