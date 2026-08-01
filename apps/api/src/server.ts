import { app } from "./app";
import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

// Ordered startup sequence — see .ai/rules/architecture-rules.md "Startup sequence".
// Connecting Prisma/Redis before listening means a bad connection fails loudly at
// boot instead of surfacing as request-time errors under real traffic.
async function main() {
  await prisma.$connect();
  await redis.ping();

  // BullMQ workers register here starting in .ai/plans/backend.md Step 5.

  app.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
