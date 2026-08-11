import { prisma } from "@codeiq/db";
import type { IRepoRepository, ListReposFilters } from "./repo.types";

export class RepoRepository implements IRepoRepository {
  findManyForUser(userId: string, filters: ListReposFilters) {
    return prisma.repo
      .findMany({
        where: {
          installation: { userId },
          ...(filters.installationId ? { installationId: filters.installationId } : {}),
          ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
        },
        include: { config: true, _count: { select: { reviews: true } } },
      })
      .then((rows) =>
        rows.map(({ _count, ...repo }) => ({ ...repo, reviewCount: _count.reviews }))
      );
  }

  findByIdForUser(repoId: string) {
    return prisma.repo.findUnique({
      where: { id: repoId },
      include: { config: true, installation: { select: { userId: true, planTier: true } } },
    });
  }

  async setActive(repoId: string, isActive: boolean) {
    await prisma.repo.update({ where: { id: repoId }, data: { isActive } });
  }

  countActiveForInstallation(installationId: string) {
    return prisma.repo.count({ where: { installationId, isActive: true } });
  }

  countReviews(repoId: string) {
    return prisma.review.count({ where: { repoId } });
  }
}
