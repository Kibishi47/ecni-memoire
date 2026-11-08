# Présentation du Projet : Analyse Prédictive & Simulation Stratégique pour Pokémon TCG

Projet de présentation interactive Reveal.js propulsé par **Vite Vanilla**, structuré chronologiquement sur l'ensemble du projet d'ingénierie (des premiers POCs jusqu'au simulateur unifié optimisé à 1 600 parties/seconde et aux retours des joueurs).

Le design des diapositives est volontairement épuré (1 slide = 1 grand titre épuré) afin de focaliser l'attention du public sur le discours, tandis que l'ensemble du contenu technique détaillé, des métriques réelles et du récit des difficultés rencontrées est consigné dans les **notes d'orateur** (`<aside class="notes">`).

---

## 🚀 Démarrage Rapide

1. **Installer les dépendances** :
   ```bash
   npm install
   ```

2. **Lancer le serveur de développement** :
   ```bash
   npm run dev
   ```

3. **Ouvrir dans le navigateur** :
   Rendez-vous sur `http://localhost:5173` (ou l'URL indiquée par Vite dans votre terminal).

---

## 🎙️ Raccourci Essentiel (Console d'Orateur)

* **Appuyez sur la touche `S`** de votre clavier pour ouvrir la **console d'orateur** (Speaker View) dans une fenêtre pop-up dédiée.
* Cette fenêtre synchronisée affiche :
  * Le chronomètre et l'heure actuelle.
  * L'aperçu de la slide courante et de la slide suivante.
  * L'intégralité des **notes d'orateur argumentées**, structurées avec métriques, déroulé pas-à-pas et réponses aux difficultés techniques.

---

## 📦 Scripts Disponibles

* `npm run dev` : Démarre le serveur de développement local avec rechargement à chaud (HMR).
* `npm run build` : Compile la présentation pour la production dans le dossier `dist/`.
* `npm run preview` : Prévisualise localement le build de production.

---

## 🗺️ Structure des 52 Slides (11 Actes)

* **Acte I : Introduction & Vision du Projet** (Slides 1 à 3)
* **Acte II : POC 1 & POC 2 — Conception UX & Design System** (Slides 4 à 6)
* **Acte III : POC 5 — Ingestion & Interopérabilité (PTCGL)** (Slides 7 à 9)
* **Acte IV : POC 3 — Le Compilateur de Cartes & l'IA Locale** (Slides 10 à 20)
* **Acte V : POC 4 — Le Banc d'Essai & le Dilemme WebAssembly** (Slides 21 à 24)
* **Acte VI : `./simulator/` — L'Unification & le Moteur 3-Ply** (Slides 25 à 28)
* **Acte VII : Crises d'Intégration & Résolutions** (Slides 29 à 33)
* **Acte VIII : L'Optimisation Extrême (de 43 à 1 600 parties/s)** (Slides 34 à 39)
* **Acte IX : Co-Conception Joueurs & Analytics Compétitifs** (Slides 40 à 46)
* **Acte X : Bêta-Test & Protocole d'Évaluation Terrain** (Slides 47 à 48)
* **Acte XI : Bilan, Compétences & Perspectives** (Slides 49 à 52)
