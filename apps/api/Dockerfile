# Build context is the monorepo root: docker build -f apps/api/Dockerfile .
# (turbo prune needs the full workspace to compute @codeiq/api's dependency subset.)

FROM node:22-alpine AS base
RUN corepack enable
ENV CI=true

# ---- Prune: compute the minimal workspace subset @codeiq/api actually depends on ----
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @codeiq/api --docker

# ---- Install + build: install pruned deps, generate Prisma client, compile TS ----
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++ openssl
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@codeiq/api

# Drop dev dependencies (build tools, TS, test libs, prisma CLI) — keep only what's
# needed to run dist/server.js, including the Prisma client generated above.
RUN pnpm install --prod --frozen-lockfile

# ---- Runtime: minimal image, non-root user ----
FROM base AS runner
RUN apk add --no-cache openssl
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 expressjs

COPY --from=builder --chown=expressjs:nodejs /app .

USER expressjs
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
