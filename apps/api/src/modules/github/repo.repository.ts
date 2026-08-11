import { prisma } from "@codeiq/db";
import type { IRepoLookupRepository } from "./github.types";

// See the "narrow Repo-table accessor" comment on IRepoLookupRepository in github.types.ts.
export class RepoLookupRepository implements IRepoLookupRepository {
  findByGithubId(githubRepoId: number) {
    return prisma.repo.findUnique({ where: { githubRepoId }, include: { config: true } });
  }

  async deactivateByGithubId(githubRepoId: number) {
    await prisma.repo.updateMany({ where: { githubRepoId }, data: { isActive: false } });
  }

  async deactivateAllForInstallation(installationId: string) {
    await prisma.repo.updateMany({ where: { installationId }, data: { isActive: false } });
  }

  countReviewsThisMonth(installationId: string) {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    return prisma.review.count({
      where: { repo: { installationId }, createdAt: { gte: startOfMonth } },
    });
  }

  async upsertFromGithub(data: {
    githubRepoId: number;
    fullName: string;
    language: string | null;
    installationId: string;
  }) {
    await prisma.repo.upsert({
      where: { githubRepoId: data.githubRepoId },
      create: {
        githubRepoId: data.githubRepoId,
        fullName: data.fullName,
        language: data.language,
        installationId: data.installationId,
      },
      update: { fullName: data.fullName, language: data.language },
    });
  }
}
