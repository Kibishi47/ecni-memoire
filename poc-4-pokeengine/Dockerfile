# ==============================================================================
# Stage 1 — Build de l'application Vue 3 + TypeScript + Web Workers (Vite)
# ==============================================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Installation déterministe des dépendances avec cache Docker
COPY package.json package-lock.json ./
RUN npm ci

# Copie du code source (incluant ./src et ./go-engine pour les imports ?raw)
COPY . .

# Vérification du typage (vue-tsc) et build de production (bundle + Web Worker)
RUN npm run build

# ==============================================================================
# Stage 2 — Serveur de production Nginx ultra-léger (Compatible Coolify)
# ==============================================================================
FROM nginx:1.27-alpine AS production

# Configuration Nginx optimisée pour SPA Vue 3, Web Workers ES et Gzip
RUN cat <<'EOF' > /etc/nginx/conf.d/default.conf
server {
    listen 80;
    server_name _;

    root /usr/share/nginx/html;
    index index.html;

    # Compression Gzip pour les bundles JS, Web Workers et JSON
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types
        text/plain
        text/css
        text/javascript
        application/javascript
        application/json
        application/manifest+json
        application/wasm
        image/svg+xml;

    # Cache long terme sur les assets hashés par Vite (inclut simulation.worker-*.js)
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    # Endpoint de Healthcheck pour Coolify
    location = /healthz {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "OK";
    }

    # Fallback SPA
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF

# Copie des fichiers compilés depuis le stage builder
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -qO- http://127.0.0.1:80/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
