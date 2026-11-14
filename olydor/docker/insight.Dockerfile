# syntax=docker/dockerfile:1.7
# ==============================================================================
# Dockerfile Multi-Stage — @olydor/insight (https://insight.olydor.app)
# Coolify Base Directory : /olydor
# Coolify Dockerfile Path: /docker/insight.Dockerfile
# Port exposé            : 3000
# ==============================================================================

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# --- Stage 1 : Build Nuxt 3 + Workers ES (.output Nitro autonome) ---
FROM base AS builder
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/types/package.json packages/types/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/insight/package.json apps/insight/package.json
COPY apps/arena/package.json apps/arena/package.json

RUN pnpm install --frozen-lockfile

COPY packages/types packages/types
COPY packages/engine packages/engine
COPY packages/ui packages/ui
COPY apps/insight apps/insight

RUN pnpm --filter @olydor/types build \
 && pnpm --filter @olydor/engine build \
 && pnpm --filter @olydor/insight build

# --- Stage 2 : Runtime Nitro ultra-léger ---
FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV NITRO_PORT=3000
ENV HOST=0.0.0.0
ENV NITRO_HOST=0.0.0.0

COPY --from=builder /app/apps/insight/.output ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ || exit 1

CMD ["node", "server/index.mjs"]
