# Déploiement Production de Meta Oracle sur Coolify (`meta-oracle.com`)

Ce guide décrit l'architecture multi-services de **Meta Oracle** et la procédure exacte de déploiement sur **Coolify v4** depuis ce monorepo `pnpm` sans perturber les dossiers historiques à la racine du dépôt (`poc-*`, `backend`, `simulator`, `card-compiler`).

---

## 1. Architecture DNS (`meta-oracle.com`)

Configurer quatre enregistrements `A` (ou `CNAME` selon votre registrar) pointant vers l'IP publique de votre serveur Coolify / Traefik :

| Sous-domaine / Enregistrement | Domaine complet | Service Monorepo | Port interne conteneur |
| :--- | :--- | :--- | :--- |
| `@` (ou `www` → redirection) | `https://meta-oracle.com` | `apps/web` (Nuxt 3 SSR Hub SEO) | `3000` |
| `sim` | `https://sim.meta-oracle.com` | `apps/sim` (Nuxt 3 Simulateur Monte-Carlo) | `3000` |
| `arena` | `https://arena.meta-oracle.com` | `apps/arena` (Nuxt 3 Arène IA Pythia) | `3000` |
| `api` | `https://api.meta-oracle.com` | `apps/api` (Fastify + PostgreSQL + Engine) | `3000` |

> **SSL / HTTPS** : Traefik (intégré à Coolify) génère automatiquement les certificats Let's Encrypt pour les 4 domaines.

---

## 2. Base de Données PostgreSQL Managée

1. Dans votre projet Coolify (environnement `production`), créez une ressource **Database → PostgreSQL 16**.
2. Nommez la base `meta_oracle_db` et copiez son URI de connexion interne Coolify (`DATABASE_URL`, par ex. `postgres://postgres:<password>@<postgres-service-uuid>:5432/meta_oracle_db`).
3. **Migrations et Seed automatiques** : le conteneur `api` démarre via `apps/api/docker-entrypoint.sh` :
   - `AUTO_MIGRATE=true` exécute `node dist/db/migrate.js` avec retries jusqu'à ce que PostgreSQL soit prêt.
   - `AUTO_SEED=true` exécute `node dist/scripts/seedCards.js` et `node dist/scripts/seedMetaDecks.js` pour peupler la base de cartes (854 cartes compilées) et les archétypes méta de référence.

---

## 3. Configuration des 4 Applications Coolify (Build Pack: `Dockerfile`)

Pour **chacun des 4 services**, définissez impérativement le **Base Directory** sur `/meta-oracle` afin que le contexte Docker inclue `pnpm-workspace.yaml`, `pnpm-lock.yaml` et les packages partagés (`packages/types`, `packages/engine`, `packages/ui`).

| Service | FQDN Coolify | Base Directory | Dockerfile Path | Ports Exposes | Healthcheck |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **API** (`@meta-oracle/api`) | `https://api.meta-oracle.com` | `/meta-oracle` | `/docker/api.Dockerfile` | `3000` | `GET /health` → `200 OK` |
| **Hub Web** (`@meta-oracle/web`) | `https://meta-oracle.com` | `/meta-oracle` | `/docker/web.Dockerfile` | `3000` | `GET /` → `200 OK` |
| **Simulateur** (`@meta-oracle/sim`) | `https://sim.meta-oracle.com` | `/meta-oracle` | `/docker/sim.Dockerfile` | `3000` | `GET /` → `200 OK` |
| **Arène IA** (`@meta-oracle/arena`) | `https://arena.meta-oracle.com` | `/meta-oracle` | `/docker/arena.Dockerfile` | `3000` | `GET /` → `200 OK` |

### Watch Paths recommandés (pour éviter les rebuilds inutiles)

Dans **Configuration → Advanced → Watch Paths** de chaque service Coolify :

- **API (`api.meta-oracle.com`)** :
  ```text
  meta-oracle/package.json
  meta-oracle/pnpm-lock.yaml
  meta-oracle/packages/types/**
  meta-oracle/packages/engine/**
  meta-oracle/apps/api/**
  meta-oracle/docker/api.Dockerfile
  ```
- **Web (`meta-oracle.com`)** :
  ```text
  meta-oracle/package.json
  meta-oracle/pnpm-lock.yaml
  meta-oracle/packages/types/**
  meta-oracle/packages/ui/**
  meta-oracle/apps/web/**
  meta-oracle/docker/web.Dockerfile
  ```
- **Simulateur (`sim.meta-oracle.com`)** :
  ```text
  meta-oracle/package.json
  meta-oracle/pnpm-lock.yaml
  meta-oracle/packages/types/**
  meta-oracle/packages/engine/**
  meta-oracle/packages/ui/**
  meta-oracle/apps/sim/**
  meta-oracle/docker/sim.Dockerfile
  ```
- **Arène (`arena.meta-oracle.com`)** :
  ```text
  meta-oracle/package.json
  meta-oracle/pnpm-lock.yaml
  meta-oracle/packages/types/**
  meta-oracle/packages/engine/**
  meta-oracle/packages/ui/**
  meta-oracle/apps/arena/**
  meta-oracle/docker/arena.Dockerfile
  ```

---

## 4. Variables d'Environnement par Service

### 4.1 Service `api.meta-oracle.com`

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgres://postgres:<SECRET>@<PG_INTERNAL_HOST>:5432/meta_oracle_db
AUTO_MIGRATE=true
AUTO_SEED=true
CORS_ORIGIN=https://meta-oracle.com,https://www.meta-oracle.com,https://sim.meta-oracle.com,https://arena.meta-oracle.com
GITHUB_TOKEN=<PAT_ISSUES_ONLY>
GITHUB_REPO_OWNER=<ORG_OU_COMPTE>
GITHUB_REPO_NAME=<DEPOT>
RATE_LIMIT_MAX_REPORTS_PER_HOUR=5
```

### 4.2 Services Front-End (`web`, `sim`, `arena`)

> **Important Nuxt 3** : les variables `NUXT_PUBLIC_*` sont lues **à l'exécution** par Nitro (`runtimeConfig.public`) ! Il n'est pas nécessaire de les injecter au build Docker, elles doivent être présentes dans l'onglet **Environment Variables** du runtime Coolify :

```env
NODE_ENV=production
PORT=3000
NITRO_PORT=3000
HOST=0.0.0.0
NUXT_PUBLIC_WEB_URL=https://meta-oracle.com
NUXT_PUBLIC_SIM_URL=https://sim.meta-oracle.com
NUXT_PUBLIC_ARENA_URL=https://arena.meta-oracle.com
NUXT_PUBLIC_API_URL=https://api.meta-oracle.com
```

---

## 5. Validation Locale Complète (Docker Compose & CLI Monorepo)

Avant de déclencher un déploiement sur Coolify :

```bash
# 1. Tests et builds de tout le monorepo (8 workspaces)
cd meta-oracle
pnpm install --frozen-lockfile
pnpm test
pnpm build

# 2. Validation locale multi-conteneurs (PostgreSQL + API + Web + Sim + Arena)
docker compose -f docker/docker-compose.yml up --build
```

Une fois démarré en local :
- Hub Web : `http://localhost:3001`
- Simulateur : `http://localhost:3002` (avec `?debug=true` pour débloquer l'inspecteur)
- Arène : `http://localhost:3003`
- API : `http://localhost:3000/health`
