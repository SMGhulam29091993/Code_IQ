// Re-exported from packages/db, which owns the actual singleton (globalThis cache) —
// see .ai/rules/architecture-rules.md "Infrastructure singleton pattern". Import from here
// within apps/api so every module has one canonical local import path.
export { prisma } from "@codeiq/db";
