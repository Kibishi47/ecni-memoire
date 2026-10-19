# PokéPulse Arena (POC 1) ⚡

> **Banc d'essai décisionnel et confrontation de sorties Pokémon TCG pour tests utilisateurs UX/UI.**

Ce Proof of Concept propose un **parcours guidé (Wizard) ultra-simple en 3 étapes**, au design clair, sobre et épuré (inspiré de Limitless TCG / Linear / Notion).

---

## 🚀 Lancement Rapide

Le projet s'exécute à 100% en local sans aucune dépendance backend :

```bash
cd poc-1-pokepulse
npm install
npm run dev
```

L'application est immédiatement accessible sur `http://localhost:5173/`.

Pour compiler la version de production :
```bash
npm run build
npm run preview
```

---

## 🧭 Parcours Utilisateur en 3 Étapes

L'application affiche une barre de progression discrète en haut (`1. Mon Deck` ➔ `2. Mon Adversaire` ➔ `3. Résultats`) et ne présente qu'un seul écran à la fois sans aucune surcharge cognitive.

### Étape 1 : Choisir mon deck
- **3 grands presets cliquables** :
  1. **Dracaufeu ex** (Deck Évolution)
  2. **Ire-Foudre ex** (Deck Rapide / Aggro)
  3. **Gardevoir ex** (Deck Contrôle)
- **Option "Ou coller ma propre liste"** : ouvre une zone de texte pliable pour coller un export PTCGL / Limitless.
- **Résumé sur 1 ligne** : *"60 cartes prêtes : 11 Pokémon de base • 12 Cartes de recherche • 8 Énergies"* (avec option "Voir les 60 cartes" repliée par défaut).
- Bouton *"Choisir l'adversaire →"*.

### Étape 2 : Choisir l'adversaire
- **4 styles d'adversaires synthétiques** (titre + 1 phrase de max 8 mots) :
  1. **Test à vide (Seul)** — Vérifier si le deck sort bien sans adversaire.
  2. **Contre un deck Rapide (Ire-Foudre ex)** — Vous devez être prêt dès le Tour 2.
  3. **Contre un deck Évolution (Dracaufeu ex)** — Course à la mise en place au Tour 2.
  4. **Contre un deck Perturbation (Gardevoir / Mashynn)** — Votre main est réduite au Tour 3.
- Bouton *"Voir les résultats →"* (déclenche un temps de chargement sobre de 400ms *"Analyse de 10 000 parties..."*).
- Bouton *"← Retour"*.

### Étape 3 : Résultats de stabilité
- Rappel discret : *"Deck : Dracaufeu ex • Adversaire Rapide"* + bouton *"← Modifier le test"*.
- **Bloc 1 (Le Verdict)** : Encadré sobre avec le score global (ex. **"78 % de sorties réussies"**) et une phrase claire en français courant sans jargon.
- **Bloc 2 (3 chiffres clés)** :
  1. *Départ réussi (Tour 1) :* `86 %`
  2. *Attaque prête (Tour 2) :* `78 %`
  3. *Risque de main morte :* `14 %`
- **Bloc 3 (Pourquoi le deck bloque ?)** : 3 barres horizontales claires montrant les causes principales d'échec :
  - *Manque de Pokémon de base*
  - *Manque d'Énergie*
  - *Cartes clés dans les Récompenses*
- Boutons d'action pour tester un autre adversaire ou changer de deck.

---

## 🎨 Direction Artistique & Sobriété

- **Thème clair épuré** : Fond `bg-slate-50`, texte principal `text-slate-900`, texte secondaire `text-slate-500`.
- **Cartes** : `bg-white`, `border border-slate-200`, `rounded-xl`, `shadow-sm`.
- **Bouton principal** : `bg-blue-600 hover:bg-blue-700 text-white`.
- **Couleurs sémantiques sobres** : vert émeraude, orange ambre, rouge discret pour les scores de stabilité.
- **Zéro surcharge** : Aucun dégradé agressif, aucun néon, aucun jargon technique ("Wasm", "Monte-Carlo").
