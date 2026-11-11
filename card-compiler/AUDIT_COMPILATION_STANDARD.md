# Audit Complet de la Compilation du Format Standard (3 509 Cartes)

Ce document présente l'audit exhaustif des **3 509 cartes du format Standard** compilées dans `data/compiled_cards/` en croisant :
- Les textes officiels FR/EN de TCGdex (`data/raw_tcgdex/{id}.json`)
- Les analyses de raisonnement de la Passe 1 (`data/reasoning_texts/{id}.json`)
- Les cartes compilées finales (`data/compiled_cards/{id}.json`)
- Le code source du compilateur (`compiler/schemas.py`, `compiler/deterministic_builder.py`, `compiler/llm_engine.py`, `compiler/mlx_engine.py`)

L'audit couvre les trois volets demandés (**`playableActions`**, **`deadCardCondition`**, **`strategicEvaluator`**) en distinguant systématiquement :
1. **Les limites structurelles du modèle de données (`EngineCardModel`)** : mécaniques du JCC Pokémon impossibles à exprimer avec les champs et enums actuels.
2. **Les bugs déterministes et effets de bord du code Python** (`deterministic_builder.py` et `schemas.py`) qui écrasent ou corrompent des données valides.
3. **Les erreurs d'interprétation de l'IA et les biais induits par les prompts** (`llm_engine.py` et `mlx_engine.py`).

---

## 0. Bilan Statistique Global du Corpus (3 509 Cartes)

| Catégorie / Sous-catégorie | Nombre de cartes |
| :--- | ---: |
| `POKEMON / BASIC` | 1 572 |
| `POKEMON / STAGE_1` | 871 |
| `POKEMON / STAGE_2` | 318 |
| `ENERGY / BASIC_ENERGY` | 272 |
| `TRAINER / SUPPORTER` | 217 |
| `TRAINER / ITEM` | 138 |
| `TRAINER / TOOL` | 50 |
| `TRAINER / STADIUM` | 49 |
| `ENERGY / SPECIAL_ENERGY` | 22 |
| **Total** | **3 509** |

### Répartition par mode de compilation (`compilationMetadata`)
- `mlx-community/Qwen2.5-Coder-14B-Instruct-8bit` (`MLX-Safetensors (Unified Memory)`, nouveau pipeline 2 passes) : **2 835 cartes**
- `STATIC_DETERMINISTIC` (`deterministic_builder` + `builtin_engine_rule`, 0 appel IA : Énergies de base + Pokémon vanille sans texte) : **637 cartes**
- **Anciennes compilations résiduelles non écrasées (37 cartes)** :
  - `Qwen/Qwen3-14B-GGUF` (du **29/10/2026**, 8 cartes majeures) : `sv01-166` (Pepper), `sv01-181` (Faiblo Ball), `sv01-196` (Hyper Ball), `sv02-185` (Mashynn), `sv03-125` (Dracaufeu-ex), `sv03-164` (Roucarnage-ex), `sv04-125` (Super Bonbon), `sv04-160` (Attrape-Riposte).
  - `mlx-community/Qwen2.5-Coder-14B-Instruct-8bit` (`model.safetensors (MLX Native)` du **04/11/2026**, 29 cartes majeures compilées avec l'ancien pipeline 1-passe) : `sv05-025` (Vert-de-Fer-ex), `sv05-144` (Poffin Copain-Copain), `sv06-025` (Ogerpon Masque Turquoise-ex), `sv06-095` (Fortusimia), `sv06-130` (Lanssorien-ex), `sv06-141` (Ursaking Lune Vermeille-ex), `sv06-165` (Tampon Injuste), `sv08-076` (Latias-ex), etc.
  - *Cause* : Le script de batch incrémental ignore les cartes dont le fichier `.json` existe déjà dans `data/compiled_cards/`. Ces 37 staples de tests antérieurs n'ont donc pas bénéficié du dernier pipeline.

---

## 1. Audit des `playableActions` (Effets, Talents, Attaques, Dresseurs)

### A. Limites Structurelles du Schéma (`EngineCardModel` / `EffectPrimitive` / `AtomicEffect`)

#### 1. Absence totale de modélisation des lancers de pièce (435 attaques concernées)
- **Diagnostic** : `AtomicEffect` ne possède aucun champ pour représenter l'aléatoire (`coinFlip`, `coinCount`, `untilTails`, `onHeadsEffect`, `probability`).
- **Conséquences dans les cartes compilées** :
  - **Attaques « Pile = ne fait rien » deviennent 100 % garanties** : Ex. `30th-009` (Goupix — *Attaque Surprise* : 30 dégâts, *"Lancez une pièce. Si c'est pile, cette attaque ne fait rien"*) est compilée en `DAMAGE_ACTIVE(value=30)` inconditionnel. Le moteur MCTS croira que l'attaque réussit à 100 %.
  - **Attaques « X dégâts × nombre de côtés face » deviennent des dégâts fixes** : Ex. `30th-004` (Éoko — *Balle Surprise* : `50×`) est compilée en `DAMAGE_ACTIVE(value=50)`.
  - **Attaques « Si c'est face, +X dégâts supplémentaires »** : Tantôt ignorées (seul le dégât de base est gardé), tantôt dédoublées en deux `DAMAGE_ACTIVE` inconditionnels (ex. `30th-047` Pikachu — *Câlinerie* `10+` : compilée avec deux `DAMAGE_ACTIVE` de `10` et `20`, soit 30 dégâts garantis), tantôt transformées en `DRAW_CARDS` par hallucination (`me02.5-017` Larvibule).
  - **Immunité sur lancer de pièce** (*"Si c'est face, évitez tous les dégâts"*, ex. `30th-006` Ceribou, `30th-016` Ramoloss, `me02-071` Archéomire) : Compilée en deux effets vides `DAMAGE_ACTIVE(target="SELF", value=null)`.

#### 2. Perte des formules de dégâts dynamiques (`+`, `×`, « pour chaque ») (835 attaques concernées, dont 456 réduites au seul dégât de base fixe)
- **Diagnostic** : `AtomicEffect` ne contient qu'un entier statique `value: Optional[int]`. Il n'existe aucun champ `scalingMetric` / `multiplier` / `perUnit` / `bonusCondition`. De plus, `_parse_base_damage()` dans `deterministic_builder.py` (ligne 256) extrait simplement le premier nombre via `re.search(r"\d+", s)`.
- **Conséquences** :
  - **Multiplicateurs (`×`) écrasés à 1 seule unité** : Ex. `30th-015` (Chochodile-ex — *Explosion d'Énergie* : `20×` par Énergie attachée) vaut `value: 20` fixe ; `sv03-125` (Dracaufeu-ex — *Obscurité Brûlante* : `180+` + 30 par Récompense adverse prise) vaut `value: 180` fixe.
  - **Attaques à `damage: ""` dont les dégâts sont uniquement dans le texte** :
    - Ex. `me01-056` (Alakazam — *Main Puissante* : *"Placez 2 marqueurs de dégâts pour chaque carte dans votre main"*) : compilé en `DAMAGE_ACTIVE(value=null, count=2)`.
    - Ex. `30th-101` (Miaouss de Galar — *Ruée au Trésor* : *"10 dégâts pour chaque carte dans votre main"*) : compilé en deux `DAMAGE_ACTIVE(value=10)` fixes.

#### 3. Talents Passifs, Outils Pokémon et Stades forcés en actions actives (`USE_ABILITY` / `PLAY_FROM_HAND`) sans primitives adaptées (322 talents passifs + 50 Outils + 49 Stades)
- **Diagnostic** :
  1. `ActionType` ne distingue pas un talent activable (`ACTIVATED_ABILITY`) d'un talent passif/continu (`PASSIVE_ABILITY`) ou d'un talent déclenché à la pose (`ON_PLAY_TRIGGER` comme *Vernier Rapide* ou *Luminéol-V*).
  2. `EffectPrimitive` (limité à 12 primitives d'actions immédiates) ne possède aucune primitive pour les modificateurs continus : `MODIFY_HP`, `REDUCE_DAMAGE_TAKEN`, `BOOST_DAMAGE_DEALT`, `PREVENT_BENCH_DAMAGE`, `MODIFY_RETREAT_COST`, `LOCK_ABILITIES`, `LOCK_ITEMS`, `EXPAND_BENCH`.
- **Conséquences** :
  - **Bonus de PV traduits en soin (`HEAL`) ou ignorés** : `30th-002` (Noadkoko d'Alola : *"+250 PV"*) est traduit en `HEAL(target="SELF")` ; `sv05-152` (Cape Héroïque : *"+100 PV"*) a `effects: []`.
  - **Réductions de dégâts / Immunité de Banc traduites en `DAMAGE_ACTIVE` sur soi-même** : `30th-028` (Pikachu : *"subit 30 dégâts de moins"*) ou `30th-033` (Pikachu : *"Évitez tous les dégâts infligés à ce Pokémon de Banc"*) sont compilés en `DAMAGE_ACTIVE(target="SELF")` !
  - **Verrous (Locks) et Stades de règles vides** : `sv06-077` (Épine-de-Fer-ex — *Initialiser* : annule les talents des Pokémon à encadré Règle) et `sv07-131` (Abîme Zéro : Banc à 8 places) ont `effects: []`.

#### 4. Absence des restrictions et effets persistants au tour suivant (395 attaques concernées)
- **Diagnostic** : Aucune primitive ne permet d'encoder *"Pendant votre prochain tour, ce Pokémon ne peut pas attaquer"* ou *"Pendant le prochain tour de votre adversaire, le Pokémon Défenseur ne peut pas battre en retraite"*.
- **Conséquences** :
  - Soit la restriction est **totalement supprimée** (ex. `30th-060` Salarsen — *Éclair du Tonnerre* 160 dégâts, `sv05-025` Vert-de-Fer-ex — *Lame Prisme* 180 dégâts : seul `DAMAGE_ACTIVE` subsiste, faisant croire au moteur que le Pokémon peut enchaîner l'attaque chaque tour sans contrainte).
  - Soit l'IA improvise `APPLY_SPECIAL_CONDITION(target="SELF", value=null)` (140 occurrences !), ce qui corrompt l'état du Pokémon attaquant.

#### 5. États Spéciaux non typés dans `APPLY_SPECIAL_CONDITION` (661 occurrences) et conditions d'états manquantes
- **Diagnostic** : `AtomicEffect` utilise `APPLY_SPECIAL_CONDITION`, mais n'a aucun champ `specialCondition` (`POISONED`, `BURNED`, `ASLEEP`, `PARALYZED`, `CONFUSED`).
- **Conséquences** :
  - Sur **336 occurrences** ciblant `OPPONENT_ACTIVE`, `value`, `count`, `zone` et `filter` sont tous à `null`. Le moteur de jeu sait qu'un État Spécial est infligé, mais **ignore lequel** (Or la Paralysie bloque l'attaque et la retraite pendant 1 tour, tandis que le Poison inflige 10 dégâts entre les tours).
  - Les attaques conditionnées par un État Spécial existant (ex. `me01-022` Méga-Camérupt-ex : *"+160 dégâts si le Pokémon Défenseur est Brûlé"*) perdent soit leur condition, soit leurs dégâts bonus.

#### 6. Marqueurs de dégâts (« Placez X marqueurs »), K.O. directs et attaques de Banc (Snipe / Spread)
- **Diagnostic** :
  - Placer des marqueurs de dégâts (qui contourne la Faiblesse, la Résistance et la protection Téracristal sur le Banc) n'a pas de primitive dédiée (`PLACE_DAMAGE_COUNTERS` vs `DAMAGE_ACTIVE`/`DAMAGE_BENCH`).
  - L'IA encode le nombre de marqueurs de façon incohérente : tantôt `value: 13, count: null` (`30th-154` Ectoplasma-ex, ce que le moteur interprétera comme 13 dégâts au lieu de 130 !), tantôt `value: null, count: 13` (`30th-090` Ectoplasma-ex), tantôt `APPLY_SPECIAL_CONDITION(value=1)` (`me02-046` Virovent).
  - **69 attaques ciblant le Banc ou tous les Pokémon adverses** (*"à l'un des Pokémon de votre adversaire"* ou *"à chacun des Pokémon de votre adversaire"*) sont compilées avec `DAMAGE_ACTIVE` au lieu de `DAMAGE_BENCH` (ex. `30th-018` Artikodin — *Grêle*, `me02.5-022` Méga-Dracaufeu Y-ex — *Explosion Y* 280 dégâts à l'un des Pokémon adverses).
  - **K.O. instantanés** (*"il est mis K.O."*, ex. `me01-086` Méga-Absol-ex — *Derniers Instants*) : pas de primitive `KNOCK_OUT`, encodé à tort en `DAMAGE_ACTIVE(value=null, count=6)`.

#### 7. Confusion entre zone source et zone destination dans `AtomicEffect`
- **Diagnostic** : `AtomicEffect` ne possède qu'un seul champ `zone: Optional[str]`.
- **Conséquences** : Pour `SEARCH_DECK` (*"Cherchez dans votre deck un Pokémon et placez-le sur votre Banc"* vs *"ajoutez-le à votre main"*) ou `ATTACH_ENERGY` (*"depuis votre pile de défausse"* vs *"depuis votre main"*), l'IA met tantôt la zone de départ (`zone: "DECK"`), tantôt la zone d'arrivée (`zone: "HAND"` ou `zone: "BENCH"`).

---

### B. Bugs Déterministes et Effets de Bord du Code Python (`deterministic_builder.py` & `schemas.py`)

#### 1. CRITIQUE : Perte ou inversion des dégâts de base sur 100 attaques dans `merge_llm_payload_into_skeleton()`
- **Localisation** : [`deterministic_builder.py`](file:///Users/emmanuelmoulin/.gemini/antigravity/worktrees/POC/pokemon_tcg_compiler/card-compiler/compiler/deterministic_builder.py#L1275-L1293)
- **Mécanisme du bug** :
  ```python
  if base_dmg is not None and base_dmg > 0:
      has_base_dmg = False
      for eff in llm_effects:
          if eff.primitive == EffectPrimitive.DAMAGE_ACTIVE:
              if eff.value is None or eff.value == 0:
                  eff.value = base_dmg
              if not eff.target:
                  eff.target = "OPPONENT_ACTIVE"
              has_base_dmg = True
              break
  ```
  Ce code vérifie uniquement `if eff.primitive == EffectPrimitive.DAMAGE_ACTIVE`, **sans vérifier si `eff.target == "OPPONENT_ACTIVE"`** !
- **Trois effets catastrophiques observés sur 100 attaques** :
  1. **Attaques à dégâts de recul qui n'infligent plus aucun dégât à l'adversaire** : L'IA traduit uniquement le texte du slot (*"Ce Pokémon s'inflige aussi 70 dégâts"*) en `DAMAGE_ACTIVE(target="SELF", value=70)`. La boucle voit ce `DAMAGE_ACTIVE`, met `has_base_dmg = True` et **n'insère jamais les dégâts de base contre l'adversaire** !
     - Exemples : `me01-073` (Hariyama — *Pression Sauvage* 210 dégâts -> n'inflige que 70 à `SELF`), `me02.5-167` (Mangriff-ex — 180 dégâts -> n'inflige que 30 à `SELF`), `me01-033` (Écrapince), `me02-048` (Tauros de Paldea), `me02.5-078` (Noadkoko de la Team Rocket), `me03-052` (Drascore).
  2. **Attaques à réduction de dégâts (`value: -30` sur `SELF`) qui perdent leurs 200 dégâts offensifs** :
     - Exemples : `me03-047` (Méga-Zygarde-ex — *Onde de Gaïa* 200 dégâts : *"ce Pokémon subit 30 dégâts de moins"*) -> compilé uniquement en `DAMAGE_ACTIVE(target="SELF", value=-30)`, les 200 dégâts à l'adversaire ont disparu ! Idem sur `me01-005` (Noadkoko) et `me04-060` (Métang).
  3. **Attaques à effet sur soi (`target="SELF", value=None`) qui s'auto-infligent leurs propres dégâts de base** : Quand le texte dit *"Pendant votre prochain tour, ce Pokémon ne peut pas attaquer"*, l'IA émet parfois `DAMAGE_ACTIVE(target="SELF", value=None)`. La ligne `if eff.value is None: eff.value = base_dmg` injecte alors les dégâts de base dans l'effet ciblant `SELF`, et `if not eff.target:` ne corrige pas `target` car il vaut déjà `"SELF"` !
     - Exemples : `30th-151` (Mewtwo-ex — *Pouvoirs Psychiques* 230 dégâts -> s'inflige 230 dégâts à `SELF` !), `me03-053` (Yveltal-ex — *Frappe Ténébreuse* 210 dégâts -> s'inflige 210 dégâts à `SELF` !), `me01-050` (Méga-Élecsprint-ex — 120 dégâts à `SELF`), `me05-007` (Heatran — 120 dégâts à `SELF`).

#### 2. CRITIQUE : Fallback silencieux vers `DRAW_CARDS` dans `_coerce_effect_primitive()` (521 effets `DRAW_CARDS` fantômes !)
- **Localisation** : [`schemas.py`](file:///Users/emmanuelmoulin/.gemini/antigravity/worktrees/POC/pokemon_tcg_compiler/card-compiler/compiler/schemas.py#L365-L384)
- **Mécanisme du bug** : Lorsque le LLM génère un nom de primitive hors enum (ex. `COIN_FLIP`, `LOOK_HAND`, `PREVENT_DAMAGE`, `MILL_DECK`, etc.), `_coerce_effect_primitive()` ne lève pas d'erreur et exécute `return EffectPrimitive.DRAW_CARDS` à la ligne 384.
- **Conséquence** : **521 effets** sont compilés en `DRAW_CARDS` alors que le texte de la carte ne contient ni le mot « piochez » ni le mot « draw » !
  - Exemples : `30th-022` (Froussardine — *"Lancez une pièce. Si c'est pile, cette attaque ne fait rien"* -> `DRAW_CARDS(count=1)`), `30th-026` (Pikachu — *"Votre adversaire montre sa main"* -> `DRAW_CARDS(target="OPPONENT")`), `sv10-148` (Rattatac de la Team Rocket — *"Lancez 2 pièces..."* -> `DRAW_CARDS`), `30th-072` (Zarbi — *"récupérez une carte Récompense"* -> `DRAW_CARDS(zone="PRIZE")`), ainsi que des dizaines d'attaques de recherche dans le deck (`30th-013` Victini, `30th-017` Lokhlass, `30th-076` Xerneas) où le LLM a confondu recherche et pioche ou copié l'exemple du prompt.

#### 3. Écrasement de `ATTACH_ENERGY` sur les Énergies Spéciales
- **Localisation** : [`deterministic_builder.py`](file:///Users/emmanuelmoulin/.gemini/antigravity/worktrees/POC/pokemon_tcg_compiler/card-compiler/compiler/deterministic_builder.py#L1298-L1312)
- **Mécanisme du bug** : Le squelette déterministe d'une `SPECIAL_ENERGY` initialise `effects=[AtomicEffect(primitive=ATTACH_ENERGY, target="OWN_POKEMON_ANY")]`. Mais lors de la fusion du slot `energy_0`, `act_copy.effects = llm_effects` remplace la liste par les effets traduits par le LLM, et `translate_slot_deterministically()` ne réinjecte pas `ATTACH_ENERGY`.
- **Conséquence** : Si le LLM ne traduit que l'effet spécial (ex. `sv08-191` Énergie Enrichissante : *"piochez 4 cartes"*, `sv10.5w-086` Énergie Amorce : *"défaussez..."*), l'action `PLAY_FROM_HAND` de l'Énergie Spéciale **perd sa primitive `ATTACH_ENERGY`** !

#### 4. `SHUFFLE_HAND_DRAW` codé en dur à `count=6` dans `translate_slot_deterministically()`
- **Localisation** : [`deterministic_builder.py`](file:///Users/emmanuelmoulin/.gemini/antigravity/worktrees/POC/pokemon_tcg_compiler/card-compiler/compiler/deterministic_builder.py#L1041-L1055)
- **Mécanisme du bug** : Dès que le texte contient *"mélangez votre main"* ou *"dessous de son deck"* + *"pioche"*, `det_effs` ajoute `SHUFFLE_HAND_DRAW(count=6)` et la fusion (ligne 1305) l'ajoute si la primitive diffère. Or Juge (*Judge*) fait piocher 4 cartes, et Mashynn (*Iono*) fait piocher autant de cartes que de Récompenses restantes.

#### 5. `canUseTurn1GoingSecond` forcé à `False` sur tous les Niveau 1 et Niveau 2
- **Localisation** : [`deterministic_builder.py`](file:///Users/emmanuelmoulin/.gemini/antigravity/worktrees/POC/pokemon_tcg_compiler/card-compiler/compiler/deterministic_builder.py#L706) et ligne 756 (`canUseTurn1GoingSecond=is_base`).
- **Mécanisme du bug** : Toutes les attaques et tous les talents des Pokémon `STAGE_1` et `STAGE_2` ont `canUseTurn1GoingSecond: false`. Or en JCC Pokémon, un Niveau 1/2 mis en jeu au Tour 1 (ex. via `svp-173` Évoli *Évolution Boostée*, ou *Salvatore* / *Timmy*) peut utiliser ses talents ou attaquer au Tour 1 en jouant second. C'est l'action `EVOLVE` qui est restreinte au Tour 1, pas l'action `ATTACK` ou `USE_ABILITY` une fois le Pokémon en jeu.

#### 6. Balises HTML brutes de TCGdex non nettoyées (32 cartes) et carte sans texte dans TCGdex (`30th-128`)
- **Balises HTML** : Dans le set `30th`, TCGdex inclut des balises `<span class="energy-symbol Lightning" title="Électrique">Lightning</span>` et `<em>(N'appliquez ni la Faiblesses...)</em>`. `_normalize_whitespace()` ne retire pas les balises HTML, qui polluent `rawRulesText` et les prompts envoyés aux LLM.
- **Donnée manquante TCGdex** : La carte `30th-128` (*Hyper Ball*) a `fr.effect: null` et `en.effect: null` dans TCGdex. Le builder l'a donc compilée en `STATIC_DETERMINISTIC` avec `effects: []` et `aiRole: "GUEST_TECH"`.

---

### C. Erreurs de l'IA & Biais du Prompt sur `playableActions`

#### 1. Biais de copie de l'exemple du `CODING_SYSTEM_PROMPT` (`DRAW_CARDS`, `count: 2`, `zone: "DECK"`)
- **Localisation** : [`llm_engine.py`](file:///Users/emmanuelmoulin/.gemini/antigravity/worktrees/POC/pokemon_tcg_compiler/card-compiler/compiler/llm_engine.py#L72-L99)
- **Diagnostic** : Le `CODING_SYSTEM_PROMPT` contient un unique exemple JSON concret montrant `"primitive": "DRAW_CARDS", "target": "PLAYER", "count": 2, "zone": "DECK"`.
- **Conséquence** : Sur **24 cartes** dont l'effet est complexe ou non supporté (lancers de pièce, double attaque de `sv06-018` Pomdramour, meule de `sv06-048` Colhomard, esquive de `me02.5-095` Brocélôme), Qwen 2.5 Coder a **recopié mot pour mot l'effet `DRAW_CARDS(count=2, target="PLAYER", zone="DECK")` de l'exemple du prompt** !

#### 2. Explosion du vocabulaire en texte libre (`preconditions`, `target`, `zone`, `filter`)
Parce que ces champs sont typés en `str` libre au lieu d'Enums ou d'une grammaire contrôlée :
- **`preconditions` : 1 481 chaînes distinctes !**
  - Pour dire qu'une carte doit être en main ou active, l'IA invente des dizaines de variantes incompatibles : `SELF_IS_ACTIVE`, `SELF_IS_IN_HAND`, `SELF_IN_HAND`, `SELF_IS_PLAYED_FROM_HAND`, `HAND`, `OWN_TURN`, `IT_IS_YOUR_TURN`, `YOUR_TURN`, `PLAYER_IS_DURING_TURN`, `DURING_YOUR_TURN`.
  - Mélange de noms français et anglais dans les conditions de présence en jeu : `HAS_IN_PLAY: Moltres` sur une carte française (`30th-055` Électhor) vs `BENCH_HAS_ARTIKODIN` sur `30th-130` (Sulfura).
- **`target` : plus de 40 valeurs hors spécification** :
  - Outre les 6 cibles prévues (`SELF`, `OPPONENT_ACTIVE`, `OPPONENT_BENCH`, `OWN_BENCH`, `OWN_POKEMON_ANY`, `PLAYER`), on trouve : `OPPONENT` (582 fois), `DECK` (56 fois — confondu avec `zone`), `OPPONENT_POKEMON_ANY` (41 fois), `BENCH` (36 fois), `OPPONENT_DECK` (36 fois), la chaîne littérale `"None"` (30 fois) et `"NONE"` (17 fois), et même `"PLAYER"` comme cible de dégâts de recul (`me02-060` Carvanha : *"Ce Pokémon s'inflige aussi 10 dégâts"* -> `target: "PLAYER"`).
- **`zone` : plus de 30 valeurs hors spécification** :
  - Contient `ENERGY` (124 fois — confondu avec `filter`), `PRIZE` (18 fois), `ATTACHED_ENERGY` (16 fois), `SELF` (15 fois), `SEARCHED` (15 fois), `BENCH,ACTIVE` (6 fois).
- **`filter` : absence de syntaxe standardisée** :
  - Pour filtrer une Énergie de base, on trouve : `CATEGORY:ENERGY|STAGE:BASE` (104x), `CATEGORY:ENERGY|STAGE:BASIC` (67x), `BASIC_ENERGY` (41x), `Basic` (14x), `ENERGY` (49x), ou de simples lettres isolées (`L`, `G`, `TYPE:F`).

---

## 2. Audit de `deadCardCondition`

1. **Explosion de chaînes libres non interprétables par un moteur : 1 403 valeurs distinctes**
   - Un moteur de jeu déterministe ne peut pas évaluer 1 403 chaînes inventées à la volée telles que `"NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY"`, `"OPPONENT_ACTIVE_NOT_EX"`, `"NO_BENCHED_POKEMON_WITH_DAMAGE_COUNTERS"`, etc.
2. **Inversion logique majeure sur 98 actions (`deadCardCondition` = condition d'activation !)**
   - Sur **98 actions**, l'IA a écrit dans `deadCardCondition` la **condition requise pour jouer la carte** (souvent identique mot pour mot à `preconditions[0]`) au lieu de la condition qui rend la carte **morte** :
     - Ex. `KO_SUFFERED_LAST_TURN` (11 fois, ex. `30th-091` Noctali, `me02.5-121` Koraidon-ex, `me02.5-142` Favianos-ex) au lieu de `NO_KO_SUFFERED_LAST_TURN` (8 fois). Si le moteur lit `deadCardCondition == "KO_SUFFERED_LAST_TURN"`, il considérera que *Favianos-ex* est une carte morte précisément quand un Pokémon a été mis K.O. au tour précédent !
     - Ex. `30th-003` (Muciole) : `preconditions: ["OPPONENT_BENCH_HAS_POKEMON"]` et `deadCardCondition: "OPPONENT_BENCH_HAS_POKEMON"`.
     - Ex. `30th-108` (Gromago) : `preconditions: ["HAND_SIZE_EXACT:30"]` et `deadCardCondition: "HAND_SIZE_EXACT:30"`.
     - Ex. `SELF_IS_ACTIVE` mis dans `deadCardCondition` (8 fois) au lieu de `SELF_NOT_ACTIVE`.
3. **Omission sur les actions conditionnelles**
   - Sur 9 676 actions compilées, seules 2 769 renseignent `deadCardCondition` (dont la majorité est le `"BENCH_FULL"` déterministe sur `PLAY_FROM_HAND`). De nombreuses cartes Dresseur ou Talents très restrictifs ont `deadCardCondition: null`.

---

## 3. Audit de `strategicEvaluator` (`aiRole`, `turnPhaseWeights`, `decklistSynergyRequirements`)

### A. Biais massif de copie des poids `turnPhaseWeights` du prompt système (44 % des cartes IA !)
- **Diagnostic** : L'exemple JSON dans `CODING_SYSTEM_PROMPT` (`compiler/llm_engine.py`, lignes 90-95) affiche :
  ```json
  "aiRole": "MAIN_ATTACKER",
  "turnPhaseWeights": {"turn1": 0.9, "turn2": 0.9, "turn3": 0.8, "turn4Plus": 0.8}
  ```
- **Conséquence mesurée sur le corpus** :
  - **839 cartes** ont exactement `{turn1: 0.9, turn2: 0.9, turn3: 0.8, turn4Plus: 0.8}`.
  - **420 cartes** (Niveau 1 et 2 dont `turn1` est forcé à `0.0` par Python) ont exactement `{turn1: 0.0, turn2: 0.9, turn3: 0.8, turn4Plus: 0.8}`.
  - Au total, **1 259 cartes sur 2 864 compilées par IA (soit 44,0 %)** ont simplement recopié les poids de l'exemple du prompt système sans évaluation réelle de la courbe de puissance de la carte !

### B. Mauvaise classification de `aiRole` (Dresseurs et petits Pokémon de base en `MAIN_ATTACKER`)
- **60 cartes Dresseur classées comme attaquants (`49 MAIN_ATTACKER` + `11 SECONDARY_ATTACKER`)** :
  - Exemples : `me02-123` (Échange -> `MAIN_ATTACKER`), `me01-166` (Ballon -> `MAIN_ATTACKER`), `me01-124` (Puissance Premium Pro -> `MAIN_ATTACKER`), `30th-126` (Poké Registre -> `MAIN_ATTACKER`), `me02.5-182` (Vénus et Colombe -> `MAIN_ATTACKER`).
  - *Cause* : Aucun garde-fou dans `deterministic_builder.py` n'interdit `MAIN_ATTACKER` / `SECONDARY_ATTACKER` lorsque `category != POKEMON`, et l'exemple du prompt incite Qwen 2.5 Coder à choisir `MAIN_ATTACKER` par défaut.
- **260 petits Pokémon de Base (≤ 70 PV, non-RuleBox) classés `MAIN_ATTACKER`** :
  - Exemples : `30th-022` (Froussardine 30 PV dont la seule attaque fait 0 dégât sur pile -> `MAIN_ATTACKER` avec poids `0.9, 0.9, 0.8, 0.8`), `30th-009` (Goupix 70 PV -> `MAIN_ATTACKER`), `me02-019` (Charbambin -> `MAIN_ATTACKER`).
  - Ces pré-évolutions de 30 à 70 PV ne sont jamais les attaquants principaux d'un deck mais des bases d'évolution.

### C. Pollution de `decklistSynergyRequirements` (1 630 tags distincts)
- Alors que les tags générés par Python respectent le format formel `requires_energy_type:<Type>` et `requires_evolution_line:<Nom>`, le champ `additionalSynergyTags` rempli par le LLM a injecté **plus de 1 500 tags descriptifs libres en anglais** inexploitables par un validateur de decklist :
  - Exemples les plus fréquents : `high_damage` (45x), `variable_damage` (24x), `self_damage` (24x), `high_damage_potential` (22x), `defensive_strategy` (21x), `damage_boost` (17x), `status_condition` (18x), ou des noms anglais non préfixés (`Moltres`, `Articuno`).

---

## 4. Synthèse et Plan d'Action Recommandé pour la Suite

| Priorité | Cible | Action corrective recommandée |
| :--- | :--- | :--- |
| **P0 (Critique — Python)** | `deterministic_builder.py` (L.1277) | Dans `merge_llm_payload_into_skeleton()`, ne considérer `has_base_dmg = True` que si `eff.primitive == DAMAGE_ACTIVE and eff.target in (None, "OPPONENT_ACTIVE", "OPPONENT") and (eff.value is None or eff.value > 0)`. Ne jamais écraser un effet `target="SELF"` avec `base_dmg`. |
| **P0 (Critique — Python)** | `schemas.py` (L.384) | Supprimer le fallback silencieux `return EffectPrimitive.DRAW_CARDS` dans `_coerce_effect_primitive()`. Mapper explicitement les synonymes connus et rejeter/filtrer les effets invalides plutôt que d'inventer une pioche. |
| **P0 (Critique — Python)** | `deterministic_builder.py` (`SPECIAL_ENERGY` & `STAGE_1/2`) | Conserver systématiquement `ATTACH_ENERGY` en tête des effets d'une `SPECIAL_ENERGY`. Corriger `canUseTurn1GoingSecond=True` sur les attaques et talents des Niveau 1/2, et retirer le `count=6` codé en dur sur `SHUFFLE_HAND_DRAW`. Nettoyer les balises HTML (`re.sub(r"<[^>]+>", "", text)`). |
| **P1 (Schéma `EngineCardModel`)** | `compiler/schemas.py` | 1) Ajouter le support des **lancers de pièce** (`coinFlipMode: Optional[Literal["SINGLE_HEADS", "MULTI_COIN", "UNTIL_TAILS"]]`, `coinCount: Optional[int]`).<br>2) Ajouter le **calcul de dégâts dynamiques** (`scalingOperator: Optional[Literal["+", "x"]]`, `bonusPerUnit: Optional[int]`, `scalingMetric: Optional[str]`).<br>3) Ajouter le champ `specialCondition: Optional[SpecialConditionEnum]` (`POISONED`, `BURNED`, `ASLEEP`, `PARALYZED`, `CONFUSED`).<br>4) Séparer `sourceZone` et `destinationZone`.<br>5) Ajouter les primitives manquantes (`PLACE_DAMAGE_COUNTERS`, `MODIFY_DAMAGE_TAKEN`, `MODIFY_DAMAGE_DEALT`, `MODIFY_HP`, `PREVENT_EFFECTS`, `LOCK_NEXT_TURN_ATTACK`, `LOCK_RETREAT`, `KNOCK_OUT`, `MILL_DECK`, `MOVE_ENERGY`, `MOVE_DAMAGE_COUNTERS`).<br>6) Distinguer `PASSIVE_ABILITY` / `ON_PLAY_ABILITY` / `ACTIVATED_ABILITY`. |
| **P1 (Prompt & IA)** | `compiler/llm_engine.py` | 1) Remplacer les valeurs concrètes de l'exemple JSON du `CODING_SYSTEM_PROMPT` par des placeholders génériques (`"<EffectPrimitive>"`, `0.0`) pour éliminer le biais de copie de `DRAW_CARDS(count=2)` et des poids `(0.9, 0.9, 0.8, 0.8)`.<br>2) Interdire par validation déterministe `MAIN_ATTACKER` / `SECONDARY_ATTACKER` sur les cartes `TRAINER` et `ENERGY`.<br>3) Restreindre `preconditions`, `deadCardCondition`, `target`, `zone` et `filter` à un vocabulaire fermé documenté dans le prompt et validé par post-processeur (et inverser automatiquement toute `deadCardCondition` identique à une `precondition`). |
| **P2 (Re-compilation ciblée)** | `re-run` CLI | Une fois les correctifs P0/P1 appliqués, relancer la Passe 2 (beaucoup plus rapide que la Passe 1, ou Passe 1+2 sur les 37 anciennes cartes + `30th-128`). |
