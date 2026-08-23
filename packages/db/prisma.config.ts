// Prisma CLI config (migrate/studio/generate). Loads apps/api/.env directly — the single
// source of truth for DATABASE_URL — instead of relying on Prisma's legacy convention of
// auto-discovering a .env file next to this package's schema.prisma.
import path from "node:path";
import dotenv from "dotenv";
import { defineConfig } from "prisma/config";

dotenv.config({ path: path.resolve(__dirname, "../../apps/api/.env") });

// `generate` only needs the schema shape, never a live connection — apps/api/.env is
// deliberately absent from Docker build contexts (.dockerignore), so this must not throw
// there. `migrate`/`studio`/`db push` DO need a real DATABASE_URL; run those with apps/api/.env
// present (or DATABASE_URL exported) — they'll fail with Postgres's own connection error
// otherwise, which is a clear enough signal.
const databaseUrl = process.env.DATABASE_URL?.trim() || "postgresql://unset:unset@localhost:5432/unset";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: databaseUrl,
  },
});
