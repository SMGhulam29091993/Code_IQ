import { prisma } from "@codeiq/db";
import type { IInstallationRepository } from "./github.types";

export class InstallationRepository implements IInstallationRepository {
  findByGithubId(githubInstallationId: number) {
    return prisma.installation.findUnique({ where: { githubInstallationId } });
  }

  findById(id: string) {
    return prisma.installation.findUnique({ where: { id } });
  }

  upsert(data: {
    githubInstallationId: number;
    accountLogin: string;
    accountType: string;
    userId: string;
  }) {
    return prisma.installation.upsert({
      where: { githubInstallationId: data.githubInstallationId },
      create: { ...data, isActive: true },
      update: {
        accountLogin: data.accountLogin,
        accountType: data.accountType,
        isActive: true,
      },
    });
  }

  async findManyActiveForUser(userId: string) {
    const installations = await prisma.installation.findMany({
      where: { userId, isActive: true },
      include: { _count: { select: { repos: true } } },
    });
    return installations.map(({ _count, ...installation }) => ({
      ...installation,
      repoCount: _count.repos,
    }));
  }

  async softDelete(id: string) {
    await prisma.installation.update({ where: { id }, data: { isActive: false } });
  }

  async updateActiveByGithubId(githubInstallationId: number, isActive: boolean) {
    // No-op if the installation is unknown to us — GitHub can send events for
    // installations we never recorded (e.g. app uninstalled before /install completed).
    await prisma.installation.updateMany({ where: { githubInstallationId }, data: { isActive } });
  }
}
