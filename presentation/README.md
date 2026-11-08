# Présentation du Projet : Analyse Prédictive & Simulation Stratégique pour Pokémon TCG

Projet de présentation interactive Reveal.js propulsé par **Vite Vanilla**, structuré chronologiquement sur l'ensemble de la démarche d'ingénierie et de recherche menée par Emmanuel Moulin (Master 2 ECNI — GOBELINS).

Le design des diapositives est volontairement épuré (1 slide = 1 grand titre épuré) afin de focaliser l'attention du public sur le discours, tandis que l'ensemble du contenu technique détaillé, des métriques réelles issues des enquêtes de terrain et du récit des difficultés et réussites rencontrées est consigné dans les **notes d'orateur** (`<aside class="notes" data-markdown>`).

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
  * L'intégralité des **notes d'orateur avec mise en page Markdown riche** (titres stylisés, puces aérées, formules mises en valeur, verbatims, données chiffrées).

---

## 📦 Scripts Disponibles

* `npm run dev` : Démarre le serveur de développement local avec rechargement à chaud (HMR).
* `npm run build` : Compile la présentation pour la production dans le dossier `dist/`.
* `npm run preview` : Prévisualise localement le build de production.

---

## 🗺️ Structure du Fil Conducteur (7 Actes)

* **Slides Liminaires** : Titre du projet (Slide 0), Présentation d'Emmanuel Moulin (Slide 1), Sommaire général (Slide 2).
* **Acte 1 : Le Sujet & la Recherche Initiale** (Slides 3 à 8) : Passion du compétiteur, enjeux économique/ludique/technique, cadrage systémique Tour Fermé vs Tour Ouvert, limites mathématiques de l'hypergéométrique (paradoxe de Frank Karsten), benchmark du « trou noir » fonctionnel et problématique de départ.
* **Acte 2 : Exploration du Terrain** (Slides 9 à 16) : Enquête quantitative massive (106 répondants), constat de 85,4 % de bricolage au feeling, angoisse du brick et syndrome du vendredi soir, entretiens qualitatifs et personas (Thomas & Julien), recentrage exclusif sur Pokémon TCG, 4 pistes de solution, et récit du pivot UX en 24h (échec du dashboard sombre V1 à SUS 48,8 vers la victoire du Wizard épuré V2 à SUS 87,5).
* **Acte 3 : La Piste de Solution** (Slides 17 à 20) : Matrice de décision et hybridation PokéPulse Arena + PokéDiff A/B, détail du Wizard 3 étapes sans jargon, intentions techniques (Wasm/Go, Vue 3, 100 % local) et les 3 protocoles de validation.
* **Acte 4 : La Conception Logicielles & l'IA Locale** (Slides 21 à 28) : Découpage par 5 POCs, l'échec de WebAssembly (overhead de sérialisation frontière mémoire JS/Wasm à 70 % CPU) au profit du multi-threading TypeScript natif, cartographie des besoins fondamentaux, aspiration TCGdex et découverte du bug critique de la régulation G (1 629 cartes), spécification formelle (12 primitives et DSL de filtres), et l'incroyable évolution du compilateur IA (V1 monolithique à saturation RAM/swapping -> V2 Two-Pass DeepSeek+Qwen -> V3 hybride déterministe Python à débit x3 et 0 hallucination).
* **Acte 5 : Le Prototype Actuel (Simulateur de Production)** (Slides 29 à 35) : Unification dans `./simulator/`, découplage strict Engine FSM vs Evaluator Minimax 3-ply, optimisation bas-niveau dans `fastState.ts` (Zobrist 53-bit, Int32Array, mutations in-place) passant de 43 à plus de 1 600 parties/s, règle de blocage zéro-fallback et énergies natives, les 8 KPIs compétitifs (Streaming, Résilience Post-Iono, Flexibilité Boss, Item-Lock T1 Rozbouton), et intégration des 3 decks méta (Lanssorien, Kangourex, Roigada) validés par 34 tests Vitest.
* **Acte 6 : Tests Utilisateurs (Prochaines Étapes)** (Slides 36 à 37) : Protocole des 2 sessions de tests prévues (Vague 1 joueurs de boutique LGS, Vague 2 compétiteurs régionaux), critères de succès (100 % complétion, temps < 45 s, SUS > 85), et axes de peaufinage graphique et algorithmique.
* **Acte 7 : La Solution Finale** (Slides 38 à 40) : Rétrospective d'ingénierie (de l'empirisme à la méthode scientifique), compétences clés mobilisées pour le titre d'ingénieur, perspectives futures (Rust/Wasm 50 000 parties/s, assistant mobile PWA), conclusion et invitation à la démonstration interactive en direct.
