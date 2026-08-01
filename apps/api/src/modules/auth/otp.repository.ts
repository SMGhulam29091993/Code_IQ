import { prisma } from "@codeiq/db";
import type { IOtpRepository } from "./auth.types";

export class OtpRepository implements IOtpRepository {
  upsertForUser(
    userId: string,
    data: { hashedIdentifier: string; hashedOtp: string; expiresAt: Date }
  ) {
    return prisma.otp.upsert({
      where: { userId },
      create: { userId, ...data },
      update: data,
    });
  }

  findByHashedIdentifier(hashedIdentifier: string) {
    return prisma.otp.findUnique({ where: { hashedIdentifier } });
  }

  async deleteById(id: string) {
    // No-op if already deleted — verify-otp's failure path must stay idempotent.
    await prisma.otp.deleteMany({ where: { id } });
  }
}
