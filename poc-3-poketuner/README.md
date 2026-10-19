# PokéTuner Engine — POC 3
> **Optimiseur combinatoire des ratios de deck sous contrainte du métagame de salle**  
> Proof of Concept interactif haute-fidélité ("Wizard of Oz") pour tests utilisateurs UX/UI.

---

## 🎯 Problématique & Proposition de Valeur
**85,4 % des joueurs de Pokémon TCG règlent leurs ratios de ressources et de tuteurs au feeling.**  
Le joueur lambda copie une liste sur LimitlessTCG sans adapter ses ratios aux spécificités de sa salle de tournoi locale ou d'un tournoi régional.

**PokéTuner Engine** prend le problème à l'envers :
1. **Verrouillage du Squelette Intouchable (Core Deck) :** 46 ou 47 cartes indispensables au moteur.
2. **Saisie du Métagame Estimé :** Curseurs interactifs sur la composition de la salle (Aggro, Évolution/Setup, Contrôle/Stall) et sélection de l'objectif prioritaire.
3. **Calcul Combinatoire Heuristique & Monte-Carlo :** L'algorithme explore les 144 permutations valides des 13 ou 14 Flex Slots d'infrastructure pour trouver la formule mathématiquement optimale et affiche le gain de performance pondéré face à cette salle précise.

---

## 🛠️ Stack Technique
- **Framework :** [Vue 3](https://vuejs.org/) (`<script setup lang="ts">`) + [TypeScript](https://www.typescriptlang.org/)
- **Build Tool :** [Vite 6](https://vitejs.dev/)
- **Styles :** [Tailwind CSS 3](https://tailwindcss.com/) (thème sombre laboratoire d'optimisation : `slate-950`, `slate-900`, accents `amber-500`, `emerald-500`, `cyan-400`)
- **Icônes :** [lucide-vue-next](https://lucide.dev/)

---

## 🚀 Démarrage Rapide

```bash
cd poc-3-poketuner
npm install
npm run dev
```

Pour compiler le build de production :
```bash
npm run build
```

---

## 🧩 Parcours Utilisateur en 3 Étapes

### Étape 1 : Sélection du Squelette Tactique ("Core Deck")
- Choix en 1 clic parmi 2 archétypes compétitifs majeurs :
  - **Lanssorien ex / Xatu :** 46 cartes verrouillées, 14 slots d'infrastructure à optimiser.
  - **Dracaufeu ex / Roucarnage ex :** 47 cartes verrouillées, 13 slots d'infrastructure à optimiser.
- Vue détaillée avec filtres des cartes fixes (Pokémon, Supporters, Objets, ACE SPEC, Outils/Stades, Énergies).
- Affichage du **Pool de Cartes Candidates** avec bornes `[Min - Max]`, ratio standard Limitless et texte d'impact tactique.

### Étape 2 : Paramétrage de la Salle de Tournoi (Curseurs de Métagame)
- **Presets en 1 clic :** "Boutique Locale Aggro", "Régional Équilibré", "Salle Contrôle / Lente".
- **3 Curseurs interactifs normalisés à 100% :**
  - Part d'Aggro Rapide (Ire-Foudre ex, Rugit-Lune ex, Miraidon ex)
  - Part d'Évolution / Setup (Dracaufeu ex, Lanssorien ex, Gardevoir ex)
  - Part de Disruption / Contrôle (Ronflex Stall, Gardevoir Disruption)
- **Sélecteur d'objectif prioritaire :**
  - *Maximiser l'explosivité Tour 2*
  - *Minimiser le risque de Main Morte (Stabilité max)*
  - *Maximiser la résilience post-Mashynn (Fin de partie)*

### Étape 3 : Exécution de l'Optimiseur et Prescription des Ratios
- **Bouton d'exécution avec animation de convergence (700ms) :**
  - Exploration de 144 permutations valides
  - Évaluation Monte-Carlo pondérée sur le méta
  - Détection de l'optimum global
- **La Formule Optimale Prescrite :**
  - Ratios recommandés comparés aux ratios standards Limitless avec badges d'écarts (`+1`, `-1`, `Identique`) et justifications tactiques contextualisées.
  - Bascule entre *Vue Flex Slots (13 ou 14 cartes)* et *Vue Deck Complet (60 cartes)*.
- **Gain de Performance Pondéré :**
  - Score d'efficacité optimisé vs standard (ex: `86,4 % vs 79,1 % (+7,3 % de sorties réussies)`).
  - Décomposition des performances par type de matchup (Aggro, Évolution, Contrôle).
- **Heatmap & Courbe de Sensibilité des Énergies :**
  - Simulation de 5, 6, 7 et 8 énergies avec risques de manque T2, risques de surcharge (brique) et recommandation personnalisée selon le méta.
- **Export 1-Clic au format PTCGL :**
  - Bouton avec notification visuelle (toast) et copie directe dans le presse-papier du format standard Pokémon TCG Live, prêt à être collé dans le client de jeu.
