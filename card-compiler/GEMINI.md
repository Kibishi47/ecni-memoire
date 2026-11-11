# Guide d'Architecture et de Développement — `card-compiler`

Ce dossier contient le compilateur de cartes **Pokémon TCG (Format Standard)** qui transforme les données brutes de **TCGdex** (`data/raw_tcgdex/*.json`) en modèles formels typés Pydantic V2 (`EngineCardModel`) stockés dans `data/compiled_cards/*.json` et consolidés dans `data/cards_database.json`.

---

## 1. Principe Directeur : Déterministe d'abord, IA ciblée ensuite

Le compilateur sépare strictement ce qui relève de la donnée structurée et ce qui relève de l'interprétation sémantique des textes :

1. **Construction 100 % déterministe ([compiler/deterministic_builder.py](compiler/deterministic_builder.py))** :
   - Identité (`CardIdentity`) : catégorie, sous-catégorie, `isRuleBox`, `prizeCardsGiven` (distinction `Méga-...-ex` moderne = 3 vs anciennes `Mega ...-EX` = 2), `isAceSpec`, `isAncient`, `isFuture`, `isTera`, `isTechnicalMachine`, `legalStandard`.
   - Statistiques Pokémon (`PokemonStats`) : PV, types, stade, chaîne d'évolution, coût de retraite, faiblesses/résistances.
   - Squelettes des `playableActions` : `PLAY_FROM_HAND`, `EVOLVE`, `RETREAT`, `ATTACH_ENERGY`, `USE_ABILITY` / `TRIGGERED_ABILITY` / `PASSIVE_ABILITY`, `ATTACK`, coûts d'énergie, dégâts numériques de base (`DAMAGE_ACTIVE`), règles Tour 1 (`canUseTurn1GoingFirst`, `canUseTurn1GoingSecond`), héritage de rééditions sans texte (`resolve_missing_reprint_effects`).
   - Cas particuliers gérés déterministiquement :
     - **Énergies de base** ([compiler/static_cards.py](compiler/static_cards.py)) : compilées à 0 token LLM.
     - **Capsules Techniques / Outils à attaque (`isTechnicalMachine`)** : `trainer_0` reste une attache pure (`effects=[]`, `deadCardCondition="NO_POKEMON_WITHOUT_TOOL"`) compatible avec le simulateur, et chaque attaque conférée est générée dans `attack_0`, `attack_1`… avec son coût en énergie.
     - **Stades (`STADIUM`)** : `deadCardCondition` garantit `STADIUM_ALREADY_IN_PLAY_SAME_NAME` (y compris en composition `|`).
     - **Fossiles Objets** : préconditions `BENCH_HAS_EMPTY_SLOT` / `BENCH_FULL`, conservation des éventuels Talents (`ability_0`), et verrou de retraite ciblé sur `SELF`.
2. **Traduction IA micro-ciblée (`slots_for_llm`)** :
   - L'IA ne traduit **que** les slots textuels (`EffectSlotToCompile`) et le profil stratégique (`LLMCompiledPayload`).
   - Les valeurs numériques d'attaques, coûts, dégâts de recul, lancers de pièce (`CoinFlipMode`), scaling (`ScalingOperator`/`ScalingMetric`), conditions spéciales (`SpecialCondition`), inversion de `deadCardCondition` et garde-fous de `strategicEvaluator` sont revérifiés et verrouillés par `merge_llm_payload_into_skeleton` et `sanitize_and_enrich_card`.

---

## 2. Pipeline Two-Pass & Modèles IA

Configuration centralisée dans [compiler/models_config.py](compiler/models_config.py) :

- **Backend Apple MLX par défaut** : **`mlx-community/gemma-4-26b-a4b-it-4bit`** (utilisé en Passe 1 et Passe 2 ; Passe 1 `max_tokens=8192` par défaut, configurable via `--max-tokens` / `REASONING_MAX_TOKENS`, Passe 2 `max_tokens=2048` à `temperature=0.1`).
- **Passe 1 — Raisonnement de Juge ([compiler/reasoning_engine.py](compiler/reasoning_engine.py))** :
  - `enable_thinking=True` **toujours activé et non borné** (même sur les cartes simples), avec sampling officiel Google Gemma 4 (`temperature=1.0`, `top_p=0.95`, `top_k=64`).
  - Capture le canal `<|channel>thought...<channel|>` dans `rawThinkingProcess`, extrait `reasoningText`, et détecte toute troncature (`finishReason`, `wasTruncated`).
  - Reçoit le socle statique des règles officielles ([`CORE_RULES_SYSTEM_BLOCK`](compiler/rules_knowledge.py)) dans `REASONING_SYSTEM_PROMPT`, plus les micro-règles dynamiques pertinentes pour la carte courante via [`format_relevant_rules_block`](compiler/rules_knowledge.py).
  - Sauvegarde les analyses dans `data/reasoning_texts/{card_id}.json`.
- **Déduplication & Batching continu MLX ([compiler/mlx_utils.py](compiler/mlx_utils.py), [compiler/two_pass_pipeline.py](compiler/two_pass_pipeline.py))** :
  - `compute_card_rule_signature` génère une empreinte canonique SHA-256 des règles/statistiques : toute réédition ou variante d'illustration identique réutilise instantanément les fiches Passe 1 & Passe 2 (`dedupSourceCardId`, clonage sans perte avec conservation du `cardId` et de l'`identity` propres à chaque carte).
  - `run_mlx_continuous_batch` exécute `BatchGenerator` (`mlx-lm`) en continu (`MLX_BATCH_SIZE` / `--batch-size`, défaut `4`) pour la Passe 1 et la Passe 2 (avec réessai séquentiel ciblé en Passe 2 en cas d'erreur JSON).
- **Libération stricte mémoire ([compiler/two_pass_pipeline.py](compiler/two_pass_pipeline.py))** :
  - Déchargement complet du modèle Passe 1 (`close()`, `gc.collect()`, vidage cache GPU/MLX) avant de charger le modèle Passe 2.
- **Passe 2 — Codage JSON ([compiler/mlx_engine.py](compiler/mlx_engine.py), [compiler/llm_engine.py](compiler/llm_engine.py))** :
  - `enable_thinking=False` (`disable_thinking=True`) pour générer uniquement le JSON strict `LLMCompiledPayload` sans trace de pensée inutile (`extract_json_payload` nettoie tout reliquat de balise `<|channel>thought` / `<think>` par sécurité).

---

## 3. Cartographie des Modules (`compiler/`)

| Fichier | Rôle principal |
| :--- | :--- |
| `schemas.py` | Enums fermés (`EffectPrimitive` ×29, `ActionType` ×8, `EffectTarget`, `ZoneType`, `CoinFlipMode`, `ScalingOperator`, `ScalingMetric`, `SpecialCondition`, `AIRole`) et modèles Pydantic V2 (`EngineCardModel`, `LLMCompiledPayload`). **Aucun fallback silencieux vers `DRAW_CARDS`** (toute primitive inconnue lève `ValueError`). |
| `deterministic_builder.py` | Squelette déterministe, signature canonique de déduplication (`compute_card_rule_signature`), extracteurs FR/EN, factorisation talents/attaques, normalisation `preconditions` / `deadCardCondition`, garde-fous `strategicEvaluator`. |
| `rules_knowledge.py` | Socle officiel distillé (*Pokémon TCG Rules Scarlet & Violet*) et sélecteur contextuel dynamique des micro-règles par carte. |
| `post_processor.py` | Post-traitement unitaire (`sanitize_and_enrich_card`) et réparation déterministe de masse (`repair_compiled_corpus`) générant `data/cards_to_recompile_llm.txt`. |
| `reasoning_engine.py` | Moteur Passe 1 (`ReasoningEngine`, prompt juge, sampling officiel Gemma 4, détection troncature, batching, séparation thinking/texte). |
| `mlx_utils.py` | Utilitaires MLX partagés : tokenisation sécurisée sans double `<bos>`, sampler officiel, vidage mémoire Metal et boucle de batching continu `BatchGenerator`. |
| `llm_engine.py` | Prompt Passe 2 (`CODING_SYSTEM_PROMPT`), extraction JSON, moteur `llama-cpp-python` GGUF + GBNF. |
| `mlx_engine.py` | Moteur natif Apple MLX (`mlx-lm`) avec streaming, batching continu (`compile_cards_batch`) et contrôle explicite `enable_thinking`. |
| `lm_studio_compiler.py` | Client HTTP REST pour inférence via LM Studio. |
| `two_pass_pipeline.py` | Orchestration Passe 1 → déchargement RAM → Passe 2 avec déduplication automatique cache & intra-lot. |
| `tcgdex_fetcher.py` | Téléchargement, cache brut `raw_tcgdex/` et index Standard TCGdex. |
| `static_cards.py` | Construction instantanée des Énergies de Base. |
| `models_config.py` | Résolution des modèles par mode (`single` / `two_pass`), intensité (`soft` / `intense`) et backend (`mlx` / `llama_cpp`). |
| `cli.py` / `main.py` | Interface CLI Typer (`run`, `reason`, `code`, `re-run`, `repair-compiled`, `sync`, `remaining`, `inspect`, `count`, `stats`, `fetch-cards`, `update-cards`). |

---

## 4. Règles & Conventions de Modification

1. **Commits atomiques systématiques** :
   - Toujours effectuer un commit clair et logique à la fin de chaque tâche ou lot de corrections validé.
2. **Contraintes sur les Prompts IA** :
   - **Ne jamais introduire d'exemples concrets biaisants** (poids figés à copier, carte-type recopiée) dans `CODING_SYSTEM_PROMPT` ou `REASONING_SYSTEM_PROMPT`.
   - Toute nouvelle règle de jeu officielle doit passer par `rules_knowledge.py` : soit dans `CORE_RULES_SYSTEM_BLOCK` si elle s'applique à toutes les cartes (en restant ultra-compacte pour le cache MLX), soit dans `_CONTEXTUAL_RULE_TABLE` si elle ne concerne qu'un sous-ensemble (Stades, Outils, CT, Fossiles, Téra, VSTAR, Zone Perdue, etc.).
3. **Alignement avec le simulateur (`simulator/`)** :
   - Maintenir la compatibilité stricte des primitives, cibles, zones et tokens canoniques attendus par le moteur de simulation (`SELF_IS_ACTIVE`, `BENCH_HAS_EMPTY_SLOT`, `BENCH_FULL`, `PLAYER_BEHIND_ON_PRIZES`, `NOT_BEHIND_ON_PRIZES`, `KO_SUFFERED_LAST_TURN`, `OPPONENT_PRIZES_EXACT_COUNT`, `STADIUM_ALREADY_IN_PLAY_SAME_NAME`, `trainer_0.effects == []` sur les Outils/Machines Techniques).
   - Toute évolution sur `deterministic_builder.py` ou `post_processor.py` impactant des cartes existantes doit rester **idempotente** sous `python3 main.py repair-compiled`.
4. **Tests & Données** :
   - Ne jamais lancer d'inférence LLM réelle ni d'appels réseau TCGdex dans les tests automatisés ; utiliser des mocks ou fixtures locales.
   - Exécuter l'ensemble des tests unitaires du dossier après toute modification :
     ```bash
     cd card-compiler && python3 -m unittest discover -s tests -v
     ```
   - Les caches volumineux (`data/**/*.json`) et `.env` sont ignorés par git ; `data/cards_to_recompile_llm.txt` est suivi.

---

## 5. Commandes CLI Essentielles

```bash
# Réparer déterministiquement tout le corpus compilé et régénérer cards_database.json
python3 main.py repair-compiled --dry-run
python3 main.py repair-compiled

# Inspecter l'avancement ou les cartes restantes à compiler
python3 main.py count
python3 main.py remaining

# Recompiler uniquement les cartes listées (Passe 2 ou Two-Pass)
python3 main.py re-run --phase 2 --ids-file data/cards_to_recompile_llm.txt
```
