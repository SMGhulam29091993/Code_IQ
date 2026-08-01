import { prisma } from "@codeiq/db";
import type { IRefreshTokenRepository } from "./auth.types";

export class RefreshTokenRepository implements IRefreshTokenRepository {
  async create(data: { userId: string; token: string; expiresAt: Date }) {
    await prisma.refreshToken.create({ data });
  }

  findByToken(token: string) {
    return prisma.refreshToken.findUnique({
      where: { token },
      select: { id: true, userId: true },
    });
  }

  async deleteByToken(token: string) {
    // No-op if not found — logout/refresh rotation must stay idempotent.
    await prisma.refreshToken.deleteMany({ where: { token } });
  }
}
