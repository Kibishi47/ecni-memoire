# PokéSim Studio — Simulateur & Comparateur A/B Pokémon TCG (`./simulator/`)

Simulateur complet de Pokémon TCG unifiant :
- **Design Wizard & Comparateur A/B ("Clean Light Mode" éditorial)** des `poc-1` et `poc-2` (`bg-slate-50`, `bg-white`, `border-slate-200`, `Inter` + `font-mono`).
- **Exécution multi-threads par Pool de Web Workers** & **PRNG déterministe Mulberry32** du `poc-4`.
- **Parseur & Exporteur PTCGL (`tcgdex`)** du `poc-5`.
- **Modèles déclaratifs `EngineCardModel`** (`identity`, `pokemonStats`, `playableActions`, `strategicEvaluator`) issus de `cards_database.json` + `fallbackCardModels.ts`.

## Architecture Cœur

1. **`src/core/engine.ts` (Moteur de Règles Data-Driven)** :
   - État complet d'un match (`MatchState`, `PlayerBoardState`, `InPlayPokemon`).
   - Mélange Fisher-Yates déterministe, résolution officielle des Mulligans, placement Actif/Banc et mise de côté des 6 cartes Récompenses.
   - Génération de tous les coups légaux à l'instant $T$ (`getLegalActions(state)`) avec regroupement canonique (`Typed Move Grouping`).
   - Exécution atomique (`applyAction(state, action)`) : paiement des coûts, résolution des primitives `effects`, déclenchement automatique des talents `ABILITY_ON_EVOLVE` (*Règne Infernal*), gestion des K.O., prise de Récompenses et conditions de victoire (`ALL_PRIZES_TAKEN`, `NO_POKEMON_IN_PLAY`, `DECK_OUT`, `MAX_TURNS_REACHED`).

2. **`src/core/evaluator.ts` (Évaluateur d'Arbre 3-Ply : $T \rightarrow T_{\text{adv}} \rightarrow T+1$)** :
   - Exploration de toutes les séquences d'actions d'un tour complet dédoublonnées par Hash Canonique (`getStateHash(state)`), bornée par `maxBranches` (`8`, `20`, `50` ou `INFINITE`).
   - Évaluation dynamique $V(S)$ pilotée par `strategicEvaluator` (`intrinsicBaseScore`, `turnPhaseWeights`, `inGameDeadCardConditions`, `discardPriorityWhenDead`, `holdForNextTurnBonus`, et `Threat Scoring`).
   - Anticipation sur 3 demi-tours :
     $$\text{Score}(B) = 0.35 \cdot V(S_T) - 0.30 \cdot V_{\text{adv}}(S_{T_{\text{adv}}}) + 0.35 \cdot V(S_{T+1})$$

3. **`src/core/gameLoop.ts` & `src/worker/workerPool.ts`** :
   - Boucle de partie complète jusqu'au K.O. final / 6 Récompenses prises ou `maxTurns`.
   - Calcul des **8 indicateurs obligatoires** et enregistrement des traces détaillées pour le mode `?debug=true`.

## Commandes

```bash
npm install
npm run dev      # Serveur de développement Vite (http://localhost:5173 et http://localhost:5173/?debug=true)
npm test         # Exécution des tests unitaires Vitest
npm run build    # Vérification TypeScript (vue-tsc) et build de production Vite
```
