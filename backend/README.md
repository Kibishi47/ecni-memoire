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
│   ├── services/        # Logique métier (githubService, deckParserService)
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

## Endpoints REST

- `GET /health` : Vérifie la connectivité PostgreSQL (`{ status: "ok", timestamp }`).
- `GET /api/decks/meta` : Retourne tous les decks méta actifs avec leurs cartes et modèles `EngineCardModel`.
- `POST /api/cards/batch` : Retourne un dictionnaire `{ [cardId]: EngineCardModel }` pour 1 à 100 `cardIds`.
- `GET /api/cards/:cardId` : Retourne le modèle JSON `EngineCardModel` d'une carte.
- `POST /api/reports` : Enregistre un signalement de bug (`CARD_MODEL_ERROR` ou `ENGINE_RULE_ERROR`), applique le rate-limiting IP, et crée une issue GitHub si configuré.

## Tests

```bash
npm test
```
