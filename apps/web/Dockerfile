# Build context is the monorepo root: docker build -f apps/web/Dockerfile .
# (turbo prune needs the full workspace to compute @codeiq/web's dependency subset.)

FROM node:22-alpine AS base
RUN corepack enable
ENV CI=true

# ---- Prune: compute the minimal workspace subset @codeiq/web actually depends on ----
FROM base AS pruner
WORKDIR /app
COPY . .
RUN npx turbo prune @codeiq/web --docker

# ---- Install + build ----
FROM base AS builder
WORKDIR /app
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm install --frozen-lockfile
COPY --from=pruner /app/out/full/ .
# Next reads NEXT_PUBLIC_* vars at build time — pass through as a build arg.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN pnpm turbo run build --filter=@codeiq/web

# ---- Runtime: Next.js standalone output, non-root user ----
FROM base AS runner
WORKDIR /app
RUN addgroup --system --gid 1001 nodejs && adduser --system --uid 1001 nextjs

# `output: "standalone"` (next.config.js) traces the minimal node_modules subset into
# .next/standalone — no full node_modules copy or pnpm install needed at runtime.
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs
EXPOSE 3000
ENV PORT=3000
CMD ["node", "apps/web/server.js"]
