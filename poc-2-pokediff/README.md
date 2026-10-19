# PokéDiff Matchup Comparator ⚔️🔬
> **Piste 2 : Comparateur différentiel A/B de micro-ajustements Pokémon TCG (Same-Seed 10 000 tirages)**
> Proof of Concept (POC) haute-fidélité ("Wizard of Oz") conçu pour des tests utilisateurs UX/UI.

---

## 🎯 1. Contexte & Problématique Métier
**47,5 % des joueurs compétitifs de Pokémon TCG modifient 1 à 3 cartes au feeling la veille d'un tournoi majeur.**
Dans un test physique classique (10-20 parties), la chance de tirage (pioche des cartes Récompenses, mulligans, mains mortes) fausse les conclusions.

**PokéDiff** résout ce biais grâce au **"Same-Seed Testing"** :
Les deux listes (Variante A de référence vs Variante B modifiée) sont testées sur **la même séquence déterministe de 10 000 paquets mélangés** (Mulberry32 PRNG couplé). Seul l'impact mathématique de la carte modifiée est mesuré, à variance RNG nulle.

---

## 🚀 2. Démarrage Rapide

### Prérequis
- Node.js >= 18.x
- npm >= 9.x

### Lancement
```bash
cd poc-2-pokediff
npm install
npm run dev
```

L'application sera accessible sur `http://localhost:5173`.

Pour compiler pour la production :
```bash
npm run build
npm run preview
```

---

## ⚡ 3. Fonctionnalités Clés Implémentées

### A. Sélecteur de Scénarios d'Arbitrage Pré-configurés & Éditeur Rapide
- **Liste A (Référence) :** 60 cartes compétitives complètes de *Dracaufeu ex / Roucarnage ex*.
- **3 "Dilemmes du Vendredi Soir" (Presets 1-Clic) :**
  1. *Stabilité T1 vs Puissance Fin de Partie :* `-1 Ordres du Boss, -1 Énergie Feu` / `+1 Poffin Pote-Pote, +1 Faiblo Ball`.
  2. *Accélération vs Régularité Supporter :* `-1 Recherche Professorale, -1 Hyper Ball` / `+1 Arven, +1 Super Bonbon`.
  3. *Tech Anti-Contrôle & Stall :* `-1 Mashynn, -1 Énergie Feu` / `+1 Civière Nocturne, +1 Plan du Professeur Turo`.
- **Éditeur A/B Haute-Fidélité :** Boutons `[-]` et `[+]` sur chaque carte avec limites légales (min/max), tiroir de cartes candidates Tech (Flex Spots), filtres par catégorie et recherche textuelle instantanée.
- **Diff Résumé (Git Diff Style) :** Encart visuel indiquant `-1 Carte X` en rose et `+1 Carte Y` en vert, vérifiant la stricte conformité au format légal **60/60 cartes**.

### B. Moteur de Simulation Couplée ("Same-Seed Engine")
- Bouton interactif **"Comparer sur 10 000 tirages couplés (Graines identiques)"** avec micro-animation de 400ms et feedback haptique/confettis.
- **Inspecteur de Graines ("Same-Seed Proof Viewer") :** Visualiseur modal permettant d'explorer graine par graine (ex: Seed `#1042`) la main de 7 cartes et les 6 Récompenses pour A et B, prouvant comment la carte substituée transforme une main morte en un banc opérationnel au Tour 1.

### C. Tableau de Bord des Deltas en Temps Réel
1. **Matrice des Deltas par Matchup Clé (3 colonnes) :**
   - *vs Aggro (Ire-Foudre ex) :* Taux de survie et sortie T2 de A vs B avec gros badge delta (`+5,8 %` / `-2,4 %`).
   - *vs Setup Mirror (Dracaufeu / Lanssorien) :* Taux d'évolution Super Bonbon T2 réussi (A vs B + delta).
   - *vs Disruption (Gardevoir ex / Mashynn T3) :* Taux de reprise après réinitialisation de main à 1-2 cartes.
2. **Comparaison Directe des Métriques Critiques (Barres Doubles A vs B) :**
   - *2+ Salamèche sur le banc au Tour 1.*
   - *Combo Arven → Poffin + Super Bonbon au Tour 2.*
   - *Risque de "Main Morte" au Tour 1 (aucun Supporter ni Ball jouable).*
   - *Risque de manquer d'Énergie Feu pour attaquer au Tour 2.*
3. **Verdict Analytique Automatisé :**
   - Synthèse d'aide à la décision formulée en français clair, explicitant le compromis mathématique exact et fournissant une recommandation stratégique adaptée au métagame du tournoi.

---

## 🎨 4. Design System & Charte Graphique
- **Thème :** Dark analytique compétitif (fond `slate-950` / `slate-900`).
- **Variante A (Référence) :** `sky-400` / `sky-600`.
- **Variante B (Micro-ajustement) :** `violet-400` / `violet-600`.
- **Deltas Positifs :** `emerald-400` (gain de régularité / baisse de risque).
- **Deltas Négatifs :** `rose-400` (perte de tempo / hausse de risque).
- **Icônes :** `lucide-vue-next`.
