# PokéEngine Lab & Inspector — POC 4

> **Banc d'essai algorithmique Monte-Carlo, validation hypergéométrique exacte, vérification d'invariants Pokémon TCG et exploration par arbre de décision (Beam Search) exécuté dans un Web Worker dédié (`Uint16Array`).**

---

## 🎯 Objectif d'Ingénierie Logicielle

Contrairement aux POC 1, 2 et 3 orientés UX/UI, **PokéEngine Lab & Inspector (POC 4)** démontre la faisabilité technique, la justesse mathématique et la vitesse d'exécution d'un **vrai moteur de simulation Pokémon TCG** :

1. **Représentation Déclarative des Cartes (`src/engine/cardRegistry.ts`) :**
   - Modélisation complète des 60 cartes du deck compétitif *Dracaufeu ex / Roucarnage ex* via des primitives atomiques composables (`SEARCH_DECK_TO_BENCH`, `SEARCH_DECK_TO_HAND`, `COST_DISCARD_CARDS`, `EVOLVE_BASIC_TO_STAGE2`, `ABILITY_INFERNAL_REIGN`, `ABILITY_QUICK_SEARCH`, `VSTAR_POWER_SEARCH_ANY`, `DISCARD_HAND_DRAW_N`, etc.).
   - Encodage mémoire bas niveau dans des tableaux typés `Uint16Array(60)` (bit-packing 16 bits identique à la `struct GameState` de référence en Go/Wasm).

2. **PRNG Déterministe & Validation Hypergéométrique (`src/engine/prng.ts`, `src/engine/hypergeometric.ts`) :**
   - Générateur pseudo-aléatoire déterministe **Mulberry32** initialisé par une `Seed` reproductible et mélange non-biaisé de **Fisher-Yates**.
   - Comparaison en temps réel entre les fréquences observées par Monte-Carlo et la loi hypergéométrique exacte $P(X = k) = \frac{\binom{K}{k}\binom{N-K}{n-k}}{\binom{N}{n}}$ (écart $\Delta < 0,8\%$ dès $N = 10\,000$).

3. **Machine à États Finis (FSM), Audit d'Invariants & Arbre Beam Search (`src/engine/fsmEngine.ts`) :**
   - Vérification automatique des **5 invariants réglementaires** de Pokémon TCG (interdiction de Supporter T1 pour le 1er joueur, mal d'invocation d'évolution `turnPlayed < currentTurn`, quota 1 Supporter et 1 Énergie manuelle par tour, limite de 5 Pokémon sur le Banc, isolation stricte des 6 cartes Récompenses).
   - Exploration intra-tour comparant 3 politiques d'IA (`Optimal Beam Search + Deck Thinning`, `Glouton`, `Naïf`) via la fonction d'évaluation `evaluateBoardState()`.

4. **Exécution Asynchrone Web Worker & Télémétrie 60 FPS (`src/worker/simulation.worker.ts`) :**
   - Calcul de 100 à 100 000 parties déporté dans un Web Worker dédié pour maintenir l'interface utilisateur à 60 FPS constants (`requestAnimationFrame`).

---

## 🚀 Démarrage Rapide

```bash
cd poc-4-pokeengine
npm install
npm run dev
```

Build de vérification TypeScript & production :

```bash
npm run build
```
