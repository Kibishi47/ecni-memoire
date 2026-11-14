# ==============================================================================
# Étape 1 : Construction (TypeScript -> JavaScript)
# ==============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Installation des dépendances (y compris devDependencies pour compiler TypeScript)
COPY package*.json ./
RUN npm ci

# Copie de la configuration et des sources TypeScript
COPY tsconfig.json ./
COPY src ./src

# Compilation TypeScript vers dist/
RUN npm run build

# Suppression des devDependencies pour ne garder que le strict nécessaire
RUN npm prune --omit=dev

# ==============================================================================
# Étape 2 : Image d'exécution de production (légère et sécurisée)
# ==============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

# Variables d'environnement par défaut
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Copie des modules de production et des artefacts compilés
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/package.json ./package.json

# Copie des fichiers SQL de migrations et des données de decks méta
COPY --chown=node:node src/migrations ./src/migrations
COPY --chown=node:node src/migrations ./dist/migrations
COPY --chown=node:node meta_decks ./meta_decks

# Script d'entrypoint (gestion des migrations automatiques au boot)
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# Exécution avec l'utilisateur non-root standard 'node'
USER node

# Port exposé pour Coolify
EXPOSE 3000

# Vérification de santé native via Node.js fetch (aucun package externe requis)
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

# Point d'entrée avec migrations automatiques et démarrage du serveur Fastify
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/server.js"]
