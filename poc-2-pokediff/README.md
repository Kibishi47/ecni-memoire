# PokéDiff • Comparateur de micro-ajustements Pokémon TCG ⚡
> **Assistant d'arbitrage en 3 étapes (Thème Clair & Minimaliste)**  
> Conçu pour des tests utilisateurs UX/UI rapides : un joueur comprend en 5 secondes ce qu'il compare.

---

## 🎯 1. Contexte & Approche UX
47,5 % des joueurs compétitifs modifient 1 à 3 cartes au feeling la veille d'un tournoi.
Cette refonte élimine le jargon complexe ("Same-Seed", "Delta", "Variance") et l'esthétique néon sombre au profit d'un **parcours linéaire en 3 écrans (un seul écran visible à la fois)** :

```
[1. Deck de départ] ➔ [2. Changement de cartes] ➔ [3. Comparaison & Verdict]
```

---

## 🧭 2. Les 3 Écrans du Wizard

### Écran 1 : Deck de départ
- Choix entre les 2 archétypes compétitifs majeurs :
  - **Dracaufeu ex (Liste standard)**
  - **Lanssorien ex (Liste standard)**
- Récapitulatif clair : Liste officielle de 60 cartes vérifiées.
- Bouton : `Tester un changement de cartes →`.

### Écran 2 : Changer 1 à 3 cartes
- **3 changements prêts à tester en 1 clic :**
  1. *Plus de stabilité au Tour 1 :* Retirer 1 Ordres du Boss ➔ Ajouter 1 Poffin Pote-Pote.
  2. *Sortir l'attaquant plus vite :* Retirer 1 Hyper Ball ➔ Ajouter 1 Super Bonbon.
  3. *Sécuriser la fin de partie :* Retirer 1 Énergie ➔ Ajouter 1 Civière Nocturne.
- **Encart côte-à-côte visuel :**
  - Colonne gauche (Rouge très pâle) : `Carte retirée (-1)`
  - Colonne droite (Vert très pâle) : `Carte ajoutée (+1)`
- **Ajustement manuel simplifié :** Liste épurée des 6 cartes clés avec boutons `[-]` et `[+]` (aucun encombrement des 60 cartes).
- Bouton : `Comparer les 2 versions →`.

### Écran 3 : Quel est l'impact de ce changement ?
- **Rappel du changement testé :** Bandeau synthétique avec bouton retour `← Tester un autre changement`.
- **Verdict en 1 phrase :** Encadré bleu lisible en 3 secondes (ex: *"Ce changement est recommandé : vous réduisez nettement vos mains mortes au Tour 1 sans affaiblir votre attaque."*).
- **3 cartes de résultats Avant vs Après :**
  1. *Stabilité au Tour 1 (Poser ses Pokémon de base) :* `Avant : 81 %` ➔ `Après : 87 %` (Badge vert `+6 %`).
  2. *Vitesse d'attaque au Tour 2 :* `Avant : 74 %` ➔ `Après : 75 %` (Badge vert `+1 %`).
  3. *Risque de manquer d'énergie :* `Avant : 12 %` ➔ `Après : 12 %` (Badge `Identique`).
- **Impact selon l'adversaire (3 lignes simples) :**
  - Contre un deck Rapide (ex: Ire-Foudre ex).
  - Contre un deck Évolution (Miroir).
  - Contre un deck Contrôle / Bloquant (ex: Ronflex).

---

## 🎨 3. Charte Graphique & Design System
- **Fond :** `bg-slate-50`
- **Cartes & Conteneurs :** `bg-white`, bordures `border-slate-200`, texte `text-slate-900`
- **Action principale :** `bg-blue-600 text-white font-semibold rounded-xl`
- **Badges d'amélioration :** `bg-emerald-50 text-emerald-700 border-emerald-200`
- **Badges de baisse :** `bg-red-50 text-red-700 border-red-200`
- **Badges neutres :** `bg-slate-100 text-slate-700 border-slate-200`

---

## 🚀 4. Lancer l'application en local

```bash
cd poc-2-pokediff
npm install
npm run dev
```

Ouvrez [http://localhost:5173](http://localhost:5173).
