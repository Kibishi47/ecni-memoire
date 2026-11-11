# GEMINI.md — PokéSim Studio (`simulator/`)

Ce document définit l'architecture, les conventions de développement, les invariants techniques et les règles de workflow pour le simulateur Pokémon TCG TypeScript/Vue 3 situé dans `./simulator/`.

---

## 1. Workflow & Règles Obligatoires

1. **Commit systématique à chaque tâche terminée** :
   - Toujours effectuer un commit Git propre et atomique dès qu'une fonctionnalité, correction ou refactorisation est terminée et validée.
   - Utiliser des messages de commit clairs (ex. `feat: ...`, `fix: ...`, `refactor: ...`, `docs: ...`).
   - Ne jamais commiter `simulator/src/data/cards_database.json` ni `dist/` ou `node_modules/` (ignorés dans `.gitignore`).
2. **Validation obligatoire avant tout commit** :
   ```bash
   npm --prefix simulator run build   # Exécute sync-cards + vue-tsc + vite build
   npm --prefix simulator run test    # Exécute sync-cards + vitest run (toutes les suites + benchmark 3-ply)
   ```
3. **Commandes de développement** :
   - `npm --prefix simulator run dev` : serveur Vite accessible sur le réseau local avec affichage d'un QR code terminal (`qrcode-terminal`) pour tester sur mobile (`?debug=true` active l'Inspecteur Debug et l'onglet Modèle IA dans le zoom carte).
   - `npm --prefix simulator run sync-cards` : synchronise et normalise `card-compiler/data/cards_database.json` (3 509 cartes Standard) vers `simulator/src/data/cards_database.json`.

---

## 2. Architecture & Responsabilités des Modules

### Contrat de Données & Catalogue
- **`src/types/cardModel.ts`** : Contrat strict `EngineCardModel` aligné sur `card-compiler/compiler/schemas.py`.
  - `ActionType` : `'PLAY_FROM_HAND' | 'EVOLVE' | 'USE_ABILITY' | 'TRIGGERED_ABILITY' | 'PASSIVE_ABILITY' | 'ATTACH_ENERGY' | 'RETREAT' | 'ATTACK'`.
  - `EffectPrimitive` : 29 primitives strictes (aucune conversion silencieuse autorisée).
  - Typage fort de `CoinFlipMode`, `ScalingOperator`, `ScalingMetric`, `EffectTarget`, `EffectZoneType` et `SpecialConditionType`.
- **`scripts/syncCardDatabase.mjs` & `src/data/cardNormalizer.ts`** :
  - Normalisent les modèles compilés sans perte de champs (`sourceZone`, `destinationZone`, `zone`, `specialCondition`, `coinFlipMode`, `coinCount`, `scalingOperator`, `scalingMetric`, `bonusValue`, `preconditions`).
  - **Invariant critique** : ne jamais convertir une primitive inconnue vers `DRAW_CARDS` ou un autre effet par défaut ; les primitives réellement inconnues doivent être filtrées/rejetées proprement.
- **`src/data/cardCatalog.ts` & `src/core/filterDsl.ts`** :
  - Catalogue unifié `UNIFIED_CARD_REGISTRY` alimenté uniquement par `cards_database.json` + énergies de base natives (`src/utils/energy.ts`).
  - `getCardFastMeta(card)` pré-calcule en `WeakMap` O(1) les drapeaux tactiques (`numericId`, `energyUnitKind`, `expandsBenchToEight`, `hasLockItemsPassive`, `hasLockAbilitiesPassive`, `protectsBenchFromDamage`, `hasFairyZonePassive`, `hasOnPlayFromHandTrigger`, `hasAbilityFlag`, etc.).

### Moteur de Règles & Hachage Rapide
- **`src/core/engine.ts`** : Machine à états pure et déterministe (`Mulberry32`) conforme aux règles officielles du JCC Pokémon :
  - **Setup & Mulligans** (`createInitialMatchState`) : mélange Fisher-Yates, conservation en main des Pokémon de Base à talent `ON_PLAY_FROM_HAND_TRIGGER` lors du Setup initial, pioche de Mulligan sur la différence nette.
  - **Préconditions & Actions Légales** (`checkActionPreconditions`, `getLegalActions`) : Tour 1 Joueur 1 (pas de Supporter, pas d'Évolution, pas d'Attaque), 1 Supporter/tour, 1 Stade/tour (`stadiumPlayedThisTurn`, pas de doublon de nom), 1 Énergie manuelle/tour, 1 Outil max/Pokémon, 1 Pouvoir VSTAR/partie, règles de zones publiques pour `RECOVER_FROM_DISCARD`.
  - **Exécution & Étape F** (`applyAction`, `resolveSimultaneousKnockOuts`) :
    - Calcul des dégâts en 6 étapes officielles dans `computeAttackDamageToActive` (bonus attaquant + Double Énergie Turbo `-20`, arrêt si `<= 0`, Faiblesse dynamique incl. *Zone Féérique*, Résistance dynamique, réductions défensives).
    - Résolution différée des K.O. à la fin de l'attaque (Étape F) avant promotion du Banc et vérification simultanée des conditions de victoire (`ALL_PRIZES_TAKEN`, `NO_POKEMON_IN_PLAY`, `DRAW` en cas d'égalité de conditions).
    - Réduction dynamique du Banc de 8 à 5 (`resolveBoardBenchShrinkIfNeeded`) quand *Abîme Zéro* ou le dernier Pokémon Téracristal quitte le jeu.
    - Purge complète via `clearPokemonStatusAndAttackEffects` lors d'une Retraite, d'un Switch, d'une Évolution ou d'une Désévolution.
    - Contrôle Pokémon (`runBetweenTurnsCheckup`) dans l'ordre strict `POISONED -> BURNED -> ASLEEP -> PARALYZED` avant K.O. simultanés (sans déclencher `koSufferedLastOpponentTurn`).
    - Routage explicite de `destinationZone: 'LOST_ZONE'` vers `board.lostZone`.
- **`src/core/fastState.ts`** :
  - Hachage commutatif 53 bits (`computeNumericStateHash`) + buffer binaire plat `Int32Array(128)` (`encodeStateToFlatBuffer`).
  - **Invariant critique** : tout nouveau champ tactique ajouté à `InPlayPokemon`, `PlayerBoardState` ou `MatchState` **doit** être cloné dans `cloneInPlayPokemon`/`clonePlayerBoard` et intégré dans `hashInPlayPokemon`, `computeNumericBoardHash` et `encodePlayerBoardToSlice`.

### Évaluateur 3-Ply, Boucle de Simulation & Workers
- **`src/core/evaluator.ts`** :
  - Beam Search intra-tour dédoublonné par `computeNumericStateHash`, puis lookahead asymétrique sur 3 demi-tours ($T \rightarrow T_{\text{adv}} \rightarrow T+1$) avec rollouts gloutons en place (`mutateInPlace = true`) et table de transposition.
  - Heuristiques clés de `scoreAtomicActionHeuristic` et `evaluateState` : simulation du Gust sur la cible du Banc (Faiblesse, dégâts garantis de Checkup Poison/Brûlure, contournement de murs immunisés type *Mimiqui*), déblocage de la Retraite/Échange sous verrou (`cantAttackNextTurn`, `CONFUSED`, `PARALYZED`), séquencement intra-tour (Épuration/Recherche $\rightarrow$ Empilement $\rightarrow$ Pioche $\rightarrow$ Énergie manuelle), pénalité d'exposition des Pokémon à 2 ou 3 Récompenses, et rétention des cartes de riposte (`isCardTemporallyWaiting`).
  - **Contrainte de performance** : `src/core/fastState.test.ts` valide un débit **> 30 parties/sec** en monothread sur des decks méta complets ; éviter toute allocation superflue (`filter`, `sort`, Regex, `structuredClone`) dans les chemins critiques de `evaluator.ts` et `engine.ts`.
- **`src/core/gameLoop.ts`, `src/core/alternativesFinder.ts`, `src/worker/simulation.worker.ts`, `src/worker/workerPool.ts`** :
  - Exécution multi-threads en Web Workers, calcul des 8 KPIs + télémétrie carte par carte et génération de variantes de decklist.

### Parseur PTCGL, i18n & Interface UI
- **`src/utils/ptcglParser.ts` & `src/utils/ptcglExporter.ts`** :
  - Import/export PTCGL et validation réglementaire : 60 cartes, au moins 1 Pokémon de Base, 100 % résolues dans `cards_database.json`, légalité Standard (G, H, I + Énergies de base), max 1 ACE SPEC, max 1 Pokémon Radieux, max 4 exemplaires par nom (hors Énergies de base).
- **`src/utils/i18n.ts`, `src/utils/debugModelHelper.ts`, `src/utils/cardImage.ts`** :
  - Support complet Français / Anglais (interface, noms de cartes, effets et lecteur lisible du modèle IA dans `CardZoomModal.vue` sans champs `null`).
- **`src/App.vue` & `src/components/*.vue`** :
  - Wizard 3 étapes (`Step1DeckImport.vue`, `Step2SimConfig.vue`, `Step3DashboardAndComparator.vue`), historique complet des versions du deck, export PTCGL direct de la version active, `CardZoomModal.vue`, `DebugInspectorPanel.vue`.
- **`Dockerfile` & `nginx.conf`** :
  - Build multi-stage Node 22 + Nginx 1.27 prêt pour un déploiement Coolify directement depuis `./simulator/`.
