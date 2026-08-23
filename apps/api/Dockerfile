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

# ---- Build: full (dev+prod) install, generate Prisma client, compile TS ----
FROM base AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
RUN pnpm turbo run build --filter=@codeiq/api

# ---- Install: separate, prod-only install in a clean tree. `pnpm install --prod` in the
# builder stage above removes devDependency *symlinks* but not their content already fetched
# into node_modules/.pnpm — a fresh install here never fetches them in the first place. ----
FROM base AS installer
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --prod --frozen-lockfile
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/packages/db/dist ./packages/db/dist
COPY --from=builder /app/packages/db/generated ./packages/db/generated
COPY --from=builder /app/packages/types/dist ./packages/types/dist

# ---- Runtime: minimal image, non-root user ----
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 expressjs

COPY --from=installer --chown=expressjs:nodejs /app .

USER expressjs
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
