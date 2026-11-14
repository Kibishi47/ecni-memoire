# ==============================================================================
# Dockerfile racine pour déploiement Coolify (Base Directory: /)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Force NODE_ENV=development pour installer typescript et les devDependencies
ENV NODE_ENV=development

# Installation des dépendances du backend
COPY backend/package*.json ./
RUN npm ci --include=dev

# Compilation TypeScript
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# Élagage des dépendances de développement
RUN npm prune --omit=dev

# ==============================================================================
# Image d'exécution de production
# ==============================================================================
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

COPY --chown=node:node backend/src/migrations ./src/migrations
COPY --chown=node:node backend/src/migrations ./dist/migrations
COPY --chown=node:node backend/meta_decks ./meta_decks

COPY --chown=node:node backend/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
