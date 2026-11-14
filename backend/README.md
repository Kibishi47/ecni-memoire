# Pokémon TCG Backend API

API REST backend isolée pour le simulateur Pokémon TCG (Fastify + TypeScript + PostgreSQL + Octokit).

## Architecture

```
backend/
├── src/
│   ├── config/          # Variables d'environnement (.env avec validation Zod)
│   ├── db/              # Pool PostgreSQL et exécuteur de migrations
│   ├── migrations/      # Migrations SQL versionnées
│   ├── routes/          # Endpoints API (health, cards, decks, reports)
│   ├── services/        # Logique métier (alternativesService, cardResolutionService, githubService, deckParserService)
│   ├── scripts/         # Scripts CLI d'administration locale (seedCards, seedMetaDecks)
│   └── server.ts        # Point d'entrée Fastify
├── meta_decks/          # Decklists méta .txt au format PTCGL
├── docker-compose.yml   # Base PostgreSQL 16 locale prête à l'emploi
├── package.json
├── tsconfig.json
└── .env.example
```

## Démarrage rapide

### 1. Installer les dépendances

```bash
cd backend
npm install
```

### 2. Configurer l'environnement

```bash
cp .env.example .env
```

Variables principales dans `.env` :
- `PORT` : Port d'écoute Fastify (défaut `3000`)
- `NODE_ENV` : `development` | `production` | `test`
- `DATABASE_URL` : Chaîne de connexion PostgreSQL (ex. `postgres://user:password@localhost:5432/pokemon_tcg_db`)
- `GITHUB_TOKEN`, `GITHUB_REPO_OWNER`, `GITHUB_REPO_NAME` : Optionnels (requis uniquement pour créer automatiquement des issues GitHub lors des signalements)
- `RATE_LIMIT_MAX_REPORTS_PER_HOUR` : Limite de signalements par IP et par heure (défaut `5`)

### 3. Démarrer PostgreSQL et appliquer les migrations

```bash
docker compose up -d
npm run db:migrate
```

### 4. Synchroniser les cartes et importer les decks méta (scripts locaux uniquement)

```bash
# Exécute seed:cards puis seed:meta-decks en une seule commande
npm run seed

# Ou séparément :
npm run seed:cards
npm run seed:meta-decks
```

### 5. Lancer le serveur

```bash
# Mode développement avec rechargement à chaud
npm run dev

# Build TypeScript + démarrage production
npm run build
npm start
```

## Déploiement Docker (Coolify)

Le projet intègre un `Dockerfile` multi-stage optimisé pour un déploiement autonome sur **Coolify** (sans docker-compose) :

- Image minimale basée sur `node:20-alpine` (~180 Mo).
- Exécution sous l'utilisateur non-root standard `node`.
- Healthcheck HTTP natif (`GET /health`) sans dépendances tierces (curl/wget).
- `docker-entrypoint.sh` avec attente résiliente de PostgreSQL et exécution automatique des migrations SQL (`AUTO_MIGRATE=true`).

### Configuration dans Coolify

1. **Ajouter une ressource :** *Application* -> *Public/Private Repository* (GitHub / GitLab).
2. **Paramètres de build :**
   - **Build Pack :** `Dockerfile`
   - **Base Directory :** `/backend`
   - **Dockerfile Location :** `/Dockerfile` (ou `/backend/Dockerfile` si Base Directory est laissé à `/`)
   - **Ports Exposes :** `3000`
3. **Variables d'environnement dans Coolify :**
   - `DATABASE_URL` *(obligatoire)* : URL de connexion PostgreSQL (ex. `postgres://postgres:password@mon-postgres-coolify:5432/pokemon_tcg_db`).
   - `NODE_ENV` : `production`
   - `PORT` : `3000`
   - `CORS_ORIGIN` *(optionnel)* : Domaines autorisés séparés par des virgules (ex. `https://simulator.mondomaine.com`).
   - `AUTO_MIGRATE` : `true` (défaut `true`, applique automatiquement les migrations SQL avec retry si PostgreSQL met quelques secondes à démarrer).
   - `AUTO_SEED` : `false` (mettre à `true` pour amorcer automatiquement les cartes/decks si la base est vide).
4. **Health Check :**
   - **Path :** `/health`
   - **Port :** `3000`

---

## Endpoints REST

- `GET /health` : Vérifie la connectivité PostgreSQL (`{ status: "ok", timestamp }`).
- `GET /api/decks/meta` : Retourne tous les decks méta actifs avec leurs cartes et modèles `EngineCardModel`.
- `GET /api/cards` : Recherche paginée dans le catalogue (`q`, `category`, `subCategory`, `limit` 1..50, `offset` >= 0) avec `{ items, total, limit, offset }`.
- `POST /api/cards/batch` : Retourne un dictionnaire `{ [cardId]: EngineCardModel }` pour 1 à 300 `cardIds`.
- `POST /api/cards/resolve` : Résout de manière tolérante des cartes (`items` ou `ptcglText`) via `card_id`, `CARD_ID_ALIASES` et repli sur nom FR/EN normalisé (`resolved` / `unresolved`).
- `POST /api/cards/alternatives` : Calcule côté serveur les suggestions d'alternatives intelligentes (`cardIds` 1..60, `excludeCardIds`, `limitPerCard` 1..30) à l'aide d'un cache catalogue en mémoire.
- `GET /api/cards/:cardId` : Retourne le modèle JSON `EngineCardModel` d'une carte.
- `POST /api/reports` : Enregistre un signalement de bug (`CARD_MODEL_ERROR` ou `ENGINE_RULE_ERROR`), applique le rate-limiting IP, et crée une issue GitHub si configuré.

## Tests

```bash
npm test
```
