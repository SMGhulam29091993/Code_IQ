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

  async findActiveIdsForInstallationByRecency(installationId: string) {
    const rows = await prisma.repo.findMany({
      where: { installationId, isActive: true },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  async setActiveMany(repoIds: string[], isActive: boolean) {
    if (repoIds.length === 0) return;
    await prisma.repo.updateMany({ where: { id: { in: repoIds } }, data: { isActive } });
  }
}
