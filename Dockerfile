# ==============================================================================
# Stage 1 — Build de l'application (Vite + Vue 3 + TypeScript + Web Workers)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Mise en cache optimale des dependances npm
COPY simulator/package.json simulator/package-lock.json ./simulator/

WORKDIR /app/simulator
RUN npm ci

# Copie des sources du simulateur et des bases de cartes
WORKDIR /app
COPY simulator ./simulator
COPY card-compiler/data ./card-compiler/data

WORKDIR /app/simulator
RUN npm run build

# ==============================================================================
# Stage 2 — Serveur web Nginx ultra-leger (Optimise pour Coolify)
# ==============================================================================
FROM nginx:1.27-alpine AS production

COPY simulator/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/simulator/dist /usr/share/nginx/html

EXPOSE 80

# Healthcheck natif compatible Coolify
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
