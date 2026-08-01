import { PrismaClient } from "@prisma/client";

// Singleton pattern — see .ai/rules/architecture-rules.md "Infrastructure singleton pattern".
// Survives hot-reload in dev without leaking connections; prod always gets a clean client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ log: ["error"] });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "@prisma/client";
