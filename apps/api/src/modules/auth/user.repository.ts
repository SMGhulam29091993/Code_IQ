import { prisma, UserStatus } from "@codeiq/db";
import type { IUserRepository } from "./auth.types";

export class UserRepository implements IUserRepository {
  findByEmail(email: string) {
    return prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return prisma.user.findUnique({ where: { id } });
  }

  create(data: { email: string; name: string; passwordHash: string }) {
    return prisma.user.create({ data });
  }

  async updateLastLogin(id: string) {
    await prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  async lockEmail(id: string) {
    await prisma.user.update({ where: { id }, data: { status: UserStatus.LOCKED } });
  }
}
