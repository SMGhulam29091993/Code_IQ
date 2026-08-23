import { prisma } from "@codeiq/db";
import type { IRepoRepository, ListReposFilters } from "./repo.types";

export class RepoRepository implements IRepoRepository {
  // `reviews: { take: 1, orderBy: createdAt desc }` gets the most recent review's timestamp
  // alongside the count in one query — .ai/knowledge/screens/dashboard-screens.md "Screen:
  // Repos List" shows a "last review" column the mockup has and the original response shape
  // didn't (added 2026-08-23).
  findManyForUser(userId: string, filters: ListReposFilters) {
    return prisma.repo
      .findMany({
        where: {
          installation: { userId },
          ...(filters.installationId ? { installationId: filters.installationId } : {}),
          ...(filters.isActive !== undefined ? { isActive: filters.isActive } : {}),
        },
        include: {
          config: true,
          _count: { select: { reviews: true } },
          reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
        },
      })
      .then((rows) =>
        rows.map(({ _count, reviews, ...repo }) => ({
          ...repo,
          reviewCount: _count.reviews,
          lastReviewAt: reviews[0]?.createdAt ?? null,
        }))
      );
  }

  async findByIdForUser(repoId: string) {
    const repo = await prisma.repo.findUnique({
      where: { id: repoId },
      include: {
        config: true,
        installation: { select: { userId: true, planTier: true } },
        reviews: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    });
    if (!repo) return null;
    const { reviews, ...rest } = repo;
    return { ...rest, lastReviewAt: reviews[0]?.createdAt ?? null };
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
