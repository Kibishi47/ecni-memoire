# PokéTuner Engine — POC 3
> **L'assistant intelligent pour équilibrer vos ratios de deck Pokémon TCG**  
> Parcours guidé (Wizard) épuré en 3 étapes pour tests utilisateurs UX/UI.

---

## 🎯 Concept & Proposition de Valeur
85,4 % des joueurs règlent leurs ratios de ressources et de tuteurs au feeling ou copient aveuglément des listes internet sans tenir compte de la salle qu'ils affrontent.

**PokéTuner** inverse la démarche grâce à un parcours ultra-simple en 3 étapes :
1. **Mon Deck :** Choisir la base de son deck (Dracaufeu ex ou Lanssorien ex).
2. **Mon Tournoi :** Indiquer le profil des adversaires attendus (Boutique locale, Grand tournoi régional, Tournoi défensif) et son objectif de jeu (Sécurité ou Vitesse).
3. **Ratios Recommandés :** Obtenir la sélection exacte des 13 ou 14 cartes complémentaires, avec explication en 2 phrases simples et export 1-clic de la liste complète des 60 cartes.

---

## 🎨 Direction Artistique Sobre & Lumineuse
- **Fond clair & aéré :** `bg-slate-50`, cartes `bg-white`, bordures fines `border-slate-200`.
- **Couleur d'action :** `blue-600` pour les boutons principaux et les curseurs.
- **Zéro jargon mathématique :** Vocabulaire direct et accessible à tout joueur de cartes ("Mains mortes", "Cartes de recherche", "Énergies").

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

## 🧩 Les 3 Écrans du Parcours

### Écran 1 : Quel deck préparez-vous ?
- Titre : *"1. Choisissez la base de votre deck"*
- Deux grandes cartes cliquables :
  - **Base Dracaufeu ex** (47 cartes principales fixées ➔ **13 places à optimiser**)
  - **Base Lanssorien ex** (46 cartes principales fixées ➔ **14 places à optimiser**)
- Bouton *"Continuer →"*.

### Écran 2 : Quels adversaires attendez-vous en tournoi ?
- Titre : *"2. Quel est le profil de votre tournoi ?"*
- 3 boutons de sélection rapide :
  - **Boutique locale (Beaucoup de decks rapides)**
  - **Grand tournoi régional (Équilibré)**
  - **Tournoi défensif (Beaucoup de decks lents / contrôle)**
- 3 curseurs simples : *Decks Rapides*, *Decks Évolution*, *Decks Contrôle*.
- Choix de l'objectif en 2 options :
  - *"Je veux éviter les mains mortes (Sécurité)"*
  - *"Je veux sortir le plus vite possible (Vitesse)"*
- Bouton *"Calculer mes ratios idéaux →"* (chargement fluide de 400ms).

### Écran 3 : Vos cartes recommandées
- Rappel clair en haut avec possibilité de modifier les réglages en 1 clic.
- **Encadré principal : Les 13 (ou 14) cartes à intégrer dans votre deck** avec badges différentiels clairs (+1 par rapport au standard, le juste milieu pour ne pas bloquer votre main, etc.).
- **Pourquoi ce choix ? (En 2 phrases simples) :** Synthèse directe de l'avantage procuré par la répartition.
- **Bouton d'action 1-clic :** *"Copier la liste complète des 60 cartes"* au format Pokémon TCG Live (PTCGL).
