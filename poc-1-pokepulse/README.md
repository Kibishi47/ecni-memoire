# PokéPulse Arena (POC 1) ⚡

> **Banc d'essai décisionnel et confrontation de sorties Pokémon TCG pour tests utilisateurs UX/UI ("Wizard of Oz").**

Ce Proof of Concept permet à des joueurs compétitifs de Pokémon TCG de tester l'ergonomie, la pertinence et la clarté d'un outil décisionnel évaluant la régularité mathématique de leur deck face à la pression d'une horloge adverse ("Gauntlet").

---

## 🚀 Lancement Rapide

Le projet tourne 100% en local sans aucune dépendance backend :

```bash
cd poc-1-pokepulse
npm install
npm run dev
```

L'application est immédiatement accessible sur `http://localhost:5173/`.

Pour construire la version de production :
```bash
npm run build
npm run preview
```

---

## 🎮 Fonctionnalités Clés & Parcours Utilisateur

### 1. Chargement de Deck en 1-Clic & Import PTCGL
- **3 Presets Métagame Français Officiels (60 cartes réelles)** :
  1. **Dracaufeu ex / Roucarnage ex** (*Archétype Évolution Niveau 2 / Engine Search*)
  2. **Ire-Foudre ex / Ogerpon Masque Turquoise ex** (*Archétype Aggro Turbo*)
  3. **Gardevoir ex / Fortusimia** (*Archétype Setup / Disruption*)
- **Import Libre au format PTCGL / Limitless TCG** :
  - Zone de texte avec prévisualisation et validation automatique du compte de cartes (`60 / 60 cartes`).
  - Détection automatique et inférence du rôle des cartes (Bases, Évolutions, Tuteurs, Objets, Supporters, Énergies).

### 2. Taxonomie Automatique des 60 Cartes
Dès le chargement, les cartes sont ventilées visuellement par rôle stratégique avec badges et compteurs :
- 🛡️ **Pokémon de Base** (ex: Salamèche, Roucool, Tarsal, Ire-Foudre ex)
- ⚡ **Évolutions Niv. 1 & 2** (ex: Dracaufeu ex, Roucarnage ex, Kirlia)
- 🔍 **Moteurs de recherche / Balls** (ex: Poffin Pote-Pote, Faiblo Ball, Hyper Ball)
- ✨ **Accélérateurs & Objets clés** (ex: Super Bonbon, Civière Nocturne, Tambour Éveillé)
- 👤 **Supporters de pioche/disruption** (ex: Arven, Mashynn / Iono, Ordres du Boss, Sada)
- 🔥 **Énergies** (ex: Énergies de base Feu, Plante, Psychique, etc.)
- Barre de proportion globale, recherche temps réel et filtrage par onglet.

### 3. Sélecteur de Gauntlet Adverse (Pression de Matchup)
Permet de mesurer l'impact de l'horloge adverse :
1. **Dans le vide (Goldfishing pur)** : Pas de perturbation, benchmark de régularité solo.
2. **Face à Aggro Turbo (Ire-Foudre ex)** : Menace létale dès le Tour 2 (140-280 dégâts). Punit sévèrement les départs à un seul de base.
3. **Face à Setup Miroir (Dracaufeu / Lanssorien ex)** : Course d'accélération au Super Bonbon Tour 2.
4. **Face à Disruption / Contrôle (Gardevoir / Mashynn)** : Simule l'impact d'une Mashynn ou d'un Tampon Injuste au Tour 3 réduisant la main à 2 cartes.
- **Sélecteur d'Ordre de Jeu** : Commencer (Play First / T1) vs Jouer Second (Draw Second / T2 avec Supporter & Attaque).

### 4. Moteur de Simulation Wasm & Tableau de Bord (10 000 runs)
- **Bouton d'action "Lancer 10 000 simulations (Moteur Wasm)"** :
  - Déclenche un faux temps de chargement ultra-réaliste (550ms) affichant les étapes compétitives :
    1. *Génération de 10 000 mains de départ & vérification des Mulligans...*
    2. *Résolution des chaînes Arven -> Poffin Pote-Pote + Super Bonbon...*
    3. *Calcul des cartes clés piégées dans les 6 Récompenses (Prized)...*
    4. *Application de la pression adverse et de l'horloge T2-T4...*
    5. *Agrégation des 10 000 itérations Monte-Carlo...*
- **KPIs Globaux en Cartes Hautes** :
  - **Score de Régularité Sous Pression** (%) avec jauge radiale et code couleur esport.
  - **Probabilité de Setup Idéal Tour 2** (%) avec seuil compétitif.
  - **Taux de Main Morte / Brick T1** (%) avec indicateur de risque.
  - **Taux de Mulligan Forcé** (%) calculé par loi hypergéométrique + nombre moyen de cartes offertes à l'adversaire.
- **Graphique Visuel Tour par Tour (Tours 1 à 4)** :
  - Confrontation barres CSS/SVG entre la probabilité d'exécution du joueur et le seuil de danger de l'horloge adverse.
  - Diagnostic interactif au clic sur chaque tour (T1, T2, T3, T4).
- **Diagnostic des Causes d'Échec (Breakdown des Bricks)** :
  - Répartition précise : % Manque de Pokémon de Base, % Sécheresse d'Énergie, % Pièces maîtresses Prized (6 Récompenses), % Asphyxie post-Mashynn T3.
- **Encart d'Alerte Actionnable** :
  - Constat spécifique au matchup sélectionné et recommandation tactique pour le jeu en tournoi (avec bouton de copie en 1-clic).
- **Banc d'Essai T1 (Simulateur de main de 7 cartes en direct)** :
  - Permet aux testeurs de tirer des mains réelles depuis le deck actif pour vérifier immédiatement les conclusions de la simulation et visualiser les actions T1 jouables.

---

## 🛠️ Stack Technique

- **Framework** : Vue 3 (`<script setup lang="ts">`) + TypeScript
- **Bundler** : Vite 6
- **Styles** : Tailwind CSS v3 avec palette esport sombre (`slate-950`, `slate-900`, `slate-800`, accents `indigo-500`, `emerald-400`, `amber-400`, `rose-500`)
- **Icônes** : Lucide Vue Next
