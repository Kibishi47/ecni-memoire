"""Moteur d'inférence IA local en mémoire via `llama-cpp-python` (Apple Metal M4 + Constrained Decoding GBNF).

Ce module :
1. Télécharge automatiquement le modèle `.gguf` depuis Hugging Face via `huggingface_hub.hf_hub_download`
   (par défaut `Qwen/Qwen2.5-Coder-14B-Instruct-GGUF` en `Q4_K_M`, ou `7B` avec `--fast`).
2. Charge une seule fois le modèle directement en RAM/VRAM avec `Llama(..., n_gpu_layers=-1)`.
3. Applique le `SYSTEM_PROMPT` expert Pokémon TCG (avec Few-Shot complet) et force la sortie via
   `response_format={"type": "json_object", "schema": LLMCompiledCardPart.model_json_schema()}`.
4. Fusionne la sortie contrainte avec `CardIdentity` et `PokemonStats` pour produire `EngineCardModel`.
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
Ta mission est de traduire les données brutes d'une carte Pokémon TCG en un modèle formel déterministe `LLMCompiledCardPart` composé de primitives atomiques d'actions (`playableActions`) et d'un évaluateur stratégique dynamique (`strategicEvaluator`).

### 1. RÈGLES OFFICIELLES POKÉMON TCG À RESPECTER IMPÉRATIVEMENT
- **Tour 1 du Premier Joueur (`canUseTurn1GoingFirst`)** :
  - `false` pour TOUTE carte `SUPPORTER` (interdit de jouer un Supporter au Tour 1 quand on commence).
  - `false` pour TOUTE attaque (`sourceType: "ATTACK"`).
  - `false` pour TOUTE carte d'évolution ou `Super Bonbon` / `Rare Candy` (`EVOLVE_SKIP_STAGE1`, `EVOLVE_NORMAL`).
  - `true` pour les cartes `ITEM` de recherche/déploiement (ex: Poffin Pote-Pote, Faiblo Ball, Hyper Ball, Attrape-Riposte) et les Talents de Pokémon de Base utilisables dès le Tour 1.
- **Tour 1 du Second Joueur (`canUseTurn1GoingSecond`)** :
  - `true` pour les cartes `SUPPORTER` et les `ATTACK` d'un Pokémon de Base.
  - `false` pour `Super Bonbon` (`EVOLVE_SKIP_STAGE1`) et toute évolution (un Pokémon posé ce tour ne peut pas évoluer au Tour 1).
- **Correspondance `sourceType` et `timing`** :
  - Carte Objet (`ITEM`), Outil (`TOOL`), Stade (`STADIUM`) : `sourceType: "TRAINER_PLAY"`, `timing: "ONCE_PER_CARD"`.
  - Carte Supporter (`SUPPORTER`) : `sourceType: "TRAINER_PLAY"`, `timing: "ONCE_PER_TURN_SUPPORTER"`.
  - Talent activable à chaque tour (ex: *Recherche Rapide* de Roucarnage-ex, *Retour Renversant* de Félicanis-ex) : `sourceType: "ABILITY_ACTIVATED"`, `timing: "ONCE_PER_TURN_ABILITY"`.
  - Talent déclenché lors de l'évolution depuis la main (ex: *Règne Infernal* de Dracaufeu-ex) : `sourceType: "ABILITY_ON_EVOLVE"`, `timing: "ON_EVOLVE_TRIGGER"`.
  - Talent passif continu : `sourceType: "ABILITY_PASSIVE"`, `timing: "ONCE_PER_TURN_ABILITY"`.
  - Attaque de Pokémon : `sourceType: "ATTACK"`, `timing: "END_OF_TURN_ATTACK"`.

### 2. RÈGLES D'ÉVALUATION DYNAMIQUE (`strategicEvaluator`)
- **`decklistSynergyRequirements`** :
  - **Super Bonbon (Rare Candy)** : exige des Pokémon `STAGE_2` dans le deck (`minCountInDeck: 2`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 15.0`) ET des Pokémon `BASIC` (`minCountInDeck: 2`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 10.0`).
  - **Poffin Pote-Pote (Buddy-Buddy Poffin)** : exige des Pokémon `BASIC` avec `maxHp: 70` (`minCountInDeck: 4`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 12.0`).
  - **Faiblo Ball (Nest Ball)** : exige des Pokémon `BASIC` (`minCountInDeck: 4`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 8.0`).
  - **Hyper Ball (Ultra Ball)** : exige des Pokémon (`category: "POKEMON"`, `minCountInDeck: 6`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 5.0`).
  - **Pepper (Arven)** : exige des cartes `ITEM` (`minCountInDeck: 4`, `ifMissingSetValueToZero: false`, `bonusWeightPerCopy: 8.0`) et des cartes `TOOL` (`minCountInDeck: 1`, `ifMissingSetValueToZero: false`, `bonusWeightPerCopy: 12.0`).
  - **Pokémon `STAGE_2` (ex: Dracaufeu-ex, Roucarnage-ex)** : exige son Pokémon `BASIC` racine (`specificCardName: rootBasicName`, `minCountInDeck: 2`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 20.0`) ainsi que l'Objet `Super Bonbon` (`category: "TRAINER"`, `subCategory: "ITEM"`, `specificCardName: "Super Bonbon"`, `minCountInDeck: 2`, `ifMissingSetValueToZero: false`, `bonusWeightPerCopy: 15.0`). Also pour Dracaufeu-ex, exige des `BASIC_ENERGY` de type `"Feu"` (`minCountInDeck: 5`, `ifMissingSetValueToZero: true`, `bonusWeightPerCopy: 8.0`).
- **`inGameDeadCardConditions`** :
  - **Super Bonbon** : `NO_STAGE2_LEFT_IN_DECK_OR_HAND` sur `["DECK", "HAND"]` (filtre `POKEMON` + `STAGE_2`) ET `NO_BASE_POKEMON_LINE_LEFT` sur `["BENCH", "ACTIVE"]` (filtre `POKEMON` + `BASIC`).
  - **Poffin Pote-Pote / Faiblo Ball** : `BENCH_ALREADY_FULL` sur `["BENCH"]` ET `NO_VALID_TARGET_IN_DECK` sur `["DECK"]` (avec le filtre `BASIC` <= 70 PV pour Poffin, ou `BASIC` pour Faiblo Ball).
  - **Hyper Ball / Pepper** : `NO_VALID_TARGET_IN_DECK` sur `["DECK"]`.
  - **Attrape-Riposte (Counter Catcher)** : `NOT_BEHIND_ON_PRIZES` sur `["PRIZES"]`.
  - **Pokémon `STAGE_2` (Dracaufeu-ex, Roucarnage-ex)** : `NO_BASE_POKEMON_LINE_LEFT` sur `["BENCH", "ACTIVE", "DECK", "HAND"]` avec `specificCardName` pointant vers le Pokémon de Base racine (ex: `"Salamèche"` ou `"Roucool"`).

### 3. EXEMPLE FEW-SHOT COMPLET (Super Bonbon / Rare Candy)
Entrée : Carte Dresseur Objet "Super Bonbon" (Rare Candy).
Sortie JSON attendue :
```json
{
  "category": "TRAINER",
  "subCategory": "ITEM",
  "playableActions": [
    {
      "actionId": "play_rare_candy",
      "label": "Super Bonbon (Évolution directe De base -> Niveau 2)",
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
      "turn3": 1.5,
      "turn4Plus": 0.8
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
        "minCountInDeck": 2,
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
        "zonesToCheck": ["DECK", "HAND"],
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
        "zonesToCheck": ["BENCH", "ACTIVE"],
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

    # Inclusion des structures brutes d'effets/talents/attaques FR et EN pour précision maximale
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
        f"`subCategory`: \"{identity.subCategory.value}\".\n\n"
        "DONNÉES TCGDEX DE LA CARTE :\n"
        f"{json.dumps(payload, ensure_ascii=False, indent=2)}"
    )


def enforce_ptcg_invariants(
    compiled_part: LLMCompiledCardPart,
    bundle: FetchedCardBundle,
) -> LLMCompiledCardPart:
    """Garantit les invariants déterministes des règles Pokémon TCG sur la sortie du LLM."""
    compiled_part.category = bundle.identity.category
    compiled_part.subCategory = bundle.identity.subCategory

    for action in compiled_part.playableActions:
        # 1. Règle Supporter : jamais au Tour 1 du joueur qui commence
        if bundle.identity.subCategory == CardSubCategory.SUPPORTER and action.sourceType == ActionSourceType.TRAINER_PLAY:
            action.canUseTurn1GoingFirst = False
            action.canUseTurn1GoingSecond = True
            action.timing = ActionTiming.ONCE_PER_TURN_SUPPORTER

        # 2. Règle Attaque : jamais au Tour 1 du joueur qui commence, met fin au tour
        if action.sourceType == ActionSourceType.ATTACK:
            action.canUseTurn1GoingFirst = False
            action.timing = ActionTiming.END_OF_TURN_ATTACK
            if bundle.identity.subCategory in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}:
                action.canUseTurn1GoingSecond = False

        # 3. Règle Évolution / Super Bonbon : jamais au Tour 1 (ni 1er ni 2nd joueur)
        if any(eff.primitive.value in {"EVOLVE_SKIP_STAGE1", "EVOLVE_NORMAL"} for eff in action.effects):
            action.canUseTurn1GoingFirst = False
            action.canUseTurn1GoingSecond = False

        # 4. Talent déclenché à l'évolution d'un Niveau 1 / Niveau 2 : impossible au Tour 1
        if (
            action.sourceType == ActionSourceType.ABILITY_ON_EVOLVE
            and bundle.identity.subCategory in {CardSubCategory.STAGE_1, CardSubCategory.STAGE_2}
        ):
            action.canUseTurn1GoingFirst = False
            action.canUseTurn1GoingSecond = False
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
        """Compile une carte unique avec Constrained Decoding GBNF et retourne `EngineCardModel` validé."""
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
        return engine_card
