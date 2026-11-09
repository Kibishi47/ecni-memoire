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

## 🌐 Deux Versions de Présentation Selon l'URL

Le projet dispose désormais d'un système multi-pages transparent géré par Vite :

1. **Version Soutenance 15-18 Minutes (Recommandée pour le 3 décembre)** :
   * **URL** : `http://localhost:5173/` (ou fichier `index.html`)
   * **Format** : **23 diapositives fortes conservant la structure en 8 Actes**, sans superflu ni bavardage théorique.
   * **Focus maximal** : Mise en valeur directe des vraies réalisations d'ingénierie (l'enquête 106 rép. et 85% feeling, le crash-test V1 sombre et le pivot Clean Light Mode V2, l'abandon Wasm et le choix des Workers, le POC 6 d'inspection de GameState, l'évolution du compilateur IA V1->V3 sur M4 Pro, le découplage Engine/Minimax 3-ply, et la démo live).
   * **Notes d'orateur adaptées** : Minutage précis pour chaque slide (`⏱️ Timing cible`), langage oral fluide et direct, équilibre 50 % Design/UX - 50 % Ingénierie logicielle, et encadrement d'une **démonstration live de 2 min 30 s à 3 min**.
2. **Version Exhaustive Complète (Archives & Documentation)** :
   * **URL** : `http://localhost:5173/complete` (ou fichier `complete.html`)
   * **Format** : **47 diapositives intégrales (8 Actes)** détaillant l'intégralité du parcours historique : sas pédagogique TCG en 3 slides, tour fermé, benchmark, tous les POCs, échec Wasm, TCGdex, POC 6 PokéEngine Lab, compilateur IA V1/V2/V3, fastState Zobrist 53-bit, decks méta et perspectives.

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

## 🗺️ Structure du Fil Conducteur (8 Actes — 47 Slides)

* **Slides Liminaires** : Titre du projet (Slide 0), Présentation d'Emmanuel Moulin (Slide 1), Sommaire général des 8 Actes (Slide 2).
* **Acte 1 : Le Sujet &amp; la Recherche Initiale** (Slides 3 à 11) :
  * Passion du compétiteur (Slide 3).
  * **Sas Pédagogique en 3 Slides** : Mécaniques fondamentales des TCG (Slide 4), Spécificités de Pokémon TCG (Slide 5), Jargon compétitif et angoisses des joueurs (Slide 6).
  * Enjeux économique/ludique/technique (Slide 7), cadrage systémique Tour Fermé vs Tour Ouvert (Slide 8), limites mathématiques de l'hypergéométrique et paradoxe de Frank Karsten (Slide 9), benchmark du « trou noir » fonctionnel (Slide 10) et cibles initiales (Slide 11).
* **Acte 2 : Exploration du Terrain** (Slides 12 à 19) : Enquête quantitative massive (106 répondants), constat de 85,4 % de bricolage au feeling, angoisse du brick et syndrome du vendredi soir, entretiens qualitatifs et personas (Thomas &amp; Julien), recentrage exclusif sur Pokémon TCG, 4 pistes de solution, et récit du pivot UX en 24h (échec du dashboard sombre V1 à SUS 48,8 vers la victoire du Wizard épuré V2 à SUS 87,5).
* **Acte 3 : La Piste de Solution** (Slides 20 à 23) : Matrice de décision et hybridation PokéPulse Arena + PokéDiff A/B, détail du Wizard 3 étapes sans jargon, intentions techniques (Wasm/Go, Vue 3, 100 % local) et les 3 protocoles de validation.
* **Acte 4 : La Conception Logicielle &amp; l'IA Locale** (Slides 24 à 32) :
  * Démarche de dé-risquage par mini-projets spécialisés (moteur lambda Wasm, parser PTCGL) (Slide 24).
  * L'échec formateur de WebAssembly (Slide 25 : surcoût frontière mémoire à 72 % CPU) et pivot vers TypeScript natif multi-threadé.
  * Cartographie des 5 besoins fondamentaux (Slide 26).
  * Aspiration TCGdex et découverte du bug critique de la régulation G sur 1 629 cartes (Slide 27).
  * Spécification formelle à 12 primitives et DSL de filtres compact (Slide 28).
  * **POC 6 : PokéEngine Lab — Valider l'Engine &amp; les Règles avant de Compiler** (Slide 29) : Le garde-fou d'ingénierie fondamental (*« On ne compile pas un format si l'engine ne sait pas l'exécuter à la fin ! »*). Banc d'essai dédié pour éprouver le moteur et les règles officielles hors boîte noire — visualisation chirurgicale de la position de jeu (Main, Poste Actif, Banc &lt; 5, Défausse/Trash, Deck, et 6 Récompenses avec déduction par *Prize Checking*), double plateau adverse face-à-face avec *Threat Scoring*, historique de logs pas-à-pas, arborescence de toutes les actions légales générées par la FSM, comparateur de branches Expectiminimax ($T \rightarrow T_{adv} \rightarrow T+1$), et 3 filtres rapides de débogage (`PERFECT_T2`, `BRICK`, `CANDY_PRIZED`).
  * L'incroyable évolution du compilateur IA : V1 monolithique à saturation RAM/swapping (Slide 30) -> V2 Two-Pass DeepSeek+Qwen (Slide 31) -> V3 hybride déterministe Python à débit x3 et 0 hallucination (Slide 32).
* **Acte 5 : Le Prototype Actuel (Simulateur de Production)** (Slides 33 à 39) : Unification dans `./simulator/` (Slide 33), découplage strict Engine FSM vs Evaluator Minimax 3-ply (Slide 34), anticipation de riposte 3-ply (Slide 35), optimisation bas-niveau dans `fastState.ts` (Zobrist 53-bit, Int32Array, mutations in-place) passant de 43 à plus de 1 600 parties/s (Slide 36), règle de blocage zéro-fallback et énergies natives (Slide 37), les 8 KPIs compétitifs (Streaming, Résilience Post-Iono, Flexibilité Boss, Item-Lock T1 Rozbouton) (Slide 38), et intégration des 3 decks méta (Lanssorien, Kangourex, Roigada) validés par 34 tests Vitest (Slide 39).
* **Acte 6 : Tests Utilisateurs (Prochaines Étapes)** (Slides 40 à 41) : Protocole des 2 sessions de tests prévues (Vague 1 joueurs de boutique LGS, Vague 2 compétiteurs régionaux) (Slide 40), critères de succès (100 % complétion, temps &lt; 45 s, SUS &gt; 85), et axes de peaufinage graphique et algorithmique (Slide 41).
* **Acte 7 : La Solution Finale** (Slides 42 à 43) : Rétrospective d'ingénierie (de l'empirisme à la méthode scientifique) (Slide 42) et compétences clés mobilisées pour le titre d'ingénieur (Slide 43).
* **Acte 8 : L'Avenir &amp; Les Perspectives** (Slides 44 à 46) : Vers un bot de compétition (« Stockfish du TCG ») (Slide 44), ouverture multi-jeux à tour fermé (Star Wars, One Piece, Riftbound, Lorcana) (Slide 45), conclusion générale et invitation à la démonstration interactive en direct (Slide 46).
