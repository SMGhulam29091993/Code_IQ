import { prisma } from "@codeiq/db";
import type {
  CreateReviewInput,
  IReviewRepository,
  ListReviewsFilters,
  UpdateReviewInput,
} from "./review.types";

export class ReviewRepository implements IReviewRepository {
  // Scoped to reviews under repos whose installation belongs to userId — never a bare
  // Review.findMany. Same tenant-isolation stance as modules/repos (.ai/memory/pitfalls.md #005).
  async findManyForUser(userId: string, filters: ListReviewsFilters) {
    const where = {
      repo: { installation: { userId } },
      ...(filters.repoId ? { repoId: filters.repoId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
    };

    const [reviews, total] = await prisma.$transaction([
      prisma.review.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (filters.page - 1) * filters.limit,
        take: filters.limit,
      }),
      prisma.review.count({ where }),
    ]);

    return { reviews, total };
  }

  findById(reviewId: string) {
    return prisma.review.findUnique({
      where: { id: reviewId },
      include: { issues: true, repo: { include: { installation: { select: { userId: true } } } } },
    });
  }

  findByCoordinatorJobId(coordinatorJobId: string) {
    return prisma.review.findUnique({ where: { coordinatorJobId } });
  }

  create(input: CreateReviewInput) {
    return prisma.review.create({
      data: { ...input, status: "RUNNING" },
    });
  }

  update(reviewId: string, input: UpdateReviewInput) {
    // githubReviewId is BigInt at rest (schema.prisma — real GitHub review ids overflow a 32-bit
    // Int) but a plain number everywhere in the business/API layer (review.service.ts's
    // sanitizeReview converts back on the way out) — this is the one place the conversion
    // needs to happen, going in.
    const { githubReviewId, ...rest } = input;
    return prisma.review.update({
      where: { id: reviewId },
      data: {
        ...rest,
        ...(githubReviewId !== undefined ? { githubReviewId: BigInt(githubReviewId) } : {}),
      },
    });
  }

  countForUser(userId: string, filters: { repoId?: string; since?: Date }) {
    return prisma.review.count({
      where: {
        repo: { installation: { userId } },
        ...(filters.repoId ? { repoId: filters.repoId } : {}),
        ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
      },
    });
  }

  async countIssuesBySeverityForUser(userId: string, filters: { repoId?: string; since?: Date }) {
    const rows = await prisma.reviewIssue.groupBy({
      by: ["severity"],
      where: issueWhereForUser(userId, filters),
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.severity, r._count._all]));
  }

  async countIssuesByCategoryForUser(userId: string, filters: { repoId?: string; since?: Date }) {
    const rows = await prisma.reviewIssue.groupBy({
      by: ["category"],
      where: issueWhereForUser(userId, filters),
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.category, r._count._all]));
  }

  async countIssuesByDayForUser(userId: string, filters: { repoId?: string; since: Date }) {
    const rows = await prisma.reviewIssue.findMany({
      where: issueWhereForUser(userId, filters),
      select: { createdAt: true },
    });

    const counts = new Map<string, number>();
    for (const row of rows) {
      const day = row.createdAt.toISOString().slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async countReviewsByAuthorForInstallation(installationId: string, since: Date) {
    const rows = await prisma.review.groupBy({
      by: ["prAuthor"],
      where: { repo: { installationId }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.prAuthor, r._count._all]));
  }

  async incrementCompletedChunks(reviewId: string): Promise<void> {
    await prisma.review.update({
      where: { id: reviewId },
      data: { completedChunks: { increment: 1 } },
    });
  }
}

function issueWhereForUser(userId: string, filters: { repoId?: string; since?: Date }) {
  return {
    review: {
      repo: {
        installation: { userId },
        ...(filters.repoId ? { id: filters.repoId } : {}),
      },
    },
    ...(filters.since ? { createdAt: { gte: filters.since } } : {}),
  };
}
