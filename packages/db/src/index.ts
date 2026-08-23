import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/client";

// Prisma 7 removed `datasource.url` from schema.prisma — the runtime client now takes its
// connection via an explicit driver adapter instead. process.env.DATABASE_URL must already be
// populated by the time this module is evaluated (apps/api/src/server.ts imports ./lib/env,
// which loads dotenv, before anything that transitively imports this package — see
// .ai/rules/architecture-rules.md "Startup sequence").
function createPrismaClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required to construct the Prisma client (@codeiq/db).");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter, log: ["error"] });
}

// Singleton pattern — see .ai/rules/architecture-rules.md "Infrastructure singleton pattern".
// Survives hot-reload in dev without leaking connections; prod always gets a clean client.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

export * from "../generated/client";
