# GEMINI.md — Backend API (`./backend/`)

Guide de référence technique et consignes d'ingénierie pour l'API REST backend du simulateur Pokémon TCG.

## 1. Vue d'ensemble & Stack

Le dossier `./backend/` est un package Node.js isolé écrit en **TypeScript strict (ESM `NodeNext`)**.

- **Runtime :** Node.js 20+ (`"type": "module"`)
- **Framework HTTP :** Fastify 5 (`fastify`, `@fastify/cors`, `@fastify/compress`)
- **Base de données :** PostgreSQL (`pg` + migrations SQL brutes versionnées)
- **Validation :** Zod (`zod`) pour la configuration `.env` et les payloads HTTP
- **Intégration GitHub :** `@octokit/rest` (création automatique d'issues lors des signalements)
- **Tests :** Vitest (`vitest`)

## 2. Architecture des fichiers

```text
backend/
├── src/
│   ├── config/
│   │   └── env.ts                 # Chargement .env et validation stricte Zod (parseEnv, env, getBackendRoot)
│   ├── db/
│   │   ├── pool.ts                # Pool singleton PostgreSQL (getPool, closePool, withTransaction, checkDatabaseHealth)
│   │   └── migrate.ts             # Exécuteur CLI & programmatique des migrations SQL (runMigrations)
│   ├── migrations/
│   │   └── 001_initial_schema.sql # Schéma initial (enums, cards, decks, card_deck, bug_reports)
│   ├── routes/
│   │   ├── validation.ts          # Helper parseWithZod pour réponses 400 uniformes
│   │   ├── health.ts              # GET /health (ping PostgreSQL)
│   │   ├── decks.ts               # GET /api/decks/meta (decks actifs + 60 cartes + data JSONB)
│   │   ├── cards.ts               # GET /api/cards, POST /batch, POST /resolve, POST /alternatives, GET /:cardId
│   │   └── reports.ts             # POST /api/reports (validation, rate-limit IP, DB + GitHub issue)
│   ├── services/
│   │   ├── alternativesService.ts # Cache catalogue mémoire (CardCatalogCache) + alternatives intelligentes
│   │   ├── cardResolutionService.ts # Résolution tolérante (card_id -> alias_id -> nom normalisé/synonymes)
│   │   ├── deckParserService.ts   # Parseur PTCGL/Limitless aligné sur poc-5 et simulator
│   │   ├── githubService.ts       # Service Octokit (titres, labels, corps Markdown dépliable)
│   │   └── rateLimiter.ts         # Store mémoire sliding-window par IP (InMemoryRateLimiter)
│   ├── scripts/
│   │   ├── seedCards.ts           # Script CLI local : UPSERT batch (100) depuis cards_database.json
│   │   └── seedMetaDecks.ts       # Script CLI local : import transactionnel de meta_decks/*.txt
│   └── server.ts                  # Construction Fastify (buildServer) et démarrage HTTP
├── meta_decks/                    # Listes .txt au format PTCGL (lanssorien_ex, mega_kangourex_ex, roigada)
├── tests/                         # Suite de tests Vitest
├── docker-compose.yml             # Instance PostgreSQL 16 prête pour le dev local
├── .env.example                   # Modèle des variables d'environnement
├── package.json
└── tsconfig.json
```

## 3. Base de données & Migrations SQL

- Le schéma repose sur 2 enums (`bug_type_enum`, `bug_status_enum`) et 4 tables métier (`cards`, `decks`, `card_deck`, `bug_reports`), ainsi que `schema_migrations`.
- **Règle stricte :** Ne jamais modifier un fichier SQL déjà appliqué dans `src/migrations/`. `runMigrations()` vérifie le checksum SHA-256 de chaque migration déjà présente dans `schema_migrations` et échoue en cas de divergence.
- Pour toute évolution du schéma, ajouter un nouveau fichier horodaté/numéroté (ex. `002_add_xxx.sql`) dans `src/migrations/` et exécuter `npm run db:migrate`.
- `card_deck` impose `count BETWEEN 1 AND 59` et `PRIMARY KEY (id_deck, id_card)`. Toujours agréger les quantités par carte résolue avant insertion.
- `bug_reports.card_id` référence `cards(card_id) ON DELETE SET NULL`. Lors d'un signalement `CARD_MODEL_ERROR`, vérifier l'existence de `cardId` dans `cards` : si absent du catalogue, stocker `NULL` en colonne `card_id` tout en conservant le `cardId` signalé dans le corps de l'issue GitHub et le commentaire stocké.

## 4. Scripts d'administration locale (CLI uniquement)

Les scripts dans `src/scripts/` sont strictement réservés à l'exécution locale en ligne de commande : **ne jamais les exposer via des routes HTTP**.

1. **`npm run seed:cards`** (`src/scripts/seedCards.ts`)
   - Recherche `cards_database.json` dans `../card-compiler/data/cards_database.json` puis `../simulator/src/data/cards_database.json` (ou `--file <chemin>` / `CARDS_DATABASE_PATH`).
   - Supporte `EngineCardModel[]` et `{ cards: Record<string, EngineCardModel> }`.
   - Déduplique par `cardId` et exécute un `INSERT ... ON CONFLICT (card_id) DO UPDATE` par lots de 100 dans une transaction.

2. **`npm run seed:meta-decks`** (`src/scripts/seedMetaDecks.ts`)
   - Lit tous les fichiers `.txt` de `meta_decks/` (métadonnées via `# Name: ... | Archetype: ...` ou nom de fichier).
   - Résout les `cardId` TCGdex via `deckParserService.ts` (tables `VERIFIED_SETS`, padding à 3 chiffres, gestion des énergies de base `SVE` vs `MEE`).
   - Remplace les decks existants dans une transaction (`BEGIN` ... `COMMIT`) et émet un warning explicite si une carte manque dans `cards` ou si le total diffère de 60.

## 5. Contrat API & Règles métier

- `GET /health` → `200 { status: "ok", timestamp }` (ou `503` si PostgreSQL est injoignable).
- `GET /api/decks/meta` → Liste des decks avec `is_active = TRUE`, `totalCards`, et le tableau `cards` (`cardId`, `count`, `data`).
- `GET /api/cards` → Recherche paginée (`q`, `category`, `subCategory`, `limit` 1..50 défaut 20, `offset` >= 0 défaut 0). Recherche insensible à la casse/aux accents (`TRANSLATE`) avec tri par pertinence exacte/préfixe puis `name_fr ASC, card_id ASC`. Retourne `{ items, total, limit, offset }`.
- `POST /api/cards/batch` → Payload Zod `{ cardIds: string[] }` (`1..300`), retourne `{ [cardId]: EngineCardModel }`.
- `POST /api/cards/resolve` → Résolution tolérante pour `{ items: [{ key, candidateIds (1..10), name? }] }` (`1..100`) ou `{ ptcglText }`. Applique l'ordre `card_id` -> `CARD_ID_ALIASES` (`alias_id`) -> nom FR/EN normalisé et `NAME_SYNONYMS` (`name`), et retourne `{ resolved, unresolved }`.
- `POST /api/cards/alternatives` → Payload Zod `{ cardIds (1..60), excludeCardIds?, limitPerCard (1..30, défaut 10) }`. Calcule côté serveur les suggestions d'alternatives via `AlternativesService` et `CardCatalogCache` (aligné sur `simulator/src/core/alternativesFinder.ts`) et retourne `{ results }`.
- `GET /api/cards/:cardId` → Retourne le JSON `EngineCardModel` ou `404`.
- `POST /api/reports` :
  - Rate-limiting mémoire par IP (`RATE_LIMIT_MAX_REPORTS_PER_HOUR`, défaut `5/heure`, réponse `429` avec `Retry-After`).
  - Validation Zod discriminée sur `type` :
    - `CARD_MODEL_ERROR` → `cardId` requis non vide, `matchLogs` optionnel/null.
    - `ENGINE_RULE_ERROR` → `matchLogs` objet JSON requis, `cardId` optionnel/null.
    - `userComment` optionnel, max 1 000 caractères.
  - Insère en base (`status = 'OPEN'`), puis appelle GitHub (`Octokit.issues.create`) uniquement si `GITHUB_TOKEN`, `GITHUB_REPO_OWNER` et `GITHUB_REPO_NAME` sont configurés et non placeholder. En cas d'échec réseau/API GitHub, le signalement reste conservé en base (`issueUrl: null`).

## 6. Conventions de développement

- **Imports ESM :** Toujours utiliser l'extension `.js` dans les imports TypeScript relatifs (ex. `import { env } from '../config/env.js'`) pour satisfaire `moduleResolution: "NodeNext"`.
- **Testabilité :** `buildServer(options)` accepte des dépendances injectables (`pool`, `githubService`, `reportRateLimiter`, `catalogCache`, `alternativesService`) afin de tester les routes Fastify via `app.inject()` sans dépendre d'appels réseau ou PostgreSQL externes.
- **Compression :** `@fastify/compress` compresse automatiquement les réponses HTTP JSON (>= 1 Ko) quand le client envoie `Accept-Encoding: gzip`.
- **Sécurité :** Ne jamais commiter `.env`. Garder `.env.example` synchronisé avec `envSchema` dans `src/config/env.ts`.

## 7. Commandes usuelles

```bash
cd backend
npm install
docker compose up -d --wait
npm run db:migrate
npm run seed              # Exécute seed:cards puis seed:meta-decks
npm run seed:cards
npm run seed:meta-decks

npm run dev        # Serveur Fastify avec rechargement à chaud (tsx watch)
npm run build      # Compilation TypeScript vers dist/
npm run typecheck  # Vérification stricte tsc --noEmit
npm test           # Suite de tests Vitest
```
