"""Moteur d'inférence IA local haute performance via Apple MLX (`mlx-lm`) pour Apple Silicon (M1/M2/M3/M4).

Ce module :
1. Charge nativement les modèles safetensors au format MLX dans la mémoire unifiée (Unified Memory)
   sans conversion ni surcoût d'émulation GGUF.
2. Utilise `mlx_lm.load` et `mlx_lm.stream_generate` avec le chat template natif du tokenizer.
3. Supporte la gestion uniforme du thinking (désactivation complète sans balises `<think>`,
   ou contrôle de niveau 'low'/'medium'/'high').
4. Calcule le débit d'inférence en temps réel avec rafraîchissement d'une seconde.
5. Extrait, valide et enrichit le JSON conforme à `LLMCompiledCardPart` et `EngineCardModel`.
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from compiler import load_env_file
from compiler.llm_engine import (
    SYSTEM_PROMPT,
    build_user_prompt,
    enforce_ptcg_invariants,
    extract_json_payload,
)
from compiler.post_processor import sanitize_and_enrich_card
from compiler.schemas import (
    CompilationMetadata,
    EngineCardModel,
    LLMCompiledCardPart,
)
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle

DEFAULT_MLX_MODEL_REPO_ID = "uqer1244/Qwen3.8-27B-GSQ-RCO-MLX"


def normalize_mlx_model_id(model_id: Optional[str]) -> str:
    """Normalise l'identifiant du modèle MLX et corrige les fautes de frappe courantes (ex: RC0 vs RCO)."""
    if not model_id or not str(model_id).strip():
        return DEFAULT_MLX_MODEL_REPO_ID
    cleaned = str(model_id).strip()
    if "Qwen3.8-27B-GSQ-RC0-MLX" in cleaned:
        return cleaned.replace("Qwen3.8-27B-GSQ-RC0-MLX", "Qwen3.8-27B-GSQ-RCO-MLX")
    return cleaned


class MLXCardCompiler:
    """Compilateur IA local haute performance exploitant Apple MLX et l'architecture mémoire unifiée Apple Silicon."""

    def __init__(
        self,
        model: Optional[str] = None,
        model_name: Optional[str] = None,
        hf_token: Optional[str] = None,
        verbose: bool = False,
        disable_thinking: Optional[bool] = None,
        thinking: Optional[str] = None,
    ) -> None:
        load_env_file()
        self.hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        if self.hf_token:
            os.environ["HF_TOKEN"] = self.hf_token
            os.environ["HUGGING_FACE_HUB_TOKEN"] = self.hf_token

        raw_model = (
            model
            or model_name
            or os.environ.get("LLM_MODEL")
            or os.environ.get("MODEL")
            or os.environ.get("MLX_MODEL")
        )
        self.model_spec: Optional[str] = str(raw_model).strip() if raw_model and str(raw_model).strip() else None
        self.repo_id: str = normalize_mlx_model_id(self.model_spec)
        self.filename: str = "model.safetensors (MLX Native)"
        self.verbose: bool = verbose

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
                self.thinking: Optional[str] = None
                self.disable_thinking: bool = False
            elif cleaned_tk in {"null", "none", "off", "false", "0", "disabled", "disable"}:
                self.thinking = "null"
                self.disable_thinking = True
            else:
                self.thinking = cleaned_tk
                self.disable_thinking = False
        else:
            self.thinking = None
            self.disable_thinking = False

        self._model = None
        self._tokenizer = None

    def load_model_in_memory(self) -> None:
        """Charge le modèle MLX et son tokenizer dans la mémoire unifiée Apple Silicon."""
        if self._model is not None and self._tokenizer is not None:
            return

        try:
            import mlx_lm
            import mlx.core as mx
        except ImportError as imp_err:
            raise RuntimeError(
                "Le package 'mlx-lm' n'est pas installé dans cet environnement Python. "
                "Installez-le avec : pip install mlx mlx-lm"
            ) from imp_err

        try:
            self._model, self._tokenizer = mlx_lm.load(
                self.repo_id,
                tokenizer_config={"trust_remote_code": True},
            )
        except Exception as load_err:
            err_str = str(load_err)
            if "out of memory" in err_str.lower() or "kIOGPUCommandBufferCallbackErrorOutOfMemory" in err_str:
                raise RuntimeError(
                    f"Mémoire unifiée saturée lors du chargement de '{self.repo_id}' via Apple MLX ({load_err}). "
                    "Votre Mac ne dispose pas d'assez de mémoire unifiée pour ce modèle."
                ) from load_err
            raise RuntimeError(
                f"Erreur lors du chargement du modèle MLX '{self.repo_id}' : {load_err}"
            ) from load_err

    def compile_card(
        self,
        bundle: FetchedCardBundle,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        max_retries: int = 2,
        stream: Optional[bool] = None,
        on_token: Optional[Callable[[int, float], None]] = None,
        disable_thinking: Optional[bool] = None,
        thinking: Optional[str] = None,
    ) -> EngineCardModel:
        """Compile une carte unique avec MLX, valide le schéma et applique le post-processing."""
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

        user_prompt = build_user_prompt(bundle, disable_thinking=is_thinking_disabled)
        sys_prompt = SYSTEM_PROMPT
        if is_thinking_disabled:
            sys_prompt = (
                f"{SYSTEM_PROMPT}\n\n"
                "RÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ. "
                "Tu ne dois générer AUCUNE balise <think>...</think> ni raisonnement textuel libre avant le JSON. "
                "Génère directement et uniquement le JSON conforme au schéma `LLMCompiledCardPart`."
            )

        messages = [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            if is_thinking_disabled or thinking_level == "null":
                prompt_text = self._tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True, enable_thinking=False
                )
            elif thinking_level is not None:
                prompt_text = self._tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True, enable_thinking=True
                )
            else:
                prompt_text = self._tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True
                )
        except (TypeError, Exception):
            prompt_text = self._tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True
            )

        from mlx_lm.sample_utils import make_sampler
        import mlx_lm

        sampler = make_sampler(temp=temperature)

        if is_thinking_disabled and max_tokens == 4096:
            current_max_tokens = 2048
        else:
            current_max_tokens = max_tokens

        last_error: Optional[Exception] = None
        compiled_part: Optional[LLMCompiledCardPart] = None
        elapsed: float = 0.0
        token_count = 0
        gen_duration: Optional[float] = None
        tps: Optional[float] = None
        ttft: Optional[float] = None

        for attempt in range(max_retries + 1):
            if attempt > 0:
                current_max_tokens = min(32768, current_max_tokens + 2048)

            t0 = time.perf_counter()
            accumulated_chunks: List[str] = []
            token_count = 0
            last_cb_time = 0.0
            first_token_time: Optional[float] = None
            last_token_time: Optional[float] = None
            window_start_time: Optional[float] = None
            window_start_tokens = 0
            live_tps = 0.0
            finish_reason = None

            try:
                gen_stream = mlx_lm.stream_generate(
                    self._model,
                    self._tokenizer,
                    prompt=prompt_text,
                    max_tokens=current_max_tokens,
                    sampler=sampler,
                )

                for chunk in gen_stream:
                    if chunk.text:
                        accumulated_chunks.append(chunk.text)
                    token_count = chunk.generation_tokens
                    if chunk.finish_reason:
                        finish_reason = chunk.finish_reason

                    now = time.perf_counter()
                    if first_token_time is None and token_count > 0:
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

                now = time.perf_counter()
                if on_token and token_count > 0:
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

            except Exception as gen_err:
                err_text = str(gen_err)
                if "out of memory" in err_text.lower() or "kIOGPUCommandBufferCallbackErrorOutOfMemory" in err_text:
                    raise RuntimeError(
                        f"Mémoire GPU/Metal saturée avec MLX ({gen_err}). "
                        f"Le modèle '{self.repo_id}' a dépassé la mémoire disponible lors de la génération."
                    ) from gen_err
                raise

            elapsed = max(0.001, round(time.perf_counter() - t0, 3))
            raw_content = "".join(accumulated_chunks)

            if first_token_time is not None:
                ttft = round(max(0.0, first_token_time - t0), 3)
                end_t = last_token_time or time.perf_counter()
                raw_delta = max(0.0001, end_t - first_token_time)
                if token_count > 1:
                    gen_duration = round(raw_delta * (token_count / (token_count - 1)), 3)
                    tps = round((token_count - 1) / raw_delta, 1)
                elif token_count == 1:
                    gen_duration = round(raw_delta, 3)
                    tps = round(1.0 / raw_delta, 1)

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
                                "reasoningAnalysis": f"Encapsulation automatique MLX de l'effet d'attaque '{raw_dict.get('primitive')}' pour {bundle.card_id}.",
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
                                "reasoningAnalysis": f"Encapsulation automatique MLX de l'action '{raw_dict.get('actionId')}' pour {bundle.card_id}.",
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
            raise last_error or RuntimeError(f"Échec de validation de la carte {bundle.card_id} avec Apple MLX")

        compiled_part = enforce_ptcg_invariants(compiled_part, bundle)

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

        return sanitize_and_enrich_card(bundle, engine_card)

    def close(self) -> None:
        """Libère le cache mémoire Metal MLX."""
        try:
            import mlx.core as mx
            mx.metal.clear_cache()
        except Exception:
            pass
