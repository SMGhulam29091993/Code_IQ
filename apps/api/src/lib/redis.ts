import Redis from "ioredis";
import { env } from "./env";

// Same singleton pattern as src/lib/prisma.ts — see .ai/rules/architecture-rules.md.
const globalForRedis = globalThis as unknown as { redis?: Redis };

export const redis = globalForRedis.redis ?? new Redis(env.REDIS_URL);

if (env.NODE_ENV !== "production") globalForRedis.redis = redis;
