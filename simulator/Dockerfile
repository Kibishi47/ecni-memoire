# ==============================================================================
# Stage 1 — Build de l'application (Vite + Vue 3 + TypeScript + Web Workers)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Mise en cache optimale des dependances npm
COPY package.json package-lock.json ./
RUN npm ci

# Copie du code source complet du simulateur
COPY . .

# URL publique du backend injectee au moment du build Vite (vide = meme origine / proxy)
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

# Compilation de production (catalogue charge dynamiquement via l'API backend)
RUN npm run build

# ==============================================================================
# Stage 2 — Serveur web Nginx ultra-leger (Optimise pour Coolify)
# ==============================================================================
FROM nginx:1.27-alpine AS production

# Configuration Nginx personnalisee (Gzip, SPA fallback, cache, healthcheck)
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copie des artefacts compiles depuis le stage builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

# Healthcheck natif compatible Coolify
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
