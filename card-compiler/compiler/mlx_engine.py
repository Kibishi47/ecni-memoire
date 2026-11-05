"""Moteur d'inférence local Apple Silicon MLX (`mlx-lm`) pour Pokémon TCG Card Compiler.

Ce module implémente :
- Le chargement natif en mémoire unifiée des poids safetensors via `mlx_lm.load(...)`.
- Le décodage du schéma micro-ciblé `LLMCompiledPayload` (`translatedSlots`, `aiRole`, `turnPhaseWeights`, `additionalSynergyTags`).
- La fusion déterministe dans le squelette `DeterministicCardSkeleton` via `merge_llm_payload_into_skeleton`.
- Le déchargement strict de la RAM/VRAM (`del`, `gc.collect()`, `mx.clear_cache()`).
"""

from __future__ import annotations

import gc
import json
import os
import time
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Optional, Union

from pydantic import ValidationError

from compiler.deterministic_builder import (
    build_deterministic_skeleton,
    build_fallback_llm_payload,
    merge_llm_payload_into_skeleton,
)
from compiler.llm_engine import (
    CODING_SYSTEM_PROMPT,
    SYSTEM_PROMPT,
    build_coding_user_prompt,
    build_user_prompt,
    extract_json_payload,
)
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
     resolve_model_for_configuration,
)
from compiler.schemas import (
    CompilationMetadata,
    EngineCardModel,
    LLMCompiledPayload,
)
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle


DEFAULT_MLX_MODEL_REPO_ID = "mlx-community/Qwen2.5-Coder-14B-Instruct-4bit"

MLX_MODEL_ALIASES: Dict[str, str] = {
    "uqer1244/Qwen3.8-27B-GSQ-RC0-MLX": "uqer1244/Qwen3.8-27B-GSQ-RCO-MLX",
    "Qwen3.8-27B-GSQ-RC0-MLX": "uqer1244/Qwen3.8-27B-GSQ-RCO-MLX",
    "Qwen3.8-27B-GSQ-RCO-MLX": "uqer1244/Qwen3.8-27B-GSQ-RCO-MLX",
}


def normalize_mlx_model_id(model_spec: Optional[str]) -> str:
    """Normalise l'identifiant Hugging Face du modèle MLX."""
    if not model_spec or not str(model_spec).strip():
        return DEFAULT_MLX_MODEL_REPO_ID
    cleaned = str(model_spec).strip()
    return MLX_MODEL_ALIASES.get(cleaned, cleaned)


class MLXCardCompiler:
    """Compilateur de cartes Pokémon TCG basé sur Apple MLX (`mlx-lm`)."""

    def __init__(
        self,
        model: Optional[str] = None,
        intensity: Optional[Union[IntensityMode, str]] = None,
        phase: Optional[Union[PipelinePhase, str]] = None,
        pipeline_mode: Optional[Union[PipelineMode, str]] = None,
        temperature: float = 0.1,
        max_tokens: int = 1024,
        hf_token: Optional[str] = None,
        disable_thinking: bool = False,
        thinking: Optional[str] = None,
    ) -> None:
        raw_model = model or os.environ.get("LLM_MODEL") or os.environ.get("MODEL")
        if raw_model and str(raw_model).strip():
            self.repo_id = normalize_mlx_model_id(raw_model)
        elif intensity is not None or phase is not None or pipeline_mode is not None:
            resolved = resolve_model_for_configuration(
                pipeline_mode=pipeline_mode,
                intensity=intensity,
                phase=phase,
                backend="mlx",
                explicit_model=model,
            )
            self.repo_id = normalize_mlx_model_id(resolved)
        else:
            self.repo_id = DEFAULT_MLX_MODEL_REPO_ID

        self.filename = "MLX-Safetensors (Unified Memory)"
        self.model_spec = self.repo_id
        self.temperature = temperature
        self.max_tokens = max_tokens
        self.hf_token = (
            hf_token
            or os.environ.get("HF_TOKEN")
            or os.environ.get("HUGGING_FACE_HUB_TOKEN")
        )

        env_no_think = os.environ.get(
            "LM_STUDIO_DISABLE_THINKING",
            os.environ.get("DISABLE_THINKING", "false"),
        ).lower() in {"1", "true", "yes"}
        raw_thinking = (
            thinking
            if thinking is not None
            else os.environ.get("LM_STUDIO_THINKING", os.environ.get("THINKING"))
        )
        if isinstance(raw_thinking, str):
            raw_thinking = raw_thinking.strip() or None

        if disable_thinking or env_no_think or (raw_thinking and raw_thinking.lower() in {"null", "none", "false", "0", "off"}):
            self.disable_thinking = True
            self.thinking: Optional[str] = "null"
        else:
            self.disable_thinking = False
            self.thinking = raw_thinking.lower() if raw_thinking else None

        self._model: Any = None
        self._tokenizer: Any = None

    def load_model_in_memory(self) -> None:
        """Charge le modèle et le tokenizer MLX en mémoire unifiée Apple Silicon."""
        if self._model is not None and self._tokenizer is not None:
            return

        try:
            import mlx_lm
        except ImportError as exc:
            raise RuntimeError(
                "Le package 'mlx-lm' n'est pas installé. Installez-le via : pip install mlx-lm"
            ) from exc

        if self.hf_token and not os.environ.get("HF_TOKEN"):
            os.environ["HF_TOKEN"] = self.hf_token

        try:
            self._model, self._tokenizer = mlx_lm.load(self.repo_id)
        except Exception as err:
            err_msg = str(err)
            if "Invalid axis 2" in err_msg or "moveaxis" in err_msg or "GSQ" in self.repo_id:
                raise RuntimeError(
                    f"Le dépôt '{self.repo_id}' utilise une quantification personnalisée non standard (ex: GSQ-RCO packed 1D) "
                    f"incompatible avec le chargeur standard mlx-lm ({err_msg}).\n"
                    f"💡 Solution recommandée : utilisez un modèle MLX officiel 4-bit ou 8-bit :\n"
                    f"   --model mlx-community/Qwen3.8-27B-4bit  ou  --model mlx-community/Qwen2.5-Coder-7B-Instruct-8bit"
                ) from err
            try:
                from huggingface_hub import snapshot_download

                try:
                    local_snap = snapshot_download(self.repo_id, local_files_only=True)
                except Exception:
                    local_snap = snapshot_download(
                        "mlx-community/Qwen2.5-Coder-14B-Instruct-8bit",
                        local_files_only=True,
                    )
                self._model, self._tokenizer = mlx_lm.load(local_snap)
            except Exception:
                raise err

    def _build_formatted_prompt(self, messages: List[Dict[str, str]]) -> str:
        """Applique le chat template du tokenizer avec contrôle éventuel du thinking."""
        if self._tokenizer is not None and hasattr(self._tokenizer, "apply_chat_template"):
            template_kwargs: Dict[str, Any] = {
                "tokenize": False,
                "add_generation_prompt": True,
            }
            if self.disable_thinking or self.thinking == "null":
                try:
                    return self._tokenizer.apply_chat_template(
                        messages,
                        enable_thinking=False,
                        **template_kwargs,
                    )
                except TypeError:
                    pass
            try:
                return self._tokenizer.apply_chat_template(messages, **template_kwargs)
            except Exception:
                pass

        parts = []
        for m in messages:
            parts.append(f"<|im_start|>{m['role']}\n{m['content']}<|im_end|>")
        parts.append("<|im_start|>assistant\n")
        return "\n".join(parts)

    def compile_card(
        self,
        bundle: FetchedCardBundle,
        max_retries: int = 2,
        on_token: Optional[Callable[[int, float], None]] = None,
        reasoning_text: Optional[str] = None,
    ) -> EngineCardModel:
        """Compile une carte via MLX en décodant `LLMCompiledPayload` et en fusionnant avec `DeterministicCardSkeleton`."""
        if is_basic_energy(bundle):
            return build_basic_energy_model(bundle)

        skeleton = build_deterministic_skeleton(bundle)
        if not skeleton.slots_for_llm:
            fallback_payload = build_fallback_llm_payload(skeleton)
            metadata = CompilationMetadata(
                modelRepoId="STATIC_DETERMINISTIC",
                modelFilename="deterministic_builder",
                compilationTimeSeconds=0.001,
                compiledAtIso=datetime.now(timezone.utc).isoformat(),
                completionTokens=0,
                tokensPerSecond=0.0,
            )
            return merge_llm_payload_into_skeleton(skeleton, fallback_payload, metadata)

        self.load_model_in_memory()

        import mlx_lm
        from mlx_lm.sample_utils import make_sampler

        if reasoning_text:
            active_sys_prompt = CODING_SYSTEM_PROMPT
            user_prompt = build_coding_user_prompt(bundle, reasoning_text=reasoning_text, skeleton=skeleton)
        else:
            active_sys_prompt = SYSTEM_PROMPT
            user_prompt = build_user_prompt(bundle, skeleton=skeleton)

        messages: List[Dict[str, str]] = [
            {"role": "system", "content": active_sys_prompt},
            {"role": "user", "content": user_prompt},
        ]

        t_start = time.perf_counter()
        last_error: Optional[Exception] = None
        compiled_payload: Optional[LLMCompiledPayload] = None
        token_count = 0
        first_token_time: Optional[float] = None
        last_ui_update = 0.0
        elapsed = 0.001
        gen_duration = 0.001
        ttft = 0.0
        tps = 0.0

        for attempt in range(max_retries + 1):
            formatted_prompt = self._build_formatted_prompt(messages)
            temp_val = self.temperature if attempt == 0 else 0.0
            sampler = make_sampler(temp=temp_val)

            chunks: List[str] = []
            token_count = 0
            first_token_time = None
            attempt_start = time.perf_counter()
            last_ui_update = attempt_start

            for response in mlx_lm.stream_generate(
                self._model,
                self._tokenizer,
                prompt=formatted_prompt,
                max_tokens=self.max_tokens,
                sampler=sampler,
            ):
                piece = getattr(response, "text", "")
                if piece:
                    now = time.perf_counter()
                    if first_token_time is None:
                        first_token_time = now
                    chunks.append(piece)
                    token_count = getattr(response, "generation_tokens", len(chunks))

                    if on_token is not None and (now - last_ui_update) >= 0.5:
                        gen_elapsed = now - first_token_time
                        live_tps = token_count / gen_elapsed if gen_elapsed > 0.05 else 0.0
                        on_token(token_count, live_tps)
                        last_ui_update = now

            t_end = time.perf_counter()
            elapsed = max(0.001, t_end - t_start)
            ttft = (first_token_time - attempt_start) if first_token_time is not None else elapsed
            gen_duration = (t_end - first_token_time) if first_token_time is not None else elapsed
            tps = round(token_count / gen_duration, 2) if gen_duration > 0 and token_count > 0 else 0.0

            if on_token is not None and token_count > 0:
                on_token(token_count, tps)

            raw_output = "".join(chunks)

            try:
                json_str = extract_json_payload(raw_output)
                raw_dict = json.loads(json_str)
                compiled_payload = LLMCompiledPayload.model_validate(raw_dict)
                break
            except (ValueError, json.JSONDecodeError, ValidationError) as err:
                last_error = err
                if attempt < max_retries:
                    messages.append({"role": "assistant", "content": raw_output})
                    messages.append(
                        {
                            "role": "user",
                            "content": (
                                f"Ta réponse a échoué à la validation Pydantic de LLMCompiledPayload :\n{err}\n"
                                "Renvoie UNIQUEMENT un objet JSON valide avec 'translatedSlots', 'aiRole', 'turnPhaseWeights' (0.0 à 1.0) et 'additionalSynergyTags'."
                            ),
                        }
                    )
                    continue
        else:
            import logging

            logging.getLogger(__name__).warning(
                f"Modélisation de secours déterministe appliquée pour {bundle.card_id} ({bundle.identity.nameFr}) "
                f"suite à l'échec de validation LLM : {last_error}"
            )
            compiled_payload = build_fallback_llm_payload(skeleton)

        metadata = CompilationMetadata(
            modelRepoId=self.repo_id,
            modelFilename=self.filename,
            compilationTimeSeconds=round(elapsed, 3),
            compiledAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=token_count,
            tokensPerSecond=tps,
            generationTimeSeconds=round(gen_duration, 3),
            timeToFirstTokenSeconds=round(ttft, 3),
        )

        return merge_llm_payload_into_skeleton(skeleton, compiled_payload, metadata)

    def compile_card_with_reasoning(
        self,
        bundle: FetchedCardBundle,
        reasoning_text: str,
        **kwargs: Any,
    ) -> EngineCardModel:
        """Compile une carte en s'appuyant sur l'analyse de raisonnement préalable (Passe 2)."""
        return self.compile_card(bundle, reasoning_text=reasoning_text, **kwargs)

    def close(self) -> None:
        """Libère strictement le cache mémoire Metal MLX et décharge le modèle."""
        if self._model is not None:
            del self._model
            self._model = None
        if self._tokenizer is not None:
            del self._tokenizer
            self._tokenizer = None
        gc.collect()
        try:
            import mlx.core as mx

            if hasattr(mx, "clear_cache"):
                mx.clear_cache()
            elif hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
                mx.metal.clear_cache()
        except Exception:
            pass
