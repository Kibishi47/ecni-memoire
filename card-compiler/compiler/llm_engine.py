"""Moteur d'inférence IA local en mémoire via `llama-cpp-python` (Apple Metal M4 + Constrained Decoding GBNF).

Ce module :
1. Télécharge automatiquement le modèle `.gguf` depuis Hugging Face via `huggingface_hub.hf_hub_download`
   (par défaut `Qwen/Qwen2.5-Coder-14B-Instruct-GGUF` en `Q4_K_M`, ou `7B` avec `--fast`).
2. Charge une seule fois le modèle directement en RAM/VRAM avec `Llama(..., n_gpu_layers=-1)`.
3. Applique le `SYSTEM_PROMPT` expert Pokémon TCG (avec règles anti-hallucinations et 2 exemples Few-Shot complets)
   et force la sortie via `response_format={"type": "json_object", "schema": LLMCompiledCardPart.model_json_schema()}`.
4. Fusionne la sortie contrainte avec `CardIdentity` et `PokemonStats`, puis exécute le post-processeur
   déterministe `sanitize_and_enrich_card` pour produire un `EngineCardModel` 100 % conforme.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

from huggingface_hub import hf_hub_download

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
from compiler.tcgdex_fetcher import FetchedCardBundle

DEFAULT_MODEL_REPO_ID = "Qwen/Qwen2.5-Coder-14B-Instruct-GGUF"
DEFAULT_MODEL_FILENAME = "qwen2.5-coder-14b-instruct-q4_k_m.gguf"

FAST_MODEL_REPO_ID = "Qwen/Qwen2.5-Coder-7B-Instruct-GGUF"
FAST_MODEL_FILENAME = "qwen2.5-coder-7b-instruct-q4_k_m.gguf"


SYSTEM_PROMPT = """Tu es un compilateur expert du Jeu de Cartes à Collectionner Pokémon (Pokémon TCG - Format Standard).
Ta mission est de traduire les données brutes TCGdex d'une carte Pokémon TCG en un modèle formel déterministe `LLMCompiledCardPart` composé de primitives atomiques d'actions (`playableActions`) et d'un évaluateur stratégique dynamique (`strategicEvaluator`).

### 1. RÈGLES CRITIQUES ET INTERDICTIONS D'HALLUCINATIONS SÉMANTIQUES
1. **INTERDICTION D'UTILISER `SHUFFLE_HAND_AND_DRAW` POUR UN MÉLANGE DE DECK** :
   - Lorsqu'une carte de recherche (ex: Pepper / Arven, Hyper Ball, Faiblo Ball, Poffin Copain-Copain) se termine par *"Mélangez ensuite votre deck"* (*"Then, shuffle your deck"*), ce mélange de deck est implicite à toute recherche.
   - Tu ne dois **JAMAIS** ajouter d'effet `SHUFFLE_HAND_AND_DRAW` pour cela ! `SHUFFLE_HAND_AND_DRAW` est réservé uniquement aux cartes qui mélangent la **MAIN** dans le deck pour piocher un nombre fixe de cartes.
   - Pour **Mashynn (Iono)** qui place la main **en dessous du deck** (*"bottom of their deck"*) et pioche selon les cartes Récompense restantes, utilise **exclusivement** `SHUFFLE_HAND_BOTTOM_DRAW_PRIZES` avec `targetFilter: null`, `primaryRole: "HAND_DISRUPTION"` et `turnPhaseWeights.turn1: 0.8`.

2. **DISTINCTION STRICTE ENTRE `SEARCH_DECK_TO_BENCH` ET `DEAL_DAMAGE_ACTIVE`** :
   - `SEARCH_DECK_TO_BENCH` (`sourceZone: "DECK"`, `targetZone: "BENCH"`) : à utiliser obligatoirement quand une carte cherche des Pokémon dans le deck et dit *"placez-le sur votre Banc"* ou *"placez-les sur votre Banc"* (ex: **Faiblo Ball / Nest Ball**, **Poffin Copain-Copain / Buddy-Buddy Poffin**). Ces cartes DOIVENT avoir la précondition `BENCH_HAS_EMPTY_SLOTS` (`zone: "BENCH"`, `minCount: 1`) et `primaryRole: "BENCH_DEPLOYER"`.
   - `DEAL_DAMAGE_ACTIVE` : réservé **exclusivement** aux attaques (`sourceType: "ATTACK"`) d'un Pokémon qui infligent des dégâts. Une carte Dresseur (`TRAINER`) n'utilise **JAMAIS** `DEAL_DAMAGE_ACTIVE`.

3. **DISTINCTION STRICTE ENTRE `SWITCH_ACTIVE_POKEMON` ET `GUST_OPPONENT_BENCH`** :
   - `SWITCH_ACTIVE_POKEMON` : échange **votre propre** Pokémon Actif avec l'un de vos Pokémon de Banc (ex: Échange / Switch, Chariot Échange).
   - `GUST_OPPONENT_BENCH` : force **votre adversaire** à envoyer l'un de ses Pokémon de Banc sur le Poste Actif (*"Envoyez l'un des Pokémon de Banc de votre adversaire sur le Poste Actif"* / *"Switch in 1 of your opponent's Benched Pokémon to the Active Spot"*, ex: **Attrape-Riposte / Counter Catcher**, **Ordres du Boss / Boss's Orders**). Son `primaryRole` DOIT être `"GUST_BOSS_EFFECT"`. Pour Attrape-Riposte, ajoute la précondition `PLAYER_BEHIND_ON_PRIZES`, la condition de carte morte `NOT_BEHIND_ON_PRIZES` et des poids faibles au T1 (`turn1: 0.2`) mais forts aux T2/T3 (`1.6`, `1.8`).

4. **PRÉCISION DES FILTRES (`targetFilter`)** :
   - **Hyper Ball (Ultra Ball)** cherche *"un Pokémon"* sans restriction de stade : `targetFilter` doit avoir `category: "POKEMON"` et **`subCategory: null`** (surtout PAS `"BASIC"` !), avec `primaryRole: "CONSISTENCY_TUTOR"`.
   - **Recherche Rapide (Quick Search)** de **Roucarnage-ex (Pidgeot ex)** cherche *"une carte"* (n'importe laquelle) : `targetFilter` doit être **`null`**, et son `primaryRole` doit être `"TUTOR_ENGINE_POKEMON"`.
   - **Pepper (Arven)** cherche 1 carte `ITEM` et 1 carte `TOOL` : génère exactement **2 effets** `SEARCH_DECK_TO_HAND` (`upTo: true`, `count: 1`), avec `primaryRole: "CONSISTENCY_TUTOR"`.

5. **OBLIGATION DE MODÉLISER TOUS LES TALENTS ET TOUTES LES ATTAQUES DES POKÉMON** :
   - Tout Pokémon ayant des entrées dans `abilitiesFr`/`abilitiesEn` DOIT avoir une action `ABILITY_ON_EVOLVE`, `ABILITY_ACTIVATED` ou `ABILITY_PASSIVE` dans `playableActions`.
   - Tout Pokémon ayant des entrées dans `attacksFr`/`attacksEn` DOIT obligatoirement avoir une action `sourceType: "ATTACK"` (`timing: "END_OF_TURN_ATTACK"`) correspondante dans `playableActions` (ex: *Combustion Obscure* pour Dracaufeu-ex, *Rafale Tornade* pour Roucarnage-ex, *Flèche Cruelle / Cruel Arrow* à 100 dégâts pour Félicanis-ex / Fezandipiti ex).
   - N'invente **JAMAIS** de coût `DISCARD_ENERGY_FROM_PLAY` ni d'effet `DISCARD_HAND_AND_DRAW` sur une attaque si le texte de l'attaque ne demande pas explicitement de défausser.

6. **RÈGLES PHYSIQUES DU TOUR 1 ET DES STADES D'ÉVOLUTION (`STAGE_1`, `STAGE_2`)** :
   - Tout Pokémon `STAGE_1` ou `STAGE_2` (ex: **Dracaufeu-ex**, **Roucarnage-ex**) a obligatoirement `canUseTurn1GoingFirst: false` et `canUseTurn1GoingSecond: false` sur **toutes** ses actions (Talents ET Attaques), ainsi que `turnPhaseWeights.turn1 = 0.0`.
   - Tout Talent exigeant qu'un Pokémon ait été mis KO au tour précédent (`KO_SUFFERED_LAST_TURN`, ex: *Retour Renversant / Flip the Script* de **Félicanis-ex / Fezandipiti ex**) a obligatoirement `canUseTurn1GoingFirst: false`, `turnPhaseWeights.turn1 = 0.0`, `turn2 = 1.6`, `turn3 = 1.8`, et `primaryRole: "DRAW_ENGINE_POKEMON"`.
   - Toute carte `SUPPORTER` a `canUseTurn1GoingFirst: false`, `canUseTurn1GoingSecond: true`, `timing: "ONCE_PER_TURN_SUPPORTER"`.
   - **Super Bonbon (Rare Candy)** a `canUseTurn1GoingFirst: false`, `canUseTurn1GoingSecond: false`, `turnPhaseWeights.turn1 = 0.0`.

7. **OBLIGATION DE REMPLIR `decklistSynergyRequirements` ET `inGameDeadCardConditions`** :
   - **Super Bonbon (`sv04-125`)** :
     - `preconditions` : `BASIC_IN_PLAY_PREVIOUS_TURN` (1 `BASIC` en jeu) + `ZONE_HAS_MATCHING_CARD` (`zone: "HAND"`, 1 `POKEMON` `STAGE_2`).
     - `decklistSynergyRequirements` : `STAGE_2` (`minCountInDeck: 1`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 15.0`) + `BASIC` (`minCountInDeck: 2`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 10.0`).
     - `inGameDeadCardConditions` : `NO_STAGE2_LEFT_IN_DECK_OR_HAND` sur `["HAND", "DECK"]` (`STAGE_2`) + `NO_BASE_POKEMON_LINE_LEFT` sur `["BENCH", "ACTIVE", "HAND", "DECK"]` (`BASIC`).
   - **Poffin Copain-Copain (`sv05-144`) & Faiblo Ball (`sv01-181`)** :
     - `decklistSynergyRequirements` : `BASIC` (avec `maxHp: 70` pour Poffin), `minCountInDeck: 4`, `ifMissingSetValueToZero: true`.
     - `inGameDeadCardConditions` : `BENCH_ALREADY_FULL` sur `["BENCH"]` + `NO_VALID_TARGET_IN_DECK` sur `["DECK"]`.
   - **Pepper (`sv01-166`)** :
     - `decklistSynergyRequirements` : `ITEM` (`minCountInDeck: 4`) + `TOOL` (`minCountInDeck: 1`).
     - `inGameDeadCardConditions` : `NO_VALID_TARGET_IN_DECK` sur `["DECK"]` pour `ITEM`.
   - **Pokémon `STAGE_2` (Dracaufeu-ex, Roucarnage-ex)** :
     - `decklistSynergyRequirements` : son Pokémon `BASIC` racine (`specificCardName: rootBasicName`, `minCountInDeck: 2`, `ifMissingSetValueToZero: true`) + `"Super Bonbon"` (`ITEM`, `minCountInDeck: 2`). N'ajoute JAMAIS `SPECIAL_ENERGY` si la carte n'en mentionne pas !
     - `inGameDeadCardConditions` : `NO_BASE_POKEMON_LINE_LEFT` sur `["BENCH", "ACTIVE", "HAND", "DECK"]` pour `rootBasicName`.

---

### 2. EXEMPLE FEW-SHOT #1 — CARTE DRESSEUR OBJET : Super Bonbon (Rare Candy)
```json
{
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

### 3. EXEMPLE FEW-SHOT #2 — CARTE POKÉMON NIVEAU 2 : Dracaufeu-ex (Charizard ex)
```json
{
  "category": "POKEMON",
  "subCategory": "STAGE_2",
  "playableActions": [
    {
      "actionId": "ability_infernal_reign",
      "label": "Règne Infernal",
      "sourceType": "ABILITY_ON_EVOLVE",
      "timing": "ON_EVOLVE_TRIGGER",
      "canUseTurn1GoingFirst": false,
      "canUseTurn1GoingSecond": false,
      "preconditions": [
        {
          "type": "ZONE_HAS_MATCHING_CARD",
          "zone": "DECK",
          "minCount": 1,
          "targetFilter": {
            "category": "ENERGY",
            "subCategory": "BASIC_ENERGY",
            "maxHp": null,
            "energyType": "Feu",
            "specificCardName": null
          }
        }
      ],
      "costs": [],
      "effects": [
        {
          "primitive": "SEARCH_AND_ATTACH_ENERGY",
          "sourceZone": "DECK",
          "targetZone": "IN_PLAY_ALL",
          "count": 3,
          "upTo": true,
          "targetFilter": {
            "category": "ENERGY",
            "subCategory": "BASIC_ENERGY",
            "maxHp": null,
            "energyType": "Feu",
            "specificCardName": null
          },
          "baseDamage": null,
          "damageScalingPerOpponentPrizeTaken": null
        }
      ]
    },
    {
      "actionId": "attack_burning_darkness",
      "label": "Combustion Obscure",
      "sourceType": "ATTACK",
      "timing": "END_OF_TURN_ATTACK",
      "canUseTurn1GoingFirst": false,
      "canUseTurn1GoingSecond": false,
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
            "energyType": "Feu",
            "specificCardName": null
          }
        }
      ],
      "costs": [],
      "effects": [
        {
          "primitive": "DEAL_DAMAGE_ACTIVE",
          "sourceZone": "ACTIVE",
          "targetZone": "ACTIVE",
          "count": 1,
          "upTo": false,
          "targetFilter": null,
          "baseDamage": 180,
          "damageScalingPerOpponentPrizeTaken": 30
        }
      ]
    }
  ],
  "strategicEvaluator": {
    "primaryRole": "MAIN_ATTACKER",
    "intrinsicBaseScore": 98,
    "turnPhaseWeights": {
      "turn1": 0.0,
      "turn2": 1.8,
      "turn3": 2.0,
      "turn4Plus": 2.0
    },
    "decklistSynergyRequirements": [
      {
        "requiredFilter": {
          "category": "POKEMON",
          "subCategory": "BASIC",
          "maxHp": null,
          "energyType": null,
          "specificCardName": "Salamèche"
        },
        "minCountInDeck": 2,
        "ifMissingSetValueToZero": true,
        "bonusWeightPerCopy": 20.0
      },
      {
        "requiredFilter": {
          "category": "TRAINER",
          "subCategory": "ITEM",
          "maxHp": null,
          "energyType": null,
          "specificCardName": "Super Bonbon"
        },
        "minCountInDeck": 2,
        "ifMissingSetValueToZero": false,
        "bonusWeightPerCopy": 15.0
      },
      {
        "requiredFilter": {
          "category": "ENERGY",
          "subCategory": "BASIC_ENERGY",
          "maxHp": null,
          "energyType": "Feu",
          "specificCardName": null
        },
        "minCountInDeck": 5,
        "ifMissingSetValueToZero": true,
        "bonusWeightPerCopy": 8.0
      }
    ],
    "inGameDeadCardConditions": [
      {
        "reason": "NO_BASE_POKEMON_LINE_LEFT",
        "zonesToCheck": ["BENCH", "ACTIVE", "HAND", "DECK"],
        "targetFilter": {
          "category": "POKEMON",
          "subCategory": "BASIC",
          "maxHp": null,
          "energyType": null,
          "specificCardName": "Salamèche"
        }
      }
    ],
    "discardPriorityWhenDead": 85,
    "holdForNextTurnBonus": 45
  }
}
```

Réponds UNIQUEMENT avec l'objet JSON valide respectant strictement le schéma `LLMCompiledCardPart`.
"""


def build_user_prompt(bundle: FetchedCardBundle) -> str:
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
        "rawRulesText": identity.rawRulesText,
    }

    if pstats is not None:
        payload["pokemonStats"] = {
            "hp": pstats.hp,
            "types": pstats.types,
            "stage": pstats.stage,
            "evolvesFrom": pstats.evolvesFrom,
            "rootBasicName": pstats.rootBasicName,
            "evolutionChain": pstats.evolutionChain,
            "retreatCost": pstats.retreatCost,
            "weaknesses": pstats.weaknesses,
            "resistances": pstats.resistances,
            "prizeCardsGiven": pstats.prizeCardsGiven,
            "isRuleBox": pstats.isRuleBox,
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

    return (
        "Compile la carte Pokémon TCG suivante en un objet JSON conforme au schéma `LLMCompiledCardPart`.\n"
        f"Utilise obligatoirement `category`: \"{identity.category.value}\" et "
        f"`subCategory`: \"{identity.subCategory.value}\".\n"
        "Si c'est un POKEMON, génère une action par Talent (`abilitiesFr`) ET une action `ATTACK` par attaque (`attacksFr`).\n"
        "Si c'est un TRAINER, n'utilise jamais `SHUFFLE_HAND_AND_DRAW` pour un simple mélange de deck après recherche.\n\n"
        "DONNÉES TCGDEX DE LA CARTE :\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )


def enforce_ptcg_invariants(
    compiled_part: LLMCompiledCardPart,
    bundle: FetchedCardBundle,
) -> LLMCompiledCardPart:
    """Garantit les invariants de premier niveau des règles Pokémon TCG sur `LLMCompiledCardPart`."""
    compiled_part.category = bundle.identity.category
    compiled_part.subCategory = bundle.identity.subCategory

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

    return compiled_part


class LocalLLMCardCompiler:
    """Compilateur IA local chargeant directement le modèle `.gguf` en RAM/VRAM via `llama_cpp.Llama`."""

    def __init__(
        self,
        fast: bool = False,
        repo_id: Optional[str] = None,
        filename: Optional[str] = None,
        hf_token: Optional[str] = None,
        n_ctx: int = 8192,
        n_gpu_layers: int = -1,
        verbose: bool = False,
    ) -> None:
        if repo_id and filename:
            self.repo_id = repo_id
            self.filename = filename
        elif fast:
            self.repo_id = FAST_MODEL_REPO_ID
            self.filename = FAST_MODEL_FILENAME
        else:
            self.repo_id = DEFAULT_MODEL_REPO_ID
            self.filename = DEFAULT_MODEL_FILENAME

        load_env_file()
        self.hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self.verbose = verbose
        self.model_path: Optional[Path] = None
        self._llm: Any = None
        self._json_schema: Dict[str, Any] = LLMCompiledCardPart.model_json_schema()

    def ensure_model_downloaded(self) -> Path:
        """Télécharge automatiquement le fichier `.gguf` depuis Hugging Face s'il n'est pas déjà en cache."""
        if self.model_path is not None and self.model_path.exists():
            return self.model_path

        downloaded_path = hf_hub_download(
            repo_id=self.repo_id,
            filename=self.filename,
            token=self.hf_token,
        )
        self.model_path = Path(downloaded_path)
        return self.model_path

    def load_model_in_memory(self) -> None:
        """Charge une seule fois le modèle `.gguf` en RAM/VRAM avec `n_gpu_layers=-1` (Apple Metal)."""
        if self._llm is not None:
            return

        gguf_path = self.ensure_model_downloaded()
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
        temperature: float = 0.1,
        max_tokens: int = 2048,
    ) -> EngineCardModel:
        """Compile une carte unique avec Constrained Decoding GBNF, post-processe et retourne `EngineCardModel`."""
        self.load_model_in_memory()

        user_prompt = build_user_prompt(bundle)
        t0 = time.perf_counter()

        completion = self._llm.create_chat_completion(
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            response_format={
                "type": "json_object",
                "schema": self._json_schema,
            },
            temperature=temperature,
            max_tokens=max_tokens,
        )

        elapsed = round(time.perf_counter() - t0, 3)
        raw_content = completion["choices"][0]["message"]["content"]

        compiled_part = LLMCompiledCardPart.model_validate_json(raw_content)
        compiled_part = enforce_ptcg_invariants(compiled_part, bundle)

        metadata = CompilationMetadata(
            modelRepoId=self.repo_id,
            modelFilename=self.filename,
            compilationTimeSeconds=elapsed,
            compiledAtIso=datetime.now(timezone.utc).isoformat(),
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

        # Post-processing déterministe des règles métier Pokémon TCG
        engine_card = sanitize_and_enrich_card(bundle, engine_card)
        return engine_card
