"""Moteur d'inférence LLM local (llama.cpp Metal + Constrained Decoding) pour le compilateur Pokémon TCG.

Ce module implémente :
- Le schéma micro-ciblé `LLMCompiledPayload` (traduction des `slots_for_llm` + `aiRole` + `turnPhaseWeights` + `additionalSynergyTags`).
- L'extraction et nettoyage JSON robuste (`extract_json_payload`).
- Le Constrained Decoding sur `LLMCompiledPayload.model_json_schema()` via `llama-cpp-python` (`n_gpu_layers=-1`).
- La fusion déterministe finale via `merge_llm_payload_into_skeleton`.
"""

from __future__ import annotations

import gc
import json
import os
import re
import time
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from pydantic import ValidationError

from compiler.deterministic_builder import (
    DeterministicCardSkeleton,
    build_deterministic_skeleton,
    build_fallback_llm_payload,
    merge_llm_payload_into_skeleton,
)
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
    normalize_intensity_mode,
    resolve_gguf_filename_for_repo,
    resolve_model_for_configuration,
)
from compiler.post_processor import sanitize_and_enrich_card
from compiler.schemas import (
    CompilationMetadata,
    EngineCardModel,
    LLMCompiledPayload,
)
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle


DEFAULT_MODEL_REPO_ID = "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF"
DEFAULT_MODEL_FILENAME = "Qwen2.5-Coder-7B-Instruct-Q8_0.gguf"

FAST_MODEL_REPO_ID = "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF"
FAST_MODEL_FILENAME = "Qwen2.5-Coder-7B-Instruct-Q8_0.gguf"


class ModelTier(str, Enum):
    """Paliers de modèles supportés."""

    qwen3 = "qwen3"
    deepseek = "deepseek"
    fast = "fast"
    max = "max"


CODING_SYSTEM_PROMPT = """Tu es un compilateur JSON formel pour un moteur Pokémon TCG.
Tu reçois uniquement les slots d'effets textuels d'une carte (`slots_for_llm`) ainsi que l'analyse de règles produite en Passe 1.
Toute l'identité, les statistiques Pokémon, les coûts d'énergie et les dégâts de base sont DÉJÀ construits par Python.

Tu dois répondre UNIQUEMENT avec un objet JSON strictement conforme au schéma abstrait `LLMCompiledPayload` suivant (remplace tous les placeholders `<...>` par les vraies valeurs calculées pour LA CARTE COURANTE — ne recopie jamais des valeurs par défaut) :
{
  "translatedSlots": [
    {
      "slotId": "<exact_slotId_from_input>",
      "preconditions": ["<CANONICAL_PRECONDITION_IF_REQUIRED>"],
      "effects": [
        {
          "primitive": "<EffectPrimitive>",
          "target": "<EffectTarget_or_null>",
          "value": "<int_or_null>",
          "count": "<int_or_null>",
          "sourceZone": "<ZoneType_or_null>",
          "destinationZone": "<ZoneType_or_null>",
          "zone": "<ZoneType_or_null>",
          "filter": "<FILTER_EXPRESSION_or_null>",
          "specialCondition": "<SpecialCondition_or_null>",
          "coinFlipMode": "<CoinFlipMode_or_null>",
          "coinCount": "<int_or_null>",
          "scalingOperator": "<ADD_or_MULTIPLY_or_null>",
          "scalingMetric": "<ScalingMetric_or_null>",
          "bonusValue": "<int_or_null>",
          "upTo": false,
          "optional": false
        }
      ],
      "deadCardCondition": "<LOGICAL_INVERSE_OF_PRECONDITIONS_or_null>"
    }
  ],
  "aiRole": "<AIRole>",
  "turnPhaseWeights": {
    "turn1": "<float_0.0_to_1.0>",
    "turn2": "<float_0.0_to_1.0>",
    "turn3": "<float_0.0_to_1.0>",
    "turn4Plus": "<float_0.0_to_1.0>"
  },
  "additionalSynergyTags": ["<only_requires_*_tags_if_needed>"]
}

RÈGLES STRICTES SUR LES ENUMS ET LA SÉMANTIQUE :
1. DISTINCTIONS CRITIQUES :
   - « Cherchez dans votre deck... » / « Search your deck... » = TOUJOURS `SEARCH_DECK` (JAMAIS `DRAW_CARDS`).
   - « Piochez X cartes » / « Draw X cards » = TOUJOURS `DRAW_CARDS`. Ne génère JAMAIS `DRAW_CARDS` si le texte ne mentionne ni pioche ni « draw ».
   - « Placez X marqueurs de dégâts » = TOUJOURS `PLACE_DAMAGE_COUNTERS` (`count` = nb de marqueurs de 10 PV, ignore Faiblesse/Résistance/Banc Téracristal), JAMAIS `DAMAGE_ACTIVE`/`DAMAGE_BENCH`.
2. `primitive` DOIT appartenir exactement à l'un des 29 termes :
   `SEARCH_DECK`, `DRAW_CARDS`, `DAMAGE_ACTIVE`, `DAMAGE_BENCH`, `ATTACH_ENERGY`, `DISCARD_CARDS`, `HEAL`, `SWITCH_ACTIVE`, `APPLY_SPECIAL_CONDITION`, `EVOLVE_POKEMON`, `SHUFFLE_HAND_DRAW`, `RECOVER_FROM_DISCARD`, `PLACE_DAMAGE_COUNTERS`, `MOVE_DAMAGE_COUNTERS`, `MOVE_ENERGY`, `MODIFY_DAMAGE_TAKEN`, `MODIFY_DAMAGE_DEALT`, `MODIFY_HP`, `MODIFY_RETREAT_COST`, `PREVENT_DAMAGE_OR_EFFECTS`, `LOCK_NEXT_TURN_ATTACK`, `LOCK_RETREAT`, `LOCK_ABILITIES`, `LOCK_ITEMS`, `EXPAND_BENCH`, `KNOCK_OUT`, `MILL_DECK`, `TAKE_EXTRA_PRIZE`, `PUT_ON_TOP_OR_BOTTOM_OF_DECK`.
3. `specialCondition` (OBLIGATOIRE si `primitive == APPLY_SPECIAL_CONDITION`, `null` sinon) :
   `POISONED`, `BURNED`, `ASLEEP`, `PARALYZED`, `CONFUSED`.
   N'utilise JAMAIS `APPLY_SPECIAL_CONDITION` pour un verrou d'attaque/retraite ou un modificateur de dégâts : utilise `LOCK_NEXT_TURN_ATTACK`, `LOCK_RETREAT`, `LOCK_ABILITIES`, `LOCK_ITEMS`, `MODIFY_DAMAGE_TAKEN`, `PREVENT_DAMAGE_OR_EFFECTS`.
4. `target` DOIT appartenir exactement à `EffectTarget` (ou `null`) :
   `SELF`, `OPPONENT_ACTIVE`, `OPPONENT_BENCH_SINGLE`, `OPPONENT_BENCH_ALL`, `OPPONENT_POKEMON_ANY`, `OPPONENT_ALL_POKEMON`, `OWN_ACTIVE`, `OWN_BENCH_SINGLE`, `OWN_BENCH_ALL`, `OWN_POKEMON_ANY`, `OWN_ALL_POKEMON`, `ALL_POKEMON_IN_PLAY`, `PLAYER`, `OPPONENT`.
   Attention : « Ce Pokémon s'inflige X dégâts » -> `DAMAGE_ACTIVE` avec `target = "SELF"` (en plus du `DAMAGE_ACTIVE` sur `OPPONENT_ACTIVE`).
5. `sourceZone`, `destinationZone`, `zone` DOIVENT appartenir à `ZoneType` (ou `null`) :
   `DECK`, `TOP_OF_DECK`, `BOTTOM_OF_DECK`, `HAND`, `DISCARD`, `BENCH`, `ACTIVE`, `PRIZES`, `LOST_ZONE`, `ATTACHED_CARDS`.
6. `coinFlipMode` (ou `null`) :
   `SINGLE_HEADS_REQUIRED`, `SINGLE_HEADS_BONUS`, `MULTI_COIN_PER_HEADS`, `UNTIL_TAILS_PER_HEADS`, `TWO_TAILS_SELF_DAMAGE`.
7. `scalingOperator` (`ADD` / `MULTIPLY` ou `null`) & `scalingMetric` (ou `null`) :
   `PER_ENERGY_ON_SELF`, `PER_ENERGY_ON_OPPONENT_ACTIVE`, `PER_ENERGY_ON_BOTH_ACTIVES`, `PER_ENERGY_IN_PLAY`, `PER_ENERGY_DISCARDED`, `PER_DAMAGE_COUNTER_ON_SELF`, `PER_DAMAGE_COUNTER_ON_OPPONENT_ACTIVE`, `PER_BENCHED_POKEMON_WITH_DAMAGE`, `PER_OWN_BENCH_POKEMON`, `PER_OPPONENT_BENCH_POKEMON`, `PER_BOTH_BENCH_POKEMON`, `PER_PRIZE_TAKEN_BY_OPPONENT`, `PER_PRIZE_TAKEN_BY_PLAYER`, `PER_PRIZE_REMAINING_PLAYER`, `PER_CARD_IN_OWN_HAND`, `PER_CARD_IN_OPPONENT_HAND`, `CONDITIONAL_FLAT_BONUS`.
8. `preconditions` (vocabulaire fermé) et `deadCardCondition` :
   - Préconditions autorisées : `SELF_IS_ACTIVE`, `SELF_ON_BENCH`, `SELF_IS_IN_HAND`, `BENCH_HAS_EMPTY_SLOT`, `BENCH_HAS_POKEMON`, `OPPONENT_HAS_BENCHED_POKEMON`, `TARGET_IN_PLAY_SINCE_PREVIOUS_TURN`, `NOT_FIRST_TURN`, `ON_EVOLVE_FROM_HAND`, `ON_PLAY_FROM_HAND_TO_BENCH`, `KO_SUFFERED_LAST_TURN`, `PLAYER_BEHIND_ON_PRIZES`, `OPPONENT_PRIZES_EXACT_COUNT`, `HAND_MIN_OTHER_CARDS:<N>`, `DECK_NOT_EMPTY`, `HAND_NOT_EMPTY`, `SELF_HAS_ENERGY`, `ONCE_PER_GAME`, `IN_PLAY:<Nom>`.
   - RÈGLE D'INVERSION POUR `deadCardCondition` : `deadCardCondition` DOIT être l'INVERSE logique de `preconditions` (la condition où l'action est IMPOSSIBLE/MORTE en main). Exemples : `BENCH_FULL`, `BENCH_IS_EMPTY`, `NO_VALID_TARGET_IN_DECK`, `BENCH_FULL_OR_NO_TARGET_IN_DECK`, `OPPONENT_BENCH_EMPTY`, `NO_KO_SUFFERED_LAST_TURN`, `NOT_BEHIND_ON_PRIZES`, `HAND_IS_EMPTY`, `HAND_FEWER_THAN_2_OTHER_CARDS`, `SELF_NOT_ACTIVE`, `STADIUM_ALREADY_IN_PLAY_SAME_NAME`, `NO_POKEMON_WITHOUT_TOOL`, `NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY`, ou `null`. Ne mets JAMAIS une condition positive d'activation dans `deadCardCondition`, ni de faux `effects` pour des règles structurelles (1 Outil/Pokémon, Stade même nom, 1 Pouvoir VSTAR/partie).
9. `aiRole` DOIT appartenir exactement à :
   `MAIN_ATTACKER`, `SECONDARY_ATTACKER`, `DRAW_ENGINE`, `ENERGY_ACCELERATOR`, `GUEST_TECH`, `DISRUPTION`, `CONSISTENCY_BOOSTER`.
   - RÈGLE : Les cartes `TRAINER` et `ENERGY` ne sont JAMAIS `MAIN_ATTACKER` ni `SECONDARY_ATTACKER`. Les petits Pokémon de Base pré-évolutifs (<= 70 PV non-ex) sont `CONSISTENCY_BOOSTER` ou `DRAW_ENGINE`.
10. `turnPhaseWeights` : 4 flottants strictement entre `0.0` et `1.0` reflétant la courbe réelle de cette carte (ex: `turn1 = 0.0` pour Stage 1/Stage 2 ou *behind-on-prizes*, `turn1` élevé pour setup de Base). N'utilise pas des poids génériques identiques sur toutes les cartes.
11. `additionalSynergyTags` : UNIQUEMENT des tags normalisés (`requires_stage_2_pokemon`, `requires_basic_hp_lte_70`, `requires_tera_pokemon`, `requires_ancient_pokemon`, `requires_future_pokemon`, `requires_discard_synergy`, `requires_pokemon_tool`, `requires_energy_type:<Type>`, `requires_evolution_line:<NomFr>`). Aucun tag descriptif libre en anglais.
12. `upTo` et `optional` sont toujours des booléens (`true` ou `false`, jamais `null`). « jusqu'à X » = 1..X (cible requise sauf pioche 0..X) ; « n'importe quel nombre » = 0 permis. Ne génère AUCUN texte hors de l'objet JSON."""

# Alias pour le mode Single-Pass
SYSTEM_PROMPT = CODING_SYSTEM_PROMPT


def build_coding_user_prompt(
    bundle: FetchedCardBundle,
    reasoning_text: str,
    skeleton: Optional[DeterministicCardSkeleton] = None,
    disable_thinking: bool = False,
) -> str:
    """Construit le prompt utilisateur ultra-ciblé pour la Passe 2 (Codage JSON de `LLMCompiledPayload`)."""
    skel = skeleton or build_deterministic_skeleton(bundle)
    slots_payload = [
        {
            "slotId": s.slotId,
            "actionType": s.actionType.value,
            "label": s.label,
            "textFr": s.textFr,
            "textEn": s.textEn,
            "baseDamage": s.baseDamage,
        }
        for s in skel.slots_for_llm
    ]
    slots_json = json.dumps(slots_payload, ensure_ascii=False, indent=2)

    prompt_str = (
        f"CARTE : {skel.cardId} — {skel.identity.nameFr} ({skel.category.value} / {skel.subCategory.value})\n\n"
        f"SLOTS À TRADUIRE (`translatedSlots` doit contenir exactement ces `slotId`) :\n"
        f"```json\n{slots_json}\n```\n\n"
        f"ANALYSE DE RAISONNEMENT (PASSE 1) :\n{reasoning_text}\n\n"
        "Génère uniquement l'objet JSON `LLMCompiledPayload` correspondant."
    )
    if disable_thinking:
        prompt_str += (
            "\n\nRÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ. "
            "Réponds directement avec le JSON.\n/no_think\n<|think_off|>"
        )
    return prompt_str


build_coding_prompt = build_coding_user_prompt


def build_user_prompt(
    bundle: FetchedCardBundle,
    skeleton: Optional[DeterministicCardSkeleton] = None,
    disable_thinking: bool = False,
) -> str:
    """Construit le prompt utilisateur pour le mode Single-Pass."""
    skel = skeleton or build_deterministic_skeleton(bundle)
    slots_payload = [
        {
            "slotId": s.slotId,
            "actionType": s.actionType.value,
            "label": s.label,
            "textFr": s.textFr,
            "textEn": s.textEn,
            "baseDamage": s.baseDamage,
        }
        for s in skel.slots_for_llm
    ]
    slots_json = json.dumps(slots_payload, ensure_ascii=False, indent=2)
    prompt_str = (
        f"CARTE : {skel.cardId} — {skel.identity.nameFr} ({skel.category.value} / {skel.subCategory.value})\n\n"
        f"SLOTS À TRADUIRE (`translatedSlots` doit contenir exactement ces `slotId`) :\n"
        f"```json\n{slots_json}\n```\n\n"
        "Génère uniquement l'objet JSON `LLMCompiledPayload` correspondant."
    )
    if disable_thinking:
        prompt_str += (
            "\n\nRÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ. "
            "Réponds directement avec le JSON.\n/no_think\n<|think_off|>"
        )
    return prompt_str


def extract_json_payload(raw_text: str) -> str:
    """Extrait l'objet JSON principal d'une réponse LLM (supprime `<think>`, `<|channel>thought...<channel|>`, markdown et virgules pendantes)."""
    if not raw_text:
        return ""

    cleaned = re.sub(r"<\|channel>\s*thought\b.*?<channel\|>", "", raw_text, flags=re.DOTALL | re.IGNORECASE).strip()
    if "<channel|>" in cleaned:
        cleaned = cleaned.split("<channel|>")[-1].strip()
    cleaned = re.sub(r"<(?:think|thought)>.*?</(?:think|thought)>", "", cleaned, flags=re.DOTALL | re.IGNORECASE).strip()
    if "</think>" in cleaned:
        cleaned = cleaned.split("</think>")[-1].strip()
    if "</thought>" in cleaned:
        cleaned = cleaned.split("</thought>")[-1].strip()

    fenced_blocks = re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, flags=re.DOTALL | re.IGNORECASE)
    if fenced_blocks:
        cleaned = fenced_blocks[-1].strip()
    else:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return ""
        cleaned = cleaned[start : end + 1]

    # Suppression des virgules pendantes (trailing commas) avant } ou ]
    cleaned = re.sub(r",\s*([}\]])", r"\1", cleaned)
    return cleaned


def enforce_ptcg_invariants(
    payload: LLMCompiledPayload,
    bundle: FetchedCardBundle,
) -> LLMCompiledPayload:
    """Normalise un `LLMCompiledPayload` par rapport au bundle TCGdex."""
    return payload


class LocalLLMCardCompiler:
    """Compilateur LLM local basé sur `llama-cpp-python` (Metal GGUF + Constrained Decoding)."""

    def __init__(
        self,
        tier: ModelTier = ModelTier.qwen3,
        fast: bool = False,
        model: Optional[str] = None,
        repo_id: Optional[str] = None,
        filename: Optional[str] = None,
        intensity: Optional[Union[IntensityMode, str]] = None,
        phase: Optional[Union[PipelinePhase, str]] = None,
        pipeline_mode: Optional[Union[PipelineMode, str]] = None,
        n_ctx: int = 8192,
        n_gpu_layers: int = -1,
        temperature: float = 0.1,
        max_tokens: int = 1536,
        hf_token: Optional[str] = None,
        disable_thinking: bool = False,
        thinking: Optional[str] = None,
    ) -> None:
        self.tier = tier
        self.intensity = normalize_intensity_mode(intensity)
        self.model_spec = model
        self.model_path: Optional[Path] = None

        env_model = os.environ.get("LLM_MODEL") or os.environ.get("MODEL")
        effective_model = model or env_model

        if repo_id and filename:
            self.repo_id = repo_id
            self.filename = filename
        elif effective_model and Path(effective_model).expanduser().is_file():
            resolved_path = Path(effective_model).expanduser().resolve()
            self.model_path = resolved_path
            self.repo_id = str(resolved_path.parent)
            self.filename = resolved_path.name
        elif effective_model and ":" in effective_model:
            r_part, f_part = effective_model.split(":", 1)
            self.repo_id = r_part.strip()
            self.filename = f_part.strip()
        elif effective_model and "/" in effective_model and effective_model.lower().endswith(".gguf") and effective_model.count("/") >= 2:
            r_part, f_part = effective_model.rsplit("/", 1)
            self.repo_id = r_part.strip()
            self.filename = f_part.strip()
        elif phase is None and pipeline_mode is None and not effective_model:
            if fast or tier == ModelTier.fast:
                self.repo_id = FAST_MODEL_REPO_ID
                self.filename = FAST_MODEL_FILENAME
            else:
                self.repo_id = "Qwen/Qwen3-14B-GGUF"
                self.filename = "Qwen3-14B-Q4_K_M.gguf"
        else:
            resolved_repo = resolve_model_for_configuration(
                pipeline_mode=pipeline_mode or PipelineMode.two_pass,
                intensity=self.intensity,
                phase=phase or PipelinePhase.code,
                backend="llama_cpp",
                explicit_model=effective_model,
            )
            if ":" in resolved_repo:
                r_part, f_part = resolved_repo.split(":", 1)
                self.repo_id = r_part.strip()
                self.filename = f_part.strip()
            else:
                self.repo_id = resolved_repo
                self.filename = (
                    resolve_gguf_filename_for_repo(self.repo_id, self.intensity)
                    or DEFAULT_MODEL_FILENAME
                )

        self.n_ctx = n_ctx
        self.n_gpu_layers = n_gpu_layers
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        self.disable_thinking = disable_thinking
        self.thinking = "null" if disable_thinking else thinking

        self._llm: Any = None
        self._model_path: Optional[str] = str(self.model_path) if self.model_path else None

    def ensure_model_downloaded(self) -> str:
        """Télécharge ou résout le fichier `.gguf` local."""
        if self._model_path and Path(self._model_path).is_file():
            return self._model_path

        candidate = Path(self.repo_id).expanduser()
        if candidate.is_file():
            self._model_path = str(candidate.resolve())
            return self._model_path

        from huggingface_hub import hf_hub_download

        self._model_path = hf_hub_download(
            repo_id=self.repo_id,
            filename=self.filename,
            token=self.hf_token,
        )
        return self._model_path

    def load_model_in_memory(self) -> None:
        """Charge l'instance `Llama` en mémoire unifiée Metal (`n_gpu_layers=-1`)."""
        if self._llm is not None:
            return
        from llama_cpp import Llama

        model_path = self.ensure_model_downloaded()
        self._llm = Llama(
            model_path=model_path,
            n_gpu_layers=self.n_gpu_layers,
            n_ctx=self.n_ctx,
            n_batch=512,
            flash_attn=True,
            verbose=False,
        )

    def compile_card(
        self,
        bundle: FetchedCardBundle,
        max_retries: int = 2,
        on_token: Optional[Callable[[int, float], None]] = None,
        reasoning_text: Optional[str] = None,
    ) -> EngineCardModel:
        """Compile une carte via Constrained Decoding sur `LLMCompiledPayload.model_json_schema()`."""
        if is_basic_energy(bundle):
            return build_basic_energy_model(bundle)

        skeleton = build_deterministic_skeleton(bundle)
        self.load_model_in_memory()

        is_thinking_disabled = bool(self.disable_thinking or self.thinking == "null")
        user_prompt = (
            build_coding_user_prompt(bundle, reasoning_text=reasoning_text, skeleton=skeleton, disable_thinking=is_thinking_disabled)
            if reasoning_text
            else build_user_prompt(bundle, skeleton=skeleton, disable_thinking=is_thinking_disabled)
        )
        sys_prompt = CODING_SYSTEM_PROMPT
        if is_thinking_disabled:
            sys_prompt += (
                "\n\nRÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ. "
                "Ne génère aucune balise <think>...</think>."
            )

        messages: List[Dict[str, str]] = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt},
        ]

        schema_dict = LLMCompiledPayload.model_json_schema()
        response_format = {
            "type": "json_object",
            "schema": schema_dict,
        }

        t_start = time.perf_counter()
        first_token_time: Optional[float] = None
        last_token_time: Optional[float] = None
        window_start_time: Optional[float] = None
        window_start_tokens = 0
        live_tps = 0.0
        last_cb_time = 0.0
        token_count = 0
        compiled_payload: Optional[LLMCompiledPayload] = None

        for attempt in range(max_retries + 1):
            chunks: List[str] = []
            try:
                call_kwargs: Dict[str, Any] = {
                    "messages": messages,
                    "temperature": self.temperature if attempt == 0 else 0.0,
                    "max_tokens": 2048 if is_thinking_disabled else 4096,
                    "response_format": response_format,
                    "stream": on_token is not None,
                }
                if is_thinking_disabled:
                    call_kwargs["chat_template_kwargs"] = {"enable_thinking": False}
                    call_kwargs["chat_template_args"] = {"enable_thinking": False}
                    call_kwargs["enable_thinking"] = False
                    call_kwargs["reasoning_effort"] = "none"
                elif self.thinking is not None:
                    call_kwargs["chat_template_kwargs"] = {"enable_thinking": True}
                    call_kwargs["chat_template_args"] = {"enable_thinking": True}
                    call_kwargs["enable_thinking"] = True
                    call_kwargs["reasoning_effort"] = self.thinking

                resp_or_stream = self._llm.create_chat_completion(**call_kwargs)
                if isinstance(resp_or_stream, dict):
                    choices = resp_or_stream.get("choices", [])
                    raw_output = ""
                    if choices:
                        msg = choices[0].get("message", {})
                        raw_output = msg.get("content") or choices[0].get("text") or ""
                    usage = resp_or_stream.get("usage", {})
                    token_count = int(usage.get("completion_tokens", 1) or 1)
                else:
                    for chunk in resp_or_stream:
                        choices = chunk.get("choices", [])
                        if not choices:
                            continue
                        delta = choices[0].get("delta", {})
                        piece = delta.get("content") or ""
                        if piece:
                            token_count += 1
                            now = time.perf_counter()
                            if first_token_time is None:
                                first_token_time = now
                                window_start_time = now
                                window_start_tokens = token_count
                            last_token_time = now
                            chunks.append(piece)

                            if window_start_time is not None:
                                window_elapsed = now - window_start_time
                                if window_elapsed >= 1.0:
                                    delta_tokens = max(0, token_count - window_start_tokens)
                                    live_tps = round(delta_tokens / max(0.0001, window_elapsed), 1)
                                    window_start_time = now
                                    window_start_tokens = token_count

                            if on_token is not None:
                                if (now - last_cb_time >= 0.05) or (token_count == 2 and last_cb_time == 0.0):
                                    on_token(token_count, live_tps)
                                    last_cb_time = now

                    if on_token is not None and token_count > 0:
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

                    raw_output = "".join(chunks)

                json_str = extract_json_payload(raw_output)
                if not json_str:
                    raise ValueError(f"Aucun objet JSON trouvé dans la réponse LLM : {raw_output[:200]!r}")
                raw_dict = json.loads(json_str)
                compiled_payload = LLMCompiledPayload.model_validate(raw_dict)
                break
            except Exception as err:
                err_msg = str(err)
                if "llama_decode returned -3" in err_msg:
                    raise RuntimeError(
                        f"Mémoire GPU/Metal saturée sur Apple Silicon ({err_msg}). "
                        "Réduisez la taille du modèle ou utilisez LLM_PROVIDER=lm_studio."
                    ) from err
                if attempt < max_retries:
                    messages.append({"role": "assistant", "content": "".join(chunks) or "{}"})
                    messages.append(
                        {
                            "role": "user",
                            "content": f"Erreur de validation JSON/Pydantic : {err}. Corrige et renvoie uniquement un JSON conforme à LLMCompiledPayload.",
                        }
                    )
                else:
                    compiled_payload = build_fallback_llm_payload(skeleton)

        t_end = time.perf_counter()
        elapsed = round(max(0.001, t_end - t_start), 3)
        if first_token_time is not None:
            ttft = round(max(0.0, first_token_time - t_start), 3)
            raw_delta = max(0.0001, (last_token_time or t_end) - first_token_time)
            if token_count > 1:
                gen_duration = round(raw_delta * (token_count / (token_count - 1)), 3)
                tps = round((token_count - 1) / raw_delta, 1)
            else:
                gen_duration = round(raw_delta, 3)
                tps = round(1.0 / raw_delta, 1)
        else:
            ttft = 0.0
            gen_duration = elapsed
            tps = round(token_count / gen_duration, 2) if gen_duration > 0 and token_count > 0 else 0.0

        metadata = CompilationMetadata(
            modelRepoId=self.repo_id,
            modelFilename=self.filename,
            compilationTimeSeconds=elapsed,
            compiledAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=token_count,
            tokensPerSecond=tps,
            generationTimeSeconds=gen_duration,
            timeToFirstTokenSeconds=ttft,
        )

        return merge_llm_payload_into_skeleton(skeleton, compiled_payload, metadata)

    def compile_card_with_reasoning(
        self,
        bundle: FetchedCardBundle,
        reasoning_text: str,
        **kwargs: Any,
    ) -> EngineCardModel:
        """Compile une carte en s'appuyant sur l'analyse de raisonnement de la Passe 1."""
        return self.compile_card(bundle, reasoning_text=reasoning_text, **kwargs)

    def close(self) -> None:
        """Ferme et détruit l'instance `Llama` en forçant `del` et `gc.collect()`."""
        if self._llm is not None:
            try:
                if hasattr(self._llm, "close"):
                    self._llm.close()
            except Exception:
                pass
            del self._llm
            self._llm = None
        gc.collect()
