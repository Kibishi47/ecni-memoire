"""Moteur d'inférence IA local en mémoire via `llama-cpp-python` (Apple Metal M4 + Constrained Decoding GBNF).

Ce module :
1. Sélectionne dynamiquement le meilleur modèle `.gguf` selon le palier `--tier` (`qwen3` par défaut en `Q6_K`,
   `max` en 30B-A3B / 32B `Q4_K_M`, ou `fast` en 7B `Q4_K_M`) via `huggingface_hub.list_repo_files` et le
   télécharge via `hf_hub_download`.
2. Charge une seule fois le modèle directement en RAM/VRAM avec `Llama(..., n_gpu_layers=-1)`.
3. Applique le `SYSTEM_PROMPT` expert Pokémon TCG avec **Schema-Guided Chain-of-Thought** (`reasoningAnalysis`
   en tout premier champ du schéma GBNF `LLMCompiledCardPart`).
4. Fusionne la sortie contrainte avec `CardIdentity` et `PokemonStats`, puis exécute le post-processeur
   déterministe `sanitize_and_enrich_card` pour produire un `EngineCardModel` 100 % conforme.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

# Désactivation de Xet et de hf_transfer pour éviter les plantages de Background Writer sous macOS
os.environ["HF_HUB_DISABLE_XET"] = "1"
os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"

from huggingface_hub import hf_hub_download, list_repo_files, try_to_load_from_cache

from compiler import load_env_file
from compiler.post_processor import sanitize_and_enrich_card
from compiler.schemas import (
    ActionSourceType,
    ActionTiming,
    CardSubCategory,
    CompilationMetadata,
    EngineCardModel,
    LLMCompiledCardPart,
)
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle


class ModelTier(str, Enum):
    """Paliers de modèles GGUF optimisés pour MacBook Pro M4 (24 Go RAM unifiée)."""

    qwen3 = "qwen3"
    max = "max"
    fast = "fast"


# Constantes de compatibilité et candidats par palier
DEFAULT_MODEL_REPO_ID = "Qwen/Qwen3-14B-GGUF"
DEFAULT_MODEL_FILENAME = "Qwen3-14B-Q6_K.gguf"

FAST_MODEL_REPO_ID = "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"
FAST_MODEL_FILENAME = "qwen2.5-coder-7b-instruct-q4_k_m.gguf"

TIER_CANDIDATES: Dict[ModelTier, List[Tuple[str, List[str], str]]] = {
    ModelTier.qwen3: [
        ("Qwen/Qwen3-14B-GGUF", ["q6_k", "q5_k_m", "q4_k_m"], "Qwen3-14B-Q6_K.gguf"),
        ("bartowski/Qwen_Qwen3-14B-GGUF", ["q6_k_l", "q6_k", "q5_k_m", "q4_k_m"], "Qwen_Qwen3-14B-Q6_K.gguf"),
        ("unsloth/Qwen3-14B-GGUF", ["q6_k", "q5_k_m", "q4_k_m"], "Qwen3-14B-Q6_K.gguf"),
        (
            "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF",
            ["q6_k", "q5_k_m", "q4_k_m"],
            "qwen2.5-coder-14b-instruct-q6_k.gguf",
        ),
    ],
    ModelTier.max: [
        ("Qwen/Qwen3-30B-A3B-GGUF", ["q4_k_m", "q5_k_m", "q6_k"], "Qwen3-30B-A3B-Q4_K_M.gguf"),
        ("bartowski/Qwen_Qwen3-30B-A3B-GGUF", ["q4_k_m", "q5_k_m"], "Qwen_Qwen3-30B-A3B-Q4_K_M.gguf"),
        ("unsloth/Qwen3-30B-A3B-GGUF", ["q4_k_m", "q5_k_m"], "Qwen3-30B-A3B-Q4_K_M.gguf"),
        (
            "Qwen/Qwen2.5-Coder-32B-Instruct-GGUF",
            ["q4_k_m", "q5_k_m"],
            "qwen2.5-coder-32b-instruct-q4_k_m.gguf",
        ),
    ],
    ModelTier.fast: [
        (
            "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF",
            ["q4_k_m", "q5_k_m", "q6_k"],
            "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
        ),
    ],
}


def resolve_best_gguf_for_tier(
    tier: ModelTier = ModelTier.qwen3,
    hf_token: Optional[str] = None,
) -> Tuple[str, str]:
    """Sélectionne le meilleur fichier .gguf disponible en tenant compte du cache local et de l'espace disque."""
    candidates = TIER_CANDIDATES.get(tier, TIER_CANDIDATES[ModelTier.qwen3])

    for repo_id, preferred_quants, fallback_file in candidates:
        all_quants = list(preferred_quants) + ["q4_k_m", "q5_k_m", "q6_k"]
        for q in all_quants:
            test_filenames = [
                fallback_file,
                f"qwen2.5-coder-14b-instruct-{q}.gguf",
                f"Qwen3-14B-{q.upper()}.gguf",
                f"Qwen_Qwen3-14B-{q.upper()}.gguf",
                f"qwen2.5-coder-7b-instruct-{q}.gguf",
                f"qwen2.5-coder-32b-instruct-{q}.gguf",
                f"Qwen3-30B-A3B-{q.upper()}.gguf",
            ]
            for fn in test_filenames:
                try:
                    cached_path = try_to_load_from_cache(repo_id, fn)
                    if cached_path is not None and isinstance(cached_path, (str, Path)) and Path(cached_path).exists():
                        return repo_id, fn
                except Exception:
                    pass

    try:
        free_gb = shutil.disk_usage(Path.home()).free / (1024**3)
    except Exception:
        free_gb = 50.0

    for repo_id, preferred_quants, fallback_file in candidates:
        quants_to_try = list(preferred_quants)
        if free_gb < 14.0:
            quants_to_try = [q for q in ["q4_k_m", "q5_k_m", "q4_0"] if q in quants_to_try] or ["q4_k_m"]

        try:
            files = list_repo_files(repo_id=repo_id, token=hf_token)
            gguf_files = [
                f for f in files
                if f.lower().endswith(".gguf")
                and "mmproj" not in f.lower()
                and not re.search(r"-\d{5}-of-\d{5}\.gguf$", f.lower())
            ]
            if not gguf_files:
                continue

            for quant in quants_to_try:
                for gf in gguf_files:
                    if quant.lower() in gf.lower():
                        return repo_id, gf

            return repo_id, gguf_files[0]
        except Exception:
            continue

    fallback_repo, _, fallback_file = candidates[-1]
    if free_gb < 14.0 and "14b" in fallback_file.lower():
        fallback_file = "qwen2.5-coder-14b-instruct-q4_k_m.gguf"
    return fallback_repo, fallback_file


def resolve_gguf_from_spec(
    model_spec: str,
    hf_token: Optional[str] = None,
) -> Tuple[str, str, Optional[Path]]:
    """Résout une spécification de modèle sous forme de chemin local ou repo/fichier Hugging Face.

    Retourne (repo_id, filename, local_path).
    """
    spec = model_spec.strip()

    expanded = Path(os.path.expanduser(spec))
    if expanded.is_file():
        return "LOCAL_FILE", expanded.name, expanded.resolve()

    if ":" in spec:
        parts = spec.split(":", 1)
        return parts[0].strip(), parts[1].strip(), None

    if spec.lower().endswith(".gguf") and "/" in spec:
        r_id, f_name = spec.rsplit("/", 1)
        return r_id.strip(), f_name.strip(), None

    if "/" in spec:
        repo_id = spec.strip()
        try:
            files = list_repo_files(repo_id=repo_id, token=hf_token)
            gguf_files = [
                f for f in files
                if f.lower().endswith(".gguf")
                and "mmproj" not in f.lower()
                and not re.search(r"-\d{5}-of-\d{5}\.gguf$", f.lower())
            ]
            for q in ["q6_k", "q5_k_m", "q4_k_m", "q4_0"]:
                for target_q in [f"-{q}.gguf", f"_{q}.gguf", f"-{q.upper()}.gguf", f"_{q.upper()}.gguf"]:
                    matches = [f for f in gguf_files if f.lower().endswith(target_q.lower())]
                    if matches:
                        return repo_id, matches[0], None
            if gguf_files:
                return repo_id, gguf_files[0], None
        except Exception:
            pass
        return repo_id, f"{repo_id.split('/')[-1]}.gguf", None

    if spec.lower().endswith(".gguf"):
        return DEFAULT_MODEL_REPO_ID, spec, None

    low_spec = spec.lower()
    if low_spec in TIER_CANDIDATES:
        cand = TIER_CANDIDATES[ModelTier(low_spec)][0]
        return cand[0], cand[2], None

    return DEFAULT_MODEL_REPO_ID, DEFAULT_MODEL_FILENAME, None


SYSTEM_PROMPT = """Tu es un compilateur expert du Jeu de Cartes à Collectionner Pokémon (Pokémon TCG - Format Standard).
Ta mission est de traduire les données brutes TCGdex d'une carte Pokémon TCG en un modèle formel déterministe `LLMCompiledCardPart` composé d'une analyse préalable obligatoire (`reasoningAnalysis`), de primitives atomiques d'actions (`playableActions`) et d'un évaluateur stratégique dynamique (`strategicEvaluator`).

### 1. RÈGLE N°1 : RAISONNEMENT PRÉALABLE OBLIGATOIRE (`reasoningAnalysis`)
Avant de générer `category`, `subCategory`, `playableActions` et `strategicEvaluator`, tu dois **obligatoirement** rédiger dans `reasoningAnalysis` ton analyse en 4 points :
1. **Catégorie, Sous-catégorie et Rôle stratégique** de la carte.
2. **Coûts explicites** exigés par le texte (ex: *"vous ne pouvez utiliser cette carte que si vous défaussez 2 autres cartes de votre main"* -> `HAND_MIN_OTHER_CARDS` minCount 2 + `DISCARD_FROM_HAND` count 2 ; ou *"défausser autant d'Énergies de base"* -> `DISCARD_ENERGY_FROM_PLAY`).
3. **Filtres exacts** (`maxHp: 70` pour Poffin, `energyType: "Feu"` quand le texte mentionne `Énergie {R}` / `Basic {R} Energy` / `Énergie Feu`, `subCategory: null` pour Hyper Ball qui cherche n'importe quel Pokémon, `targetFilter: null` pour Recherche Rapide qui cherche n'importe quelle carte).
4. **Synergies de decklist et conditions de carte morte** en main ou dans le deck.

IMPORTANT : Reste synthétique et concis dans `reasoningAnalysis` (environ 100 à 250 mots au total, sans verbiage ni répétitions). L'analyse doit servir de tremplin logique direct sans consommer inutilement de tokens.

### 2. RÈGLES CRITIQUES ET INTERDICTIONS D'HALLUCINATIONS SÉMANTIQUES
0. **INTERDICTION FORMELLE D'INVENTER OU DE COPIER UN TALENT (`ABILITY_*`)** :
   - Ne te base JAMAIS sur les talents d'autres cartes.
   - Si le JSON brut TCGdex d'une carte ne contient aucune entrée dans `abilities` (ou `abilities: []`), il est **STRICTEMENT INTERDIT** d'inventer, d'imaginer ou de copier une action de type `ABILITY_*` (comme `ability_infernal_reign`, `ability_quick_search`, etc.).
   - Pour tout Pokémon sans talent (ex: **Ire-Foudre-ex `sv05-123`**), `playableActions` doit contenir **EXCLUSIVEMENT** les attaques réelles de la carte (`sourceType: "ATTACK"`).

1. **INTERDICTION D'UTILISER `SHUFFLE_HAND_AND_DRAW` POUR UN MÉLANGE DE DECK** :
   - Lorsqu'une carte de recherche (ex: Pepper / Arven, Hyper Ball, Faiblo Ball, Poffin Copain-Copain) se termine par *"Mélangez ensuite votre deck"* (*"Then, shuffle your deck"*), n'ajoute **JAMAIS** `SHUFFLE_HAND_AND_DRAW`.
   - Pour **Mashynn (Iono)** qui place la main **en dessous du deck** (*"bottom of their deck"*) et pioche selon les cartes Récompense restantes, utilise **exclusivement** `SHUFFLE_HAND_BOTTOM_DRAW_PRIZES` avec `targetFilter: null`, `primaryRole: "HAND_DISRUPTION"` et `turnPhaseWeights.turn1: 0.8`.

2. **DISTINCTION STRICTE ENTRE `SEARCH_DECK_TO_BENCH` ET `DEAL_DAMAGE_ACTIVE`** :
   - `SEARCH_DECK_TO_BENCH` (`sourceZone: "DECK"`, `targetZone: "BENCH"`) : obligatoire quand une carte cherche des Pokémon dans le deck et les place sur le Banc (**Faiblo Ball**, **Poffin Copain-Copain**). Ajoute la précondition `BENCH_HAS_EMPTY_SLOTS` et `primaryRole: "BENCH_DEPLOYER"`.
   - `DEAL_DAMAGE_ACTIVE` : réservé **exclusivement** aux attaques (`sourceType: "ATTACK"`) qui infligent des dégâts.

3. **COÛTS DE DÉFAUSSE DE LA MAIN (`Hyper Ball`, etc.)** :
   - Si le texte dit *"défaussez X autres cartes de votre main"* / *"discard X other cards from your hand"* (ex: **Hyper Ball** avec `X=2`), tu DOIS mettre :
     - Dans `preconditions` : `{"type": "HAND_MIN_OTHER_CARDS", "zone": "HAND", "minCount": 2, "targetFilter": null}`
     - Dans `costs` : `{"type": "DISCARD_FROM_HAND", "count": 2, "targetFilter": null}`
   - De plus, **Hyper Ball** cherche n'importe quel Pokémon (`category: "POKEMON"`, **`subCategory: null`**) et son `primaryRole` est `"CONSISTENCY_TUTOR"`.

4. **SYMBOLES D'ÉNERGIE TCGDEX (`{R}`, `{L}`, `{F}`, etc.)** :
   - Dans TCGdex, `{R}` signifie `"Feu"` (Fire), `{L}` signifie `"Électrique"` (Lightning), `{F}` signifie `"Combat"` (Fighting), `{G}` signifie `"Plante"`, `{W}` signifie `"Eau"`, `{P}` signifie `"Psy"`, `{D}` signifie `"Obscurité"`, `{M}` signifie `"Métal"`, `{C}` signifie `"Incolore"`.
   - Sur **Dracaufeu-ex (`sv03-125`)**, le talent *Règne Infernal* mentionne `Énergie {R} de base` / `Basic {R} Energy` : tu DOIS mettre `energyType: "Feu"` et `subCategory: "BASIC_ENERGY"` dans `targetFilter`.

5. **PEPPER / ARVEN (`sv01-166`)** :
   - Cherche 1 `ITEM` et 1 `TOOL` dans le deck : génère 2 effets `SEARCH_DECK_TO_HAND` (`ITEM` + `TOOL` avec `upTo: true`), mais 1 SEULE précondition `ZONE_HAS_MATCHING_CARD` (`ITEM`) pour ne pas bloquer par un AND logique s'il n'y a plus d'Outil dans le deck. 2 synergies (`ITEM` min 4 + `TOOL` min 1), 2 `inGameDeadCardConditions` (`NO_VALID_TARGET_IN_DECK` pour `ITEM` et `TOOL`), `primaryRole: "CONSISTENCY_TUTOR"` et `intrinsicBaseScore: 88`.

6. **IRE-FOUDRE-EX / RAGING BOLT EX (`sv05-123`)** :
   - `primaryRole: "MAIN_ATTACKER"`, AUCUN talent (`abilities: []`), 2 attaques :
     - Attaque 1 *Explosion Hurlante* (*Burst Roar*) : `"Défaussez votre main, puis piochez 6 cartes"` -> effet `DISCARD_HAND_AND_DRAW` (`count: 6`, `sourceZone: "DECK"`, `targetZone: "HAND"`).
     - Attaque 2 *Tempête Éclats* (*Bellowing Thunder*, `70×` dégâts par énergie de base défaussée de vos Pokémon) -> `costs`: `[{"type": "DISCARD_ENERGY_FROM_PLAY", "count": 1, "targetFilter": {"category": "ENERGY", "subCategory": "BASIC_ENERGY", "maxHp": null, "energyType": null, "specificCardName": null}}]` et `effects`: `[{"primitive": "DEAL_DAMAGE_ACTIVE", "sourceZone": "ACTIVE", "targetZone": "ACTIVE", "count": 1, "upTo": false, "targetFilter": null, "baseDamage": 70, "damageScalingPerOpponentPrizeTaken": null}]`.

7. **INVARIANTS PHYSIQUES TOUR 1 & STADES D'ÉVOLUTION (`STAGE_1`, `STAGE_2`)** :
   - Tout Pokémon `STAGE_1` ou `STAGE_2` (**Dracaufeu-ex**, **Roucarnage-ex**) a `canUseTurn1GoingFirst: false`, `canUseTurn1GoingSecond: false` sur toutes ses actions et `turnPhaseWeights.turn1 = 0.0`.

8. **INTERVALLES NUMÉRIQUES STRICTS DANS `strategicEvaluator`** :
   - `turnPhaseWeights` (`turn1`, `turn2`, `turn3`, `turn4Plus`) : nombres décimaux obligatoirement compris entre `0.0` et `2.0` (ex: 1.0, 1.5, 2.0 — INTERDICTION formelle d'excéder 2.0).
   - `intrinsicBaseScore` et `discardPriorityWhenDead` : entiers compris entre `0` et `100`.
   - `holdForNextTurnBonus` : entier compris entre `0` et `50`.

9. **VALEURS STRICTES DES PRIMITIVES (`primitive`) ET MOTIFS DE CARTE MORTE (`reason`)** :
   - Pour toute attaque infligeant des dégâts : `primitive: "DEAL_DAMAGE_ACTIVE"`.
   - Pour un effet d'esquive / protection / immunité : `primitive: "PASSIVE_PREVENT_DAMAGE_OR_EFFECTS"`.
   - Pour `inGameDeadCardConditions` : si la carte n'a pas de condition de carte morte, mets TOUJOURS la liste vide `[]` (n'invente JAMAIS `"NONE"`, `"NOT_APPLICABLE"`, etc.).

---

### 3. EXEMPLE FEW-SHOT #1 — CARTE DRESSEUR OBJET : Super Bonbon (Rare Candy)
```json
{
  "reasoningAnalysis": "1) Catégorie TRAINER / ITEM, rôle EVOLUTION_ACCELERATOR. 2) Aucun coût de défausse, mais exige un Pokémon BASIC en jeu depuis le tour précédent et un STAGE_2 correspondant en main (impossible au Tour 1). 3) Filtres : POKEMON BASIC en jeu et POKEMON STAGE_2 en main. 4) Carte morte s'il ne reste plus de STAGE_2 dans HAND/DECK ou plus de BASIC en jeu/main/deck.",
  "category": "TRAINER",
  "subCategory": "ITEM",
  "playableActions": [
    {
      "actionId": "play_rare_candy",
      "label": "Super Bonbon",
      "sourceType": "TRAINER_PLAY",
      "timing": "ONCE_PER_CARD",
      "canUseTurn1GoingFirst": false,
      "canUseTurn1GoingSecond": false,
      "preconditions": [
        {
          "type": "BASIC_IN_PLAY_PREVIOUS_TURN",
          "zone": "IN_PLAY_ALL",
          "minCount": 1,
          "targetFilter": {
            "category": "POKEMON",
            "subCategory": "BASIC",
            "maxHp": null,
            "energyType": null,
            "specificCardName": null
          }
        },
        {
          "type": "ZONE_HAS_MATCHING_CARD",
          "zone": "HAND",
          "minCount": 1,
          "targetFilter": {
            "category": "POKEMON",
            "subCategory": "STAGE_2",
            "maxHp": null,
            "energyType": null,
            "specificCardName": null
          }
        }
      ],
      "costs": [],
      "effects": [
        {
          "primitive": "EVOLVE_SKIP_STAGE1",
          "sourceZone": "HAND",
          "targetZone": "IN_PLAY_ALL",
          "count": 1,
          "upTo": false,
          "targetFilter": {
            "category": "POKEMON",
            "subCategory": "STAGE_2",
            "maxHp": null,
            "energyType": null,
            "specificCardName": null
          },
          "baseDamage": null,
          "damageScalingPerOpponentPrizeTaken": null
        }
      ]
    }
  ],
  "strategicEvaluator": {
    "primaryRole": "EVOLUTION_ACCELERATOR",
    "intrinsicBaseScore": 92,
    "turnPhaseWeights": {
      "turn1": 0.0,
      "turn2": 1.9,
      "turn3": 1.6,
      "turn4Plus": 0.9
    },
    "decklistSynergyRequirements": [
      {
        "requiredFilter": {
          "category": "POKEMON",
          "subCategory": "STAGE_2",
          "maxHp": null,
          "energyType": null,
          "specificCardName": null
        },
        "minCountInDeck": 1,
        "ifMissingSetValueToZero": true,
        "bonusWeightPerCopy": 15.0
      },
      {
        "requiredFilter": {
          "category": "POKEMON",
          "subCategory": "BASIC",
          "maxHp": null,
          "energyType": null,
          "specificCardName": null
        },
        "minCountInDeck": 2,
        "ifMissingSetValueToZero": true,
        "bonusWeightPerCopy": 10.0
      }
    ],
    "inGameDeadCardConditions": [
      {
        "reason": "NO_STAGE2_LEFT_IN_DECK_OR_HAND",
        "zonesToCheck": ["HAND", "DECK"],
        "targetFilter": {
          "category": "POKEMON",
          "subCategory": "STAGE_2",
          "maxHp": null,
          "energyType": null,
          "specificCardName": null
        }
      },
      {
        "reason": "NO_BASE_POKEMON_LINE_LEFT",
        "zonesToCheck": ["BENCH", "ACTIVE", "HAND", "DECK"],
        "targetFilter": {
          "category": "POKEMON",
          "subCategory": "BASIC",
          "maxHp": null,
          "energyType": null,
          "specificCardName": null
        }
      }
    ],
    "discardPriorityWhenDead": 95,
    "holdForNextTurnBonus": 42
  }
}
```

### 4. EXEMPLE FEW-SHOT #2 — CARTE POKÉMON ATTAQUANT SANS TALENT (abilities: []) :
```json
{
  "reasoningAnalysis": "1) Catégorie POKEMON / BASIC, rôle MAIN_ATTACKER. 2) La carte n'a AUCUN talent dans ses données brutes TCGdex (abilities: []) -> INTERDICTION d'inventer une action ABILITY_*, uniquement des attaques (sourceType: 'ATTACK'). Deux attaques : Attaque 1 (pioche/mise en place, 1 énergie incolore) et Attaque 2 (attaque principale, 2 énergies, 70 dégâts par énergie défaussée). 3) Filtres d'énergie sur les coûts. 4) Synergies avec énergies du deck.",
  "category": "POKEMON",
  "subCategory": "BASIC",
  "playableActions": [
    {
      "actionId": "attack_burst_setup",
      "label": "Mise en Place",
      "sourceType": "ATTACK",
      "timing": "END_OF_TURN_ATTACK",
      "canUseTurn1GoingFirst": false,
      "canUseTurn1GoingSecond": true,
      "preconditions": [
        {
          "type": "SELF_IS_ACTIVE",
          "zone": "ACTIVE",
          "minCount": 1,
          "targetFilter": null
        },
        {
          "type": "SELF_HAS_ENERGY_COST",
          "zone": "ACTIVE",
          "minCount": 1,
          "targetFilter": {
            "category": "ENERGY",
            "subCategory": null,
            "maxHp": null,
            "energyType": "Incolore",
            "specificCardName": null
          }
        }
      ],
      "costs": [],
      "effects": [
        {
          "primitive": "DISCARD_HAND_AND_DRAW",
          "sourceZone": "DECK",
          "targetZone": "HAND",
          "count": 6,
          "upTo": false,
          "targetFilter": null,
          "baseDamage": null,
          "damageScalingPerOpponentPrizeTaken": null
        }
      ]
    },
    {
      "actionId": "attack_thunder_strike",
      "label": "Frappe Foudroyante",
      "sourceType": "ATTACK",
      "timing": "END_OF_TURN_ATTACK",
      "canUseTurn1GoingFirst": false,
      "canUseTurn1GoingSecond": true,
      "preconditions": [
        {
          "type": "SELF_IS_ACTIVE",
          "zone": "ACTIVE",
          "minCount": 1,
          "targetFilter": null
        },
        {
          "type": "SELF_HAS_ENERGY_COST",
          "zone": "ACTIVE",
          "minCount": 2,
          "targetFilter": {
            "category": "ENERGY",
            "subCategory": null,
            "maxHp": null,
            "energyType": "Électrique",
            "specificCardName": null
          }
        }
      ],
      "costs": [
        {
          "type": "DISCARD_ENERGY_FROM_PLAY",
          "count": 1,
          "targetFilter": {
            "category": "ENERGY",
            "subCategory": "BASIC_ENERGY",
            "maxHp": null,
            "energyType": null,
            "specificCardName": null
          }
        }
      ],
      "effects": [
        {
          "primitive": "DEAL_DAMAGE_ACTIVE",
          "sourceZone": "ACTIVE",
          "targetZone": "ACTIVE",
          "count": 1,
          "upTo": false,
          "targetFilter": null,
          "baseDamage": 70,
          "damageScalingPerOpponentPrizeTaken": null
        }
      ]
    }
  ],
  "strategicEvaluator": {
    "primaryRole": "MAIN_ATTACKER",
    "intrinsicBaseScore": 95,
    "turnPhaseWeights": {
      "turn1": 1.7,
      "turn2": 1.9,
      "turn3": 2.0,
      "turn4Plus": 1.9
    },
    "decklistSynergyRequirements": [
      {
        "requiredFilter": {
          "category": "ENERGY",
          "subCategory": "BASIC_ENERGY",
          "maxHp": null,
          "energyType": null,
          "specificCardName": null
        },
        "minCountInDeck": 8,
        "ifMissingSetValueToZero": true,
        "bonusWeightPerCopy": 6.0
      }
    ],
    "inGameDeadCardConditions": [],
    "discardPriorityWhenDead": 30,
    "holdForNextTurnBonus": 32
  }
}
```

Réponds UNIQUEMENT avec l'objet JSON valide respectant strictement le schéma `LLMCompiledCardPart` en commençant par `reasoningAnalysis`.
"""


CODING_SYSTEM_PROMPT = """Tu es un compilateur de code et ingénieur logiciel expert en modélisation formelle pour le Jeu de Cartes à Collectionner Pokémon (Pokémon TCG - Format Standard).
Ta mission est de transcrire l'analyse préalable des règles et les données TCGdex d'une carte Pokémon en un objet JSON rigoureusement conforme au schéma `LLMCompiledCardPart`.

### 1. STRUCTURE EXACTE ET CONTRAINTES DU SCHÉMA `LLMCompiledCardPart`

L'objet JSON racine doit contenir strictement les champs suivants :
1. `reasoningAnalysis` (string) : Synthèse claire et concise (100 à 250 mots) issue de l'analyse préalable des règles.
2. `category` (string) : "POKEMON", "TRAINER", ou "ENERGY".
3. `subCategory` (string) : "BASIC", "STAGE_1", "STAGE_2", "ITEM", "SUPPORTER", "TOOL", "STADIUM", "BASIC_ENERGY", ou "SPECIAL_ENERGY".
4. `playableActions` (liste d'objets) : Chaque action jouable (effet de Dresseur, Talent, Attaque) DOIT obligatoirement contenir TOUS ces champs :
   - `actionId` (string) : identifiant technique snake_case (ex: "play_rare_candy", "attack_burning_darkness", "ability_quick_search").
   - `label` (string) : nom officiel de l'action, de l'attaque ou du talent.
   - `sourceType` (string) : "TRAINER_PLAY", "ABILITY_ACTIVATED", "ABILITY_PASSIVE", "ATTACK", "TOOL_EFFECT", "STADIUM_EFFECT".
   - `timing` (string) : "ONCE_PER_CARD", "ONCE_PER_TURN_ABILITY", "ONCE_PER_TURN_SUPPORTER", "END_OF_TURN_ATTACK", "ON_EVOLVE_TRIGGER", "PASSIVE_CONTINUOUS".
   - `canUseTurn1GoingFirst` (booléen) : false pour toute attaque, tout supporter et toute évolution/Super Bonbon ; true pour les objets basiques.
   - `canUseTurn1GoingSecond` (booléen) : false pour toute évolution/Super Bonbon ; true pour les supporters, attaques et objets basiques.
   - `energyCost` (liste de chaînes) : liste des énergies requises pour les attaques (ex: ["Feu", "Incolore"] ou []).
   - `preconditions` (liste d'objets) : liste d'objets `{"type": "...", "zone": "...", "minCount": 1, "targetFilter": {...}}` ou `[]`. N'utilise JAMAIS de simples chaînes !
   - `costs` (liste d'objets) : coûts explicites (ex: défausse de cartes en main) `[{"type": "DISCARD_FROM_HAND", "count": 2, "targetFilter": null}]` ou `[]`.
   - `effects` (liste d'objets) : primitives d'effets ordonnées. ATTENTION : le champ s'appelle obligatoirement `effects` (et non `primitives`). Chaque effet est un objet :
     * `primitive` (string) : ex: "EVOLVE_SKIP_STAGE1", "DEAL_DAMAGE_ACTIVE", "SEARCH_DECK_TO_HAND", "DRAW_CARDS", "SWITCH_ACTIVE_POKEMON".
     * `sourceZone` (string ou null) : "DECK", "HAND", "DISCARD", "ACTIVE", "BENCH", "IN_PLAY_ALL".
     * `targetZone` (string ou null) : "HAND", "BENCH", "ACTIVE", "DISCARD", "DECK", "IN_PLAY_ALL".
     * `count` (entier) : nombre de cibles (défaut: 1).
     * `upTo` (booléen) : true si le joueur peut choisir "jusqu'à" count cartes, false sinon.
     * `targetFilter` (objet ou null) : `{"category": "...", "subCategory": "...", "maxHp": null, "energyType": null, "specificCardName": null}`.
     * `baseDamage` (entier ou null) : dégâts de base pour les attaques.
     * `damageScalingPerOpponentPrizeTaken` (entier ou null) : bonus de dégâts par carte Récompense adverse.
5. `strategicEvaluator` (objet) : DOIT obligatoirement contenir TOUS ces champs :
   - `primaryRole` (string) : ex: "MAIN_ATTACKER", "SECONDARY_ATTACKER", "BENCH_DEPLOYER", "CONSISTENCY_TUTOR", "EVOLUTION_ACCELERATOR", "HAND_DISRUPTION", "GUST_BOSS_EFFECT", "TECH_UTILITY".
   - `intrinsicBaseScore` (entier de 0 à 100).
   - `turnPhaseWeights` (objet OBLIGATOIRE avec exactement les 4 clés suivantes) :
     `{"turn1": float, "turn2": float, "turn3": float, "turn4Plus": float}`
     (Chaque valeur est un décimal compris entre 0.0 et 2.0. Il est STRICTEMENT INTERDIT d'utiliser des noms alternatifs comme PREPARATION ou MAIN_PHASE).
   - `decklistSynergyRequirements` (liste d'objets) :
     `[{"requiredFilter": {"category": "POKEMON", "subCategory": "STAGE_2", "maxHp": null, "energyType": null, "specificCardName": null}, "minCountInDeck": 1, "ifMissingSetValueToZero": true, "bonusWeightPerCopy": 15.0}]` ou `[]`. N'utilise JAMAIS de simples chaînes !
   - `inGameDeadCardConditions` (liste d'objets) :
     `[{"reason": "NO_STAGE2_LEFT_IN_DECK_OR_HAND", "zonesToCheck": ["HAND", "DECK"], "targetFilter": {...}}]` ou `[]`. N'utilise JAMAIS de simples chaînes !
   - `discardPriorityWhenDead` (entier de 0 à 100).
   - `holdForNextTurnBonus` (entier de 0 à 50).

### 2. EXEMPLE FEW-SHOT DE RÉFÉRENCE : Super Bonbon (Rare Candy - sv04-125)
```json
{
  "reasoningAnalysis": "Super Bonbon (Item) permet d'accélérer l'évolution directe d'un Pokémon de base en Niveau 2 sans passer par le Niveau 1. Injouable au Tour 1. Exige un Pokémon de Base en jeu depuis le tour précédent et un Niveau 2 en main. Carte morte si aucun Niveau 2 n'est disponible.",
  "category": "TRAINER",
  "subCategory": "ITEM",
  "playableActions": [
    {
      "actionId": "play_rare_candy",
      "label": "Super Bonbon",
      "sourceType": "TRAINER_PLAY",
      "timing": "ONCE_PER_CARD",
      "canUseTurn1GoingFirst": false,
      "canUseTurn1GoingSecond": false,
      "energyCost": [],
      "preconditions": [
        {
          "type": "BASIC_IN_PLAY_PREVIOUS_TURN",
          "zone": "IN_PLAY_ALL",
          "minCount": 1,
          "targetFilter": {
            "category": "POKEMON",
            "subCategory": "BASIC",
            "maxHp": null,
            "energyType": null,
            "specificCardName": null
          }
        },
        {
          "type": "ZONE_HAS_MATCHING_CARD",
          "zone": "HAND",
          "minCount": 1,
          "targetFilter": {
            "category": "POKEMON",
            "subCategory": "STAGE_2",
            "maxHp": null,
            "energyType": null,
            "specificCardName": null
          }
        }
      ],
      "costs": [],
      "effects": [
        {
          "primitive": "EVOLVE_SKIP_STAGE1",
          "sourceZone": "HAND",
          "targetZone": "IN_PLAY_ALL",
          "count": 1,
          "upTo": false,
          "targetFilter": {
            "category": "POKEMON",
            "subCategory": "STAGE_2",
            "maxHp": null,
            "energyType": null,
            "specificCardName": null
          },
          "baseDamage": null,
          "damageScalingPerOpponentPrizeTaken": null
        }
      ]
    }
  ],
  "strategicEvaluator": {
    "primaryRole": "EVOLUTION_ACCELERATOR",
    "intrinsicBaseScore": 92,
    "turnPhaseWeights": {
      "turn1": 0.0,
      "turn2": 1.9,
      "turn3": 1.6,
      "turn4Plus": 0.9
    },
    "decklistSynergyRequirements": [
      {
        "requiredFilter": {
          "category": "POKEMON",
          "subCategory": "STAGE_2",
          "maxHp": null,
          "energyType": null,
          "specificCardName": null
        },
        "minCountInDeck": 1,
        "ifMissingSetValueToZero": true,
        "bonusWeightPerCopy": 15.0
      }
    ],
    "inGameDeadCardConditions": [
      {
        "reason": "NO_STAGE2_LEFT_IN_DECK_OR_HAND",
        "zonesToCheck": ["HAND", "DECK"],
        "targetFilter": {
          "category": "POKEMON",
          "subCategory": "STAGE_2",
          "maxHp": null,
          "energyType": null,
          "specificCardName": null
        }
      }
    ],
    "discardPriorityWhenDead": 80,
    "holdForNextTurnBonus": 25
  }
}
```

RÈGLE D'OR : Produis UNIQUEMENT le bloc JSON commençant par '{' et se terminant par '}'."""


def extract_json_payload(text: str) -> str:
    """Extrait et nettoie le JSON généré par le LLM en isolant l'objet `LLMCompiledCardPart` racine."""
    if not text:
        return ""
    text = text.strip()

    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()
    if "<think>" in cleaned:
        first_brace = cleaned.find("{")
        cleaned = cleaned[first_brace:] if first_brace != -1 else ""

    md_blocks = re.findall(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    candidates: List[str] = [b.strip() for b in md_blocks if b.strip()]
    candidates.append(cleaned)

    card_candidate = ""
    fallback_candidate = ""

    for cand in candidates:
        first_brace = cand.find("{")
        if first_brace == -1:
            continue
        last_brace = cand.rfind("}")
        while last_brace > first_brace:
            sub = cand[first_brace : last_brace + 1].strip()
            try:
                val = json.loads(sub)
                if isinstance(val, dict):
                    if any(k in val for k in ("playableActions", "strategicEvaluator", "reasoningAnalysis")):
                        if "primitive" not in val and "actionId" not in val:
                            return sub
                        elif not card_candidate:
                            card_candidate = sub
                    elif not fallback_candidate:
                        fallback_candidate = sub
            except Exception:
                pass
            last_brace = cand.rfind("}", first_brace, last_brace)

    if card_candidate:
        return card_candidate
    if fallback_candidate:
        return fallback_candidate
    return cleaned


def build_user_prompt(bundle: FetchedCardBundle, disable_thinking: bool = False) -> str:
    """Construit le prompt utilisateur détaillé injectant toutes les données TCGdex (FR + EN + lignée)."""
    identity = bundle.identity
    pstats = bundle.pokemon_stats

    payload: Dict[str, Any] = {
        "cardId": identity.cardId,
        "resolvedTcgdexId": bundle.resolved_tcgdex_id,
        "nameFr": identity.nameFr,
        "nameEn": identity.nameEn,
        "deterministicCategory": identity.category.value,
        "deterministicSubCategory": identity.subCategory.value,
        "regulationMark": identity.regulationMark,
        "legalStandard": identity.legalStandard,
        "isAceSpec": identity.isAceSpec,
        "isAncient": identity.isAncient,
        "isFuture": identity.isFuture,
        "isTechnicalMachine": identity.isTechnicalMachine,
        "rawRulesText": identity.rawRulesText,
    }

    if pstats is not None:
        payload["pokemonStats"] = {
            "hp": pstats.hp,
            "types": pstats.types,
            "dexId": pstats.dexId,
            "stage": pstats.stage,
            "evolvesFrom": pstats.evolvesFrom,
            "rootBasicName": pstats.rootBasicName,
            "evolutionChain": pstats.evolutionChain,
            "retreatCost": pstats.retreatCost,
            "weaknesses": pstats.weaknesses,
            "weaknessMultiplier": pstats.weaknessMultiplier,
            "resistances": pstats.resistances,
            "resistanceModifier": pstats.resistanceModifier,
            "prizeCardsGiven": pstats.prizeCardsGiven,
            "isRuleBox": pstats.isRuleBox,
            "isTera": pstats.isTera,
            "isAncient": pstats.isAncient,
            "isFuture": pstats.isFuture,
            "hasAbility": pstats.hasAbility,
        }

    if bundle.raw_fr.get("abilities"):
        payload["abilitiesFr"] = bundle.raw_fr.get("abilities")
    if bundle.raw_en and bundle.raw_en.get("abilities"):
        payload["abilitiesEn"] = bundle.raw_en.get("abilities")
    if bundle.raw_fr.get("attacks"):
        payload["attacksFr"] = bundle.raw_fr.get("attacks")
    if bundle.raw_en and bundle.raw_en.get("attacks"):
        payload["attacksEn"] = bundle.raw_en.get("attacks")
    if bundle.raw_fr.get("effect"):
        payload["effectFr"] = bundle.raw_fr.get("effect")
    if bundle.raw_en and bundle.raw_en.get("effect"):
        payload["effectEn"] = bundle.raw_en.get("effect")

    no_think_directive = ""
    if disable_thinking:
        no_think_directive = (
            "\n\nRÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ. "
            "Ne génère AUCUNE balise <think> ni raisonnement textuel libre avant le JSON. "
            "Commence immédiatement ta réponse par le caractère '{' du JSON racine `LLMCompiledCardPart`.\n"
            "<|think_off|>\n/no_think"
        )

    return (
        "Compile la carte Pokémon TCG suivante en un objet JSON conforme au schéma `LLMCompiledCardPart`.\n"
        "Commence obligatoirement par remplir `reasoningAnalysis` avec ton analyse étape par étape.\n"
        f"Utilise obligatoirement `category`: \"{identity.category.value}\" et "
        f"`subCategory`: \"{identity.subCategory.value}\".\n"
        "Si c'est un POKEMON, génère une action par Talent (`abilitiesFr`) ET une action `ATTACK` par attaque (`attacksFr`).\n"
        "Si le texte mentionne `défaussez X autres cartes de votre main`, ajoute `HAND_MIN_OTHER_CARDS` et `DISCARD_FROM_HAND`.\n"
        "Pour les dégâts d'attaque, utilise `primitive`: 'DEAL_DAMAGE_ACTIVE'. Si la carte n'a pas de condition de carte morte, `inGameDeadCardConditions` doit obligatoirement être [].\n"
        "ATTENTION : L'objet JSON racine doit obligatoirement être `LLMCompiledCardPart` avec `playableActions` et `strategicEvaluator`. Ne renvoie JAMAIS un `ActionEffect` (`primitive`) seul à la racine !\n\n"
        "DONNÉES TCGDEX DE LA CARTE :\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```\n\n"
        f"Produis uniquement l'objet JSON racine `LLMCompiledCardPart`.{no_think_directive}"
    )


def build_coding_prompt(
    bundle: FetchedCardBundle,
    reasoning_text: str,
    disable_thinking: bool = False,
) -> str:
    """Construit le prompt utilisateur pour l'étape de codage JSON (Passe 2)."""
    identity = bundle.identity
    pstats = bundle.pokemon_stats

    payload: Dict[str, Any] = {
        "cardId": identity.cardId,
        "nameFr": identity.nameFr,
        "nameEn": identity.nameEn,
        "category": identity.category.value,
        "subCategory": identity.subCategory.value,
        "setId": identity.setId,
        "localId": identity.localId,
    }

    if pstats:
        payload["pokemonStats"] = {
            "hp": pstats.hp,
            "types": pstats.types,
            "dexId": pstats.dexId,
            "stage": pstats.stage,
            "evolvesFrom": pstats.evolvesFrom,
            "rootBasicName": pstats.rootBasicName,
            "evolutionChain": pstats.evolutionChain,
            "retreatCost": pstats.retreatCost,
            "weaknesses": pstats.weaknesses,
            "weaknessMultiplier": pstats.weaknessMultiplier,
            "resistances": pstats.resistances,
            "resistanceModifier": pstats.resistanceModifier,
            "prizeCardsGiven": pstats.prizeCardsGiven,
            "isRuleBox": pstats.isRuleBox,
            "isTera": pstats.isTera,
            "isAncient": pstats.isAncient,
            "isFuture": pstats.isFuture,
            "hasAbility": pstats.hasAbility,
        }

    if bundle.raw_fr.get("abilities"):
        payload["abilitiesFr"] = bundle.raw_fr.get("abilities")
    if bundle.raw_en and bundle.raw_en.get("abilities"):
        payload["abilitiesEn"] = bundle.raw_en.get("abilities")
    if bundle.raw_fr.get("attacks"):
        payload["attacksFr"] = bundle.raw_fr.get("attacks")
    if bundle.raw_en and bundle.raw_en.get("attacks"):
        payload["attacksEn"] = bundle.raw_en.get("attacks")
    if bundle.raw_fr.get("effect"):
        payload["effectFr"] = bundle.raw_fr.get("effect")
    if bundle.raw_en and bundle.raw_en.get("effect"):
        payload["effectEn"] = bundle.raw_en.get("effect")

    no_think_directive = ""
    if disable_thinking:
        no_think_directive = (
            "\n\nRÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ. "
            "Ne génère AUCUNE balise <think> ni raisonnement textuel libre avant le JSON. "
            "Commence immédiatement ta réponse par le caractère '{' du JSON racine `LLMCompiledCardPart`.\n"
            "<|think_off|>\n/no_think"
        )

    return (
        f"À partir de l'analyse préalable des règles ci-dessous et des données officielles TCGdex, "
        f"compile la carte Pokémon '{identity.nameFr}' ({identity.cardId}) en code JSON conforme au schéma `LLMCompiledCardPart`.\n\n"
        "### 1. ANALYSE PRÉALABLE DES RÈGLES (PASSE 1 - RAISONNEMENT) :\n"
        f"```text\n{reasoning_text.strip()}\n```\n\n"
        "### 2. DONNÉES TCGDEX DE LA CARTE :\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```\n\n"
        "### 3. RAPPELS DE CONFORMITÉ DU SCHÉMA JSON :\n"
        "- `playableActions`: chaque action doit inclure `actionId`, `label`, `sourceType`, `timing`, `canUseTurn1GoingFirst`, `canUseTurn1GoingSecond`, `energyCost`, `preconditions`, `costs`, `effects`.\n"
        "- `effects`: liste d'objets atomiques avec le champ `primitive` (ne pas utiliser la clé 'primitives').\n"
        "- `strategicEvaluator.turnPhaseWeights`: doit contenir exactement les 4 clés `turn1`, `turn2`, `turn3`, `turn4Plus` (nombres décimaux 0.0 à 2.0).\n"
        "- `decklistSynergyRequirements` et `inGameDeadCardConditions`: doivent être des listes d'objets (pas de simples chaînes).\n\n"
        f"Génère uniquement l'objet JSON racine `LLMCompiledCardPart`.{no_think_directive}"
    )


def enforce_ptcg_invariants(
    compiled_part: LLMCompiledCardPart,
    bundle: FetchedCardBundle,
) -> LLMCompiledCardPart:
    """Garantit les invariants de premier niveau des règles Pokémon TCG sur `LLMCompiledCardPart`."""
    compiled_part.category = bundle.identity.category
    compiled_part.subCategory = bundle.identity.subCategory

    # Purge stricte des talents fantômes si le Pokémon n'a aucun talent dans ses données brutes
    raw_abilities = (bundle.raw_fr.get("abilities") or []) + ((bundle.raw_en or {}).get("abilities") or [])
    if not raw_abilities:
        compiled_part.playableActions = [
            act for act in compiled_part.playableActions
            if act.sourceType not in {
                ActionSourceType.ABILITY_ACTIVATED,
                ActionSourceType.ABILITY_ON_EVOLVE,
                ActionSourceType.ABILITY_ON_PLAY_FROM_HAND,
                ActionSourceType.ABILITY_REACTIVE,
                ActionSourceType.ABILITY_PASSIVE,
            }
            and act.timing not in {
                ActionTiming.ONCE_PER_TURN_ABILITY,
                ActionTiming.AS_OFTEN_AS_YOU_LIKE,
                ActionTiming.ON_EVOLVE_TRIGGER,
                ActionTiming.ON_PLAY_FROM_HAND_TRIGGER,
                ActionTiming.ON_DAMAGED_OR_KO_TRIGGER,
            }
        ]

    for action in compiled_part.playableActions:
        if bundle.identity.subCategory == CardSubCategory.SUPPORTER and action.sourceType == ActionSourceType.TRAINER_PLAY:
            action.canUseTurn1GoingFirst = False
            action.canUseTurn1GoingSecond = True
            action.timing = ActionTiming.ONCE_PER_TURN_SUPPORTER

        if action.sourceType == ActionSourceType.ATTACK:
            action.canUseTurn1GoingFirst = False
            action.timing = ActionTiming.END_OF_TURN_ATTACK
            if bundle.identity.subCategory in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}:
                action.canUseTurn1GoingSecond = False

        if any(eff.primitive.value in {"EVOLVE_SKIP_STAGE1", "EVOLVE_NORMAL"} for eff in action.effects):
            action.canUseTurn1GoingFirst = False
            action.canUseTurn1GoingSecond = False

        if bundle.identity.subCategory in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}:
            action.canUseTurn1GoingFirst = False
            action.canUseTurn1GoingSecond = False
            if action.sourceType == ActionSourceType.ABILITY_ON_EVOLVE:
                action.timing = ActionTiming.ON_EVOLVE_TRIGGER

    weights = compiled_part.strategicEvaluator.turnPhaseWeights
    weights.turn1 = max(0.0, min(2.0, round(float(weights.turn1), 2)))
    weights.turn2 = max(0.0, min(2.0, round(float(weights.turn2), 2)))
    weights.turn3 = max(0.0, min(2.0, round(float(weights.turn3), 2)))
    weights.turn4Plus = max(0.0, min(2.0, round(float(weights.turn4Plus), 2)))

    return compiled_part


class LocalLLMCardCompiler:
    """Compilateur IA local chargeant directement le modèle `.gguf` en RAM/VRAM via `llama_cpp.Llama`."""

    def __init__(
        self,
        tier: ModelTier = ModelTier.qwen3,
        fast: bool = False,
        repo_id: Optional[str] = None,
        filename: Optional[str] = None,
        model: Optional[str] = None,
        model_name: Optional[str] = None,
        hf_token: Optional[str] = None,
        n_ctx: int = 16384,
        n_gpu_layers: int = -1,
        verbose: bool = False,
        disable_thinking: Optional[bool] = None,
        thinking: Optional[str] = None,
    ) -> None:
        load_env_file()
        self.hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

        env_thinking = (
            os.environ.get("LM_STUDIO_THINKING")
            or os.environ.get("LM_STUDIO_THINKING_LEVEL")
            or os.environ.get("THINKING")
            or os.environ.get("THINKING_LEVEL")
        )
        is_env_disabled = any(
            str(os.environ.get(k) or "").strip().lower() in {"1", "true", "yes", "on"}
            for k in ("LM_STUDIO_DISABLE_THINKING", "LM_STUDIO_NO_THINK", "NO_THINK", "DISABLE_THINKING")
        )

        if thinking is not None:
            resolved_thinking = str(thinking).strip()
        elif env_thinking:
            resolved_thinking = env_thinking.strip()
        else:
            resolved_thinking = None

        if disable_thinking is True or is_env_disabled:
            resolved_thinking = "null"
        elif disable_thinking is False and thinking is None:
            resolved_thinking = None

        if resolved_thinking is not None:
            cleaned_tk = str(resolved_thinking).strip().lower()
            if not cleaned_tk:
                self.thinking = None
                self.disable_thinking = False
            elif cleaned_tk in {"null", "none", "off", "false", "0", "disabled", "disable"}:
                self.thinking: Optional[str] = "null"
                self.disable_thinking: bool = True
            else:
                self.thinking = cleaned_tk
                self.disable_thinking = False
        else:
            self.thinking = None
            self.disable_thinking = False

        # Résolution du modèle spécifié (argument explicite ou variable d'environnement)
        raw_model = (
            model
            or model_name
            or os.environ.get("LLM_MODEL")
            or os.environ.get("MODEL")
            or os.environ.get("LM_STUDIO_MODEL")
        )
        if raw_model and str(raw_model).strip():
            raw_model = str(raw_model).strip()
            self.model_spec: Optional[str] = raw_model
            r_id, f_name, local_p = resolve_gguf_from_spec(raw_model, hf_token=self.hf_token)
            self.repo_id = r_id
            self.filename = f_name
            self.model_path: Optional[Path] = local_p
            self._resolved = (local_p is not None) or (f_name is not None)
            self.tier = tier
        elif repo_id and filename:
            self.model_spec = None
            self.repo_id = repo_id
            self.filename = filename
            self.model_path = None
            self._resolved = True
            self.tier = tier
        else:
            self.model_spec = None
            self.model_path = None
            resolved_tier = tier
            if tier == ModelTier.qwen3 and not fast:
                env_tier = os.environ.get("MODEL_TIER") or os.environ.get("LLM_TIER") or os.environ.get("TIER")
                if env_tier and env_tier.strip():
                    try:
                        resolved_tier = ModelTier(env_tier.strip().lower())
                    except Exception:
                        pass

            if fast and resolved_tier == ModelTier.qwen3:
                self.tier = ModelTier.fast
            else:
                self.tier = resolved_tier

            # Valeurs initiales avant résolution dynamique via list_repo_files
            default_cand = TIER_CANDIDATES[self.tier][0]
            self.repo_id = default_cand[0]
            self.filename = default_cand[2]
            self._resolved = False

        env_n_ctx = os.environ.get("LOCAL_N_CTX") or os.environ.get("N_CTX")
        self.n_ctx = int(env_n_ctx.strip()) if env_n_ctx and env_n_ctx.strip().isdigit() else n_ctx

        env_gpu = os.environ.get("LOCAL_GPU_LAYERS") or os.environ.get("N_GPU_LAYERS")
        if env_gpu and env_gpu.strip():
            try:
                self.n_gpu_layers = int(env_gpu.strip())
            except ValueError:
                self.n_gpu_layers = n_gpu_layers
        else:
            self.n_gpu_layers = n_gpu_layers

        self.verbose = verbose
        self._llm: Any = None
        self._json_schema: Dict[str, Any] = LLMCompiledCardPart.model_json_schema()

    def resolve_and_download_model(self) -> Path:
        """Sélectionne automatiquement le meilleur `.gguf` sur HF (avec fallback) et le télécharge."""
        if self.model_path is not None and self.model_path.exists():
            return self.model_path

        if self._resolved and self.repo_id and self.filename:
            try:
                cached = try_to_load_from_cache(self.repo_id, self.filename)
                if cached is not None and isinstance(cached, (str, Path)) and Path(cached).exists():
                    self.model_path = Path(cached)
                    return self.model_path
            except Exception:
                pass
            try:
                downloaded_path = hf_hub_download(
                    repo_id=self.repo_id,
                    filename=self.filename,
                    token=self.hf_token,
                )
                self.model_path = Path(downloaded_path)
                return self.model_path
            except Exception as exc:
                if self.model_spec:
                    raise RuntimeError(f"Impossible de télécharger le modèle spécifié '{self.model_spec}' ({self.repo_id}/{self.filename}): {exc}")

        if not self._resolved:
            self.repo_id, self.filename = resolve_best_gguf_for_tier(
                tier=self.tier,
                hf_token=self.hf_token,
            )
            self._resolved = True

        try:
            cached = try_to_load_from_cache(self.repo_id, self.filename)
            if cached is not None and isinstance(cached, (str, Path)) and Path(cached).exists():
                self.model_path = Path(cached)
                return self.model_path
        except Exception:
            pass

        tried_pairs: List[Tuple[str, str]] = [(self.repo_id, self.filename)]
        for cand_repo, _, cand_file in TIER_CANDIDATES.get(self.tier, []):
            for candidate_filename in [
                cand_file,
                cand_file.replace("q6_k", "q4_k_m").replace("Q6_K", "Q4_K_M"),
                "qwen2.5-coder-14b-instruct-q4_k_m.gguf",
                "qwen2.5-coder-7b-instruct-q4_k_m.gguf",
            ]:
                pair = (cand_repo, candidate_filename)
                if pair not in tried_pairs:
                    tried_pairs.append(pair)

        for r_id, f_name in tried_pairs:
            try:
                cached = try_to_load_from_cache(r_id, f_name)
                if cached is not None and isinstance(cached, (str, Path)) and Path(cached).exists():
                    self.repo_id = r_id
                    self.filename = f_name
                    self.model_path = Path(cached)
                    return self.model_path
            except Exception:
                continue

        last_err: Optional[Exception] = None
        for r_id, f_name in tried_pairs:
            try:
                downloaded_path = hf_hub_download(
                    repo_id=r_id,
                    filename=f_name,
                    token=self.hf_token,
                )
                self.repo_id = r_id
                self.filename = f_name
                self.model_path = Path(downloaded_path)
                return self.model_path
            except Exception as exc:
                last_err = exc
                continue

        raise RuntimeError(f"Impossible de télécharger un modèle GGUF pour le palier {self.tier}: {last_err}")

    def ensure_model_downloaded(self) -> Path:
        """Alias rétrocompatible vers `resolve_and_download_model`."""
        return self.resolve_and_download_model()

    def load_model_in_memory(self) -> None:
        """Charge une seule fois le modèle `.gguf` en RAM/VRAM avec `n_gpu_layers=-1` (Apple Metal)."""
        if self._llm is not None:
            return

        gguf_path = self.resolve_and_download_model()
        from llama_cpp import Llama

        self._llm = Llama(
            model_path=str(gguf_path),
            n_gpu_layers=self.n_gpu_layers,
            n_ctx=self.n_ctx,
            n_batch=512,
            verbose=self.verbose,
        )

    def compile_card(
        self,
        bundle: FetchedCardBundle,
        reasoning_text: Optional[str] = None,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        max_retries: int = 2,
        stream: Optional[bool] = None,
        on_token: Optional[Callable[[int, float], None]] = None,
        disable_thinking: Optional[bool] = None,
        thinking: Optional[str] = None,
    ) -> EngineCardModel:
        """Compile une carte unique avec Constrained Decoding GBNF + CoT, post-processe et retourne `EngineCardModel`.

        Gère automatiquement la détection de troncation de token (`finish_reason == 'length'` ou `EOF while parsing`)
        avec réessai dynamique et augmentation du budget de tokens (`max_tokens`).
        """
        if is_basic_energy(bundle):
            return build_basic_energy_model(bundle)

        self.load_model_in_memory()

        effective_thinking = thinking if thinking is not None else self.thinking
        if disable_thinking is True:
            effective_thinking = "null"
        elif disable_thinking is False and effective_thinking == "null":
            effective_thinking = None

        if effective_thinking is not None:
            cleaned_tk = str(effective_thinking).strip().lower()
            if not cleaned_tk:
                is_thinking_disabled = self.disable_thinking
                thinking_level = self.thinking
            elif cleaned_tk in {"null", "none", "off", "false", "0", "disabled", "disable"}:
                is_thinking_disabled = True
                thinking_level: Optional[str] = "null"
            else:
                is_thinking_disabled = False
                thinking_level = cleaned_tk
        else:
            is_thinking_disabled = self.disable_thinking
            thinking_level = "null" if is_thinking_disabled else None

        if reasoning_text is not None and str(reasoning_text).strip():
            user_prompt = build_coding_prompt(bundle, reasoning_text, disable_thinking=is_thinking_disabled)
            sys_prompt = CODING_SYSTEM_PROMPT
        else:
            user_prompt = build_user_prompt(bundle, disable_thinking=is_thinking_disabled)
            sys_prompt = SYSTEM_PROMPT

        if is_thinking_disabled:
            sys_prompt = (
                f"{sys_prompt}\n\n"
                "RÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ. "
                "Tu ne dois générer AUCUNE balise <think>...</think> ni raisonnement textuel libre avant le JSON. "
                "Génère directement et uniquement le JSON conforme au schéma `LLMCompiledCardPart`."
            )

        if is_thinking_disabled and max_tokens == 4096:
            current_max_tokens = 2048
        else:
            current_max_tokens = max_tokens

        last_error: Optional[Exception] = None
        compiled_part: Optional[LLMCompiledCardPart] = None
        elapsed: float = 0.0
        should_stream = stream if stream is not None else (on_token is not None)

        for attempt in range(max_retries + 1):
            if attempt > 0:
                current_max_tokens = min(self.n_ctx - 3000, current_max_tokens + 2048)

            t0 = time.perf_counter()

            if hasattr(self._llm, "reset"):
                try:
                    self._llm.reset()
                except Exception:
                    pass

            chat_kwargs: Dict[str, Any] = {
                "messages": [
                    {"role": "system", "content": sys_prompt},
                    {"role": "user", "content": user_prompt},
                ],
                "response_format": {
                    "type": "json_object",
                    "schema": self._json_schema,
                },
                "temperature": temperature,
                "max_tokens": current_max_tokens,
            }
            if thinking_level == "null" or is_thinking_disabled:
                chat_kwargs["chat_template_kwargs"] = {"enable_thinking": False}
                chat_kwargs["chat_template_args"] = {"enable_thinking": False}
                chat_kwargs["enable_thinking"] = False
                chat_kwargs["reasoning_effort"] = "none"
            elif thinking_level is not None:
                chat_kwargs["chat_template_kwargs"] = {"enable_thinking": True}
                chat_kwargs["chat_template_args"] = {"enable_thinking": True}
                chat_kwargs["enable_thinking"] = True
                if thinking_level in {"low", "medium", "high"}:
                    chat_kwargs["reasoning_effort"] = thinking_level
                elif thinking_level.isdigit():
                    chat_kwargs["max_thinking_tokens"] = int(thinking_level)

            def _call_create_chat(stream_flag: bool) -> Any:
                kwargs = dict(chat_kwargs)
                if stream_flag:
                    kwargs["stream"] = True
                try:
                    return self._llm.create_chat_completion(**kwargs)
                except TypeError:
                    basic = {
                        "messages": kwargs["messages"],
                        "response_format": kwargs["response_format"],
                        "temperature": kwargs["temperature"],
                        "max_tokens": kwargs["max_tokens"],
                    }
                    if stream_flag:
                        basic["stream"] = True
                    return self._llm.create_chat_completion(**basic)

            try:
                if should_stream:
                    try:
                        stream_resp = _call_create_chat(True)
                        accumulated_content = []
                        token_count = 0
                        last_cb_time = 0.0
                        first_token_time: Optional[float] = None
                        last_token_time: Optional[float] = None
                        window_start_time: Optional[float] = None
                        window_start_tokens = 0
                        live_tps = 0.0
                        finish_reason = None
                        for chunk in stream_resp:
                            choices = chunk.get("choices") or []
                            if choices:
                                c0 = choices[0]
                                if c0.get("finish_reason"):
                                    finish_reason = c0["finish_reason"]
                                delta = c0.get("delta") or {}
                                d_content = delta.get("content") or ""
                                if d_content:
                                    accumulated_content.append(d_content)
                                    token_count += 1
                                    now = time.perf_counter()
                                    if first_token_time is None:
                                        first_token_time = now
                                        window_start_time = now
                                        window_start_tokens = token_count
                                    last_token_time = now

                                    # Rafraîchissement du débit instantané toutes les secondes (sliding window de 1s)
                                    if window_start_time is not None:
                                        window_elapsed = now - window_start_time
                                        if window_elapsed >= 1.0:
                                            delta_tokens = max(0, token_count - window_start_tokens)
                                            live_tps = round(delta_tokens / max(0.0001, window_elapsed), 1)
                                            window_start_time = now
                                            window_start_tokens = token_count

                                    if on_token:
                                        if (now - last_cb_time >= 0.05) or (token_count == 2 and last_cb_time == 0.0):
                                            on_token(token_count, live_tps)
                                            last_cb_time = now

                        if on_token and token_count > 0:
                            now = time.perf_counter()
                            if live_tps > 0.0:
                                final_tps = live_tps
                            elif token_count > 1 and first_token_time is not None:
                                final_gen_elapsed = max(0.0001, (last_token_time or now) - first_token_time)
                                final_tps = round((token_count - 1) / final_gen_elapsed, 1)
                            elif token_count == 1 and first_token_time is not None:
                                final_gen_elapsed = max(0.0001, (last_token_time or now) - first_token_time)
                                final_tps = round(1.0 / final_gen_elapsed, 1)
                            else:
                                final_tps = 0.0
                            on_token(token_count, final_tps)

                        gen_duration: Optional[float] = None
                        tps: Optional[float] = None
                        ttft: Optional[float] = None
                        if first_token_time is not None:
                            ttft = round(max(0.0, first_token_time - t0), 3)
                            end_t = last_token_time or time.perf_counter()
                            raw_delta = max(0.0001, end_t - first_token_time)
                            if token_count > 1:
                                gen_duration = raw_delta * (token_count / (token_count - 1))
                                tps = round((token_count - 1) / raw_delta, 1)
                            elif token_count == 1:
                                gen_duration = raw_delta
                                tps = round(1.0 / raw_delta, 1)

                        raw_content = "".join(accumulated_content)
                        choice = {
                            "message": {"content": raw_content},
                            "finish_reason": finish_reason or "stop",
                        }
                        completion = {
                            "choices": [choice],
                            "usage": {"completion_tokens": token_count},
                            "generation_duration": gen_duration,
                            "time_to_first_token": ttft,
                            "tokens_per_second": tps,
                        }
                    except (AttributeError, TypeError):
                        completion = _call_create_chat(False)
                else:
                    completion = _call_create_chat(False)
            except RuntimeError as rt_err:
                err_text = str(rt_err)
                if "-3" in err_text or "out of memory" in err_text.lower() or "insufficient memory" in err_text.lower():
                    raise RuntimeError(
                        f"Mémoire GPU/Metal saturée sur Apple Silicon ({rt_err}). "
                        f"Le modèle '{self.filename or self.repo_id}' (20+ Go) dépasse les ~18.6 Go allouables par Metal sur votre Mac 24 Go. "
                        "Conseil : Utilisez 'LLM_PROVIDER=lm_studio' pour déporter ce modèle sur votre serveur dédié, "
                        "ou utilisez un modèle local 14B (ex: laissez LLM_MODEL vide dans .env)."
                    ) from rt_err
                raise

            elapsed = max(0.001, round(time.perf_counter() - t0, 3))
            choice = completion["choices"][0]
            finish_reason = choice.get("finish_reason")
            raw_content = choice["message"]["content"]

            if finish_reason == "length" and attempt < max_retries:
                continue

            clean_json_str = extract_json_payload(raw_content)

            try:
                compiled_part = LLMCompiledCardPart.model_validate_json(clean_json_str)
                break
            except Exception as val_err:
                last_error = val_err
                try:
                    raw_dict = json.loads(clean_json_str)
                    if isinstance(raw_dict, dict):
                        if "primitive" in raw_dict and "playableActions" not in raw_dict:
                            attack_label = "Attaque 1"
                            if bundle.raw_fr.get("attacks"):
                                attack_label = bundle.raw_fr["attacks"][0].get("name") or "Attaque 1"
                            raw_dict = {
                                "reasoningAnalysis": f"Encapsulation automatique de l'effet d'attaque '{raw_dict.get('primitive')}' pour {bundle.card_id}.",
                                "category": bundle.identity.category.value,
                                "subCategory": bundle.identity.subCategory.value,
                                "playableActions": [
                                    {
                                        "actionId": "attack_1",
                                        "label": attack_label,
                                        "sourceType": "ATTACK",
                                        "timing": "END_OF_TURN_ATTACK",
                                        "canUseTurn1GoingFirst": False,
                                        "canUseTurn1GoingSecond": True,
                                        "preconditions": [],
                                        "costs": [],
                                        "effects": [raw_dict],
                                    }
                                ],
                                "strategicEvaluator": {
                                    "primaryRole": "MAIN_ATTACKER",
                                    "intrinsicBaseScore": 50,
                                    "discardPriorityWhenDead": 70,
                                    "holdForNextTurnBonus": 10,
                                    "decklistSynergyRequirements": [],
                                    "inGameDeadCardConditions": [],
                                    "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
                                },
                            }

                        elif "actionId" in raw_dict and "playableActions" not in raw_dict:
                            raw_dict = {
                                "reasoningAnalysis": f"Encapsulation automatique de l'action '{raw_dict.get('actionId')}' pour {bundle.card_id}.",
                                "category": bundle.identity.category.value,
                                "subCategory": bundle.identity.subCategory.value,
                                "playableActions": [raw_dict],
                                "strategicEvaluator": {
                                    "primaryRole": "MAIN_ATTACKER",
                                    "intrinsicBaseScore": 50,
                                    "discardPriorityWhenDead": 70,
                                    "holdForNextTurnBonus": 10,
                                    "decklistSynergyRequirements": [],
                                    "inGameDeadCardConditions": [],
                                    "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
                                },
                            }

                        strat = raw_dict.get("strategicEvaluator")
                        if isinstance(strat, dict):
                            weights = strat.get("turnPhaseWeights")
                            if isinstance(weights, dict):
                                for k in ["turn1", "turn2", "turn3", "turn4Plus"]:
                                    if k in weights:
                                        try:
                                            weights[k] = max(0.0, min(2.0, float(weights[k])))
                                        except Exception:
                                            pass
                        compiled_part = LLMCompiledCardPart.model_validate(raw_dict)
                        break
                except Exception:
                    pass

                err_str = str(val_err).lower()
                if (
                    "eof" in err_str
                    or "expecting value" in err_str
                    or finish_reason == "length"
                ) and attempt < max_retries:
                    continue
        else:
            raise last_error or RuntimeError(f"Échec de validation de la carte {bundle.card_id}")

        compiled_part = enforce_ptcg_invariants(compiled_part, bundle)

        usage = completion.get("usage") if isinstance(completion, dict) else {}
        completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
        generation_duration = completion.get("generation_duration") if isinstance(completion, dict) else None
        ttft = completion.get("time_to_first_token") if isinstance(completion, dict) else None

        tokens_per_second: Optional[float] = None
        if isinstance(completion, dict) and completion.get("tokens_per_second") is not None:
            tokens_per_second = completion.get("tokens_per_second")
        elif isinstance(completion_tokens, (int, float)) and completion_tokens > 0:
            if generation_duration and generation_duration > 0:
                tok_to_div = (completion_tokens - 1) if completion_tokens > 1 else completion_tokens
                tokens_per_second = round(float(tok_to_div) / float(generation_duration), 1)
            elif elapsed > 0:
                tokens_per_second = round(float(completion_tokens) / float(elapsed), 1)

        metadata = CompilationMetadata(
            modelRepoId=self.repo_id,
            modelFilename=self.filename,
            compilationTimeSeconds=elapsed,
            compiledAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=int(completion_tokens) if isinstance(completion_tokens, (int, float)) else None,
            tokensPerSecond=tokens_per_second,
            generationTimeSeconds=round(generation_duration, 3) if generation_duration is not None else None,
            timeToFirstTokenSeconds=round(ttft, 3) if ttft is not None else None,
        )

        engine_card = EngineCardModel(
            cardId=bundle.card_id,
            identity=bundle.identity,
            pokemonStats=bundle.pokemon_stats,
            category=compiled_part.category,
            subCategory=compiled_part.subCategory,
            playableActions=compiled_part.playableActions,
            strategicEvaluator=compiled_part.strategicEvaluator,
            compilationMetadata=metadata,
        )

        engine_card = sanitize_and_enrich_card(bundle, engine_card)
        return engine_card

    def close(self) -> None:
        """Libère les ressources locales et vide la mémoire Metal."""
        self._llm = None
        import gc
        gc.collect()
