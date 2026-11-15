# Déploiement Production d’Olydor sur Coolify (`olydor.app`)

Ce guide décrit l'architecture multi-services d’**Olydor** et la procédure exacte de déploiement sur **Coolify v4** depuis ce monorepo `pnpm` sans perturber les dossiers historiques à la racine du dépôt (`poc-*`, `presentation`).

---

## 1. Architecture DNS (`olydor.app`)

Configurer quatre enregistrements `A` (ou `CNAME` selon votre registrar) pointant vers l'IP publique de votre serveur Coolify / Traefik :

| Sous-domaine / Enregistrement | Domaine complet | Service Monorepo | Port interne conteneur |
| :--- | :--- | :--- | :--- |
| `@` (ou `www` → redirection) | `https://olydor.app` | `apps/web` (Nuxt 3 SSR Hub SEO) | `3000` |
| `insight` | `https://insight.olydor.app` | `apps/insight` (Nuxt 3 Simulateur Monte-Carlo) | `3000` |
| `arena` | `https://arena.olydor.app` | `apps/arena` (Nuxt 3 Arène IA Pythia) | `3000` |
| `api` | `https://api.olydor.app` | `apps/api` (Fastify + PostgreSQL + Engine) | `3000` |

> **SSL / HTTPS** : Traefik (intégré à Coolify) génère automatiquement les certificats Let's Encrypt pour les 4 domaines.

---

## 2. Base de Données PostgreSQL Managée

1. Dans votre projet Coolify (environnement `production`), créez une ressource **Database → PostgreSQL 16**.
2. Nommez la base `olydor_db` et copiez son URI de connexion interne Coolify (`DATABASE_URL`, par ex. `postgres://postgres:<password>@<postgres-service-uuid>:5432/olydor_db`).
3. **Migrations et Seed automatiques** : le conteneur `api` démarre via `apps/api/docker-entrypoint.sh` :
   - `AUTO_MIGRATE=true` exécute `node dist/db/migrate.js` avec retries jusqu'à ce que PostgreSQL soit prêt.
   - `AUTO_SEED=true` exécute `node dist/scripts/seedCards.js` et `node dist/scripts/seedMetaDecks.js` pour peupler la base de cartes (854 cartes compilées) et les archétypes méta de référence.

---

## 3. Configuration des 4 Applications Coolify (Build Pack: `Dockerfile`)

Pour **chacun des 4 services**, définissez impérativement le **Base Directory** sur `/olydor` afin que le contexte Docker inclue `pnpm-workspace.yaml`, `pnpm-lock.yaml` et les packages partagés (`packages/types`, `packages/engine`, `packages/ui`).

| Service | FQDN Coolify | Base Directory | Dockerfile Path | Ports Exposes | Healthcheck |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **API** (`@olydor/api`) | `https://api.olydor.app` | `/olydor` | `/docker/api.Dockerfile` | `3000` | `GET /health` → `200 OK` |
| **Hub Web** (`@olydor/web`) | `https://olydor.app` | `/olydor` | `/docker/web.Dockerfile` | `3000` | `GET /` → `200 OK` |
| **Simulateur** (`@olydor/insight`) | `https://insight.olydor.app` | `/olydor` | `/docker/insight.Dockerfile` | `3000` | `GET /` → `200 OK` |
| **Arène IA** (`@olydor/arena`) | `https://arena.olydor.app` | `/olydor` | `/docker/arena.Dockerfile` | `3000` | `GET /` → `200 OK` |

### Watch Paths recommandés (pour éviter les rebuilds inutiles)

Dans **Configuration → Advanced → Watch Paths** de chaque service Coolify :

- **API (`api.olydor.app`)** :
  ```text
  olydor/package.json
  olydor/pnpm-lock.yaml
  olydor/packages/types/**
  olydor/packages/engine/**
  olydor/apps/api/**
  olydor/docker/api.Dockerfile
  ```
- **Web (`olydor.app`)** :
  ```text
  olydor/package.json
  olydor/pnpm-lock.yaml
  olydor/packages/types/**
  olydor/packages/ui/**
  olydor/apps/web/**
  olydor/docker/web.Dockerfile
  ```
- **Simulateur (`insight.olydor.app`)** :
  ```text
  olydor/package.json
  olydor/pnpm-lock.yaml
  olydor/packages/types/**
  olydor/packages/engine/**
  olydor/packages/ui/**
  olydor/apps/insight/**
  olydor/docker/insight.Dockerfile
  ```
- **Arène (`arena.olydor.app`)** :
  ```text
  olydor/package.json
  olydor/pnpm-lock.yaml
  olydor/packages/types/**
  olydor/packages/engine/**
  olydor/packages/ui/**
  olydor/apps/arena/**
  olydor/docker/arena.Dockerfile
  ```

---

## 4. Variables d'Environnement par Service

### 4.1 Service `api.olydor.app`

```env
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_URL=postgres://postgres:<SECRET>@<PG_INTERNAL_HOST>:5432/olydor_db
AUTO_MIGRATE=true
AUTO_SEED=true
CORS_ORIGIN=https://olydor.app,https://www.olydor.app,https://insight.olydor.app,https://arena.olydor.app
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
NUXT_PUBLIC_WEB_URL=https://olydor.app
NUXT_PUBLIC_INSIGHT_URL=https://insight.olydor.app
NUXT_PUBLIC_ARENA_URL=https://arena.olydor.app
NUXT_PUBLIC_API_URL=https://api.olydor.app
```

---

## 5. Validation Locale Complète (Docker Compose & CLI Monorepo)

Avant de déclencher un déploiement sur Coolify :

```bash
# 1. Tests et builds de tout le monorepo (8 workspaces)
cd olydor
pnpm install --frozen-lockfile
pnpm test
pnpm build

# 2. Validation locale multi-conteneurs (PostgreSQL + API + Web + Sim + Arena)
docker compose -f docker/docker-compose.yml up --build
```

Une fois démarré en local :
- Hub Web : `http://localhost:3001`
- Simulateur : `http://localhost:3002`
- Arène : `http://localhost:3003`
- API : `http://localhost:3000/health`
