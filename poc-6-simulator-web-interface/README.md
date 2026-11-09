# POC 6 — PokéEngine Studio : Interface Web de Test & Duel Interactif (`./poc-6-simulator-web-interface/`)

Interface web interactive de testbench et banc d'essai dédiée au moteur de règles Pokémon TCG (`src/core/engine.ts`).

## Objectif & Spécifications

Ce POC 6 isole et valorise l'**Engine de règles officiel** et l'**Arbre d'anticipation 3-Ply** issus du projet `simulator` dans une interface de jeu visuelle, snapy et réactive, spécifiquement conçue pour le test manuel et le débogage :

1. **Disposition 3 Colonnes Plein-Écran** :
   - **Gauche (Journal de Combat & Logs)** :
     - Historique chronologique complet des événements du duel.
     - Séparateurs visuels de tours (`Tour 1 (Joueur 1)`).
     - Badges iconographiques et colorés par type d'action : Attaque (dégâts infligés), Talent, Dresseur, Énergie, Pose sur le Banc, Évolution, K.O. et prise de Récompenses.
     - Outils intégrés : Recherche textuelle, filtres par catégorie, défilement automatique et bouton « Copier tous les logs ».
   - **Centre (Plateau Visuel & Mains Joueurs)** :
     - **Adversaire (Haut)** : Cartes en main (avec toggle pour masquer ou révéler la main adverse), Poste Actif avec jauge de PV dynamique (vert/jaune/rouge) et dégâts subis, Banc (5 emplacements avec énergies et outils attachés), et barres d'état (6 Récompenses restantes, compteur de deck et défausse consultable).
     - **Arène Neutre (Milieu)** : Emplacement du Stade actif en jeu et bannière d'état de match.
     - **Joueur 1 / Moi (Bas)** : Poste Actif complet, Banc de 5 Pokémon, et vos Cartes en Main interactives avec badge dynamique `Jouable (N)` lorsque la carte dispose de coups légaux. Cliquer sur une carte filtre immédiatement la liste d'actions sur la droite.
     - **Barre d'outils supérieure** : Annulation instantanée de coup (`Undo`), redémarrage à l'identique (`Recommencer` avec même seed), et bouton `Nouveau Duel` avec sélecteur de decks méta (Lanssorien-ex, Méga-Kangourex-ex, Roigada ou decklist PTCGL personnalisée).
   - **Droite (Liste de Toutes les Actions Légales)** :
     - Liste exhaustive temps-réel calculée par `getLegalActions(state)`.
     - Onglets de filtrage rapide : `Toutes`, `Attaques`, `Dresseurs`, `Talents`, `Banc & Évolutions`, `Énergies & Retraite`.
     - Exécution immédiate au clic sans animation superflue (`applyAction(state, action)`).
     - Mise à jour instantanée du board, génération automatique des logs et passage officiel de tour au Checkup officiel.
     - Boutons d'aide IA : `Coup IA` (joue l'action recommandée par le moteur 3-ply) et `Tour IA Complet`.

2. **Modals d'Inspection Détaillée** :
   - **Inspection de Carte** : Affichage haute résolution de la carte avec règles officielles, coûts d'énergie, attaques, talents, PV et faiblesses.
   - **Visualiseur de Défausse & Deck** : Liste groupée par quantité de toutes les cartes défaussées ou restantes dans la pioche.
   - **Configuration de Match** : Choix des decks joueur et adverse, mode premier joueur (Pile ou face, Joueur, Adversaire), graine déterministe (Mulberry32) et plafond de tours.

## Commandes

```bash
# Installation des dépendances
npm install

# Démarrage du serveur de développement Vite
npm run dev

# Vérification TypeScript (vue-tsc) et build de production
npm run build

# Prévisualisation du build de production
npm run preview
```
