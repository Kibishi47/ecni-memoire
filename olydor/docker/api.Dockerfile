# syntax=docker/dockerfile:1.7
# ==============================================================================
# Dockerfile Multi-Stage — @olydor/api (https://api.olydor.app)
# Coolify Base Directory : /olydor
# Coolify Dockerfile Path: /docker/api.Dockerfile
# Port exposé            : 3000
# ==============================================================================

FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
WORKDIR /app

# --- Stage 1 : Build TypeScript (@olydor/types, engine, api) ---
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
COPY apps/api apps/api

RUN pnpm --filter @olydor/types build \
 && pnpm --filter @olydor/engine build \
 && pnpm --filter @olydor/api build

# Élagage des devDependencies tout en conservant les liens symboliques pnpm workspace
RUN CI=true pnpm prune --prod

# --- Stage 2 : Runtime Production minimaliste ---
FROM node:22-alpine AS runner
RUN apk add --no-cache wget
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0
ENV AUTO_MIGRATE=true
ENV AUTO_SEED=true

# Copier l'arbre de dépendances élagué + artefacts compilés + données SQL/JSON
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=builder /app/node_modules ./node_modules

COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist

COPY --from=builder /app/packages/engine/package.json ./packages/engine/package.json
COPY --from=builder /app/packages/engine/dist ./packages/engine/dist

COPY --from=builder /app/apps/api/package.json ./apps/api/package.json
COPY --from=builder /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=builder /app/apps/api/dist ./apps/api/dist
COPY --from=builder /app/apps/api/meta_decks ./apps/api/meta_decks
COPY --from=builder /app/apps/api/src/migrations ./apps/api/src/migrations
COPY --from=builder /app/apps/api/docker-entrypoint.sh ./apps/api/docker-entrypoint.sh

RUN chmod +x /app/apps/api/docker-entrypoint.sh

WORKDIR /app/apps/api
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
