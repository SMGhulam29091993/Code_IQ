// Must load before any relative import below — @codeiq/db (imported transitively via ./app)
// reads process.env.DATABASE_URL synchronously at module-evaluation time to construct its
// Prisma driver adapter (see packages/db/src/index.ts).
import "dotenv/config";

import { app } from "./app";
import { reviewJobProcessor } from "./container";
import { startReviewWorker } from "./jobs/worker";
import { env } from "./lib/env";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

// Ordered startup sequence — see .ai/rules/architecture-rules.md "Startup sequence".
// Connecting Prisma/Redis before listening means a bad connection fails loudly at
// boot instead of surfacing as request-time errors under real traffic.
async function main() {
  await prisma.$connect();
  await redis.ping();

  startReviewWorker(reviewJobProcessor);

  app.listen(env.PORT, () => {
    console.log(`API listening on port ${env.PORT}`);
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
