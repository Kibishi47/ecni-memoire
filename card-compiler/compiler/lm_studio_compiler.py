"""Fournisseur LLM pour LM Studio (local ou distant via API REST).

Ce module permet d'exécuter l'inférence du compilateur de cartes Pokémon TCG
sur une instance LM Studio (locale ou sur le réseau local via IP/Port),
tout en conservant l'intégralité des données, caches et fichiers générés
(`data/compiled_cards/`, `data/cards_database.json`) sur la machine locale.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

from compiler import load_env_file
from compiler.llm_engine import ModelTier, extract_json_payload
from compiler.post_processor import sanitize_and_enrich_card
from compiler.schemas import (
    CompilationMetadata,
    EngineCardModel,
    LLMCompiledCardPart,
)
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle


def strip_ansi_codes(text: str) -> str:
    """Supprime les séquences d'échappement ANSI (couleurs, curseur, styles de terminal)."""
    return re.sub(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\([a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", text)


# Modèle Qwen3.8 27B configuré par défaut en mode normal pour la machine distante (GPU dédié)
# Utilise la dénomination officielle LM Studio : lmstudio-community/Qwen3.8-27B-GGUF
DEFAULT_REMOTE_NORMAL_MODEL = "lmstudio-community/Qwen3.8-27B-GGUF"

LM_STUDIO_TIER_MODELS: Dict[ModelTier, str] = {
    ModelTier.qwen3: "lmstudio-community/Qwen3.8-27B-GGUF",
    ModelTier.max: "lmstudio-community/Qwen3.8-27B-GGUF",
    ModelTier.fast: "qwen2.5-coder-7b-instruct",
}


def normalize_lm_studio_model_name(name: Optional[str]) -> str:
    """Normalise les identifiants vers le nom de dépôt officiel attendu par LM Studio."""
    if not name:
        return DEFAULT_REMOTE_NORMAL_MODEL
    name_clean = strip_ansi_codes(name).strip()
    nl = name_clean.lower().replace(" ", "").replace("_", "-")
    # Reconnaissance de toutes les variantes de Qwen3.8 27B
    if ("qwen3.8" in nl or "qwen38" in nl) and "27b" in nl:
        if not name_clean.startswith("lmstudio-community/") and not name_clean.endswith("-GGUF"):
            return "lmstudio-community/Qwen3.8-27B-GGUF"
    return name_clean


def is_valid_json_object(text: str) -> bool:
    """Vérifie si la chaîne est un objet JSON syntaxiquement valide et complet (non tronqué)."""
    if not text:
        return False
    stripped = text.strip()
    if not stripped.startswith("{") or not stripped.endswith("}"):
        return False
    try:
        parsed = json.loads(stripped)
        return isinstance(parsed, dict) and len(parsed) > 0
    except Exception:
        return False





def parse_lms_ls_output(stdout: str) -> List[str]:
    """Extrait la liste des identifiants de modèles téléchargés depuis la sortie de `lms ls` ou `lms ps`."""
    if not stdout:
        return []

    cleaned = strip_ansi_codes(stdout).strip()
    models: List[str] = []

    try:
        data = json.loads(cleaned)
        items: List[Any] = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            for key in ["data", "models", "items", "llms"]:
                if key in data and isinstance(data[key], list):
                    items = data[key]
                    break
        for item in items:
            if isinstance(item, dict):
                for k in ["modelKey", "id", "name", "path", "model"]:
                    val = item.get(k)
                    if val and isinstance(val, str) and val.strip() and val.strip() not in models:
                        models.append(val.strip())
                        break
            elif isinstance(item, str) and item.strip() and item.strip() not in models:
                models.append(item.strip())
        if models:
            return models
    except Exception:
        pass

    noise_words = {
        "NAME", "MODEL", "ID", "IDENTIFIER", "SIZE", "FORMAT", "STATUS",
        "PATH", "TYPE", "LLMS", "EMBEDDING", "MODELS", "YOU", "HAVE",
        "TOTAL", "INSTALLED", "AVAILABLE", "LOADED", "RUN", "NOTE", "TIP",
    }

    for line in cleaned.splitlines():
        line_clean = line.strip()
        if not line_clean or line_clean.startswith(("─", "═", "+", "┌", "└", "├", "┬", "┴", "┼")):
            continue

        if line_clean.startswith("│") and line_clean.endswith("│"):
            line_clean = line_clean[1:-1].strip()

        line_clean = re.sub(r"^[•\*\-\+\>\│\|\s]+", "", line_clean).strip()
        line_clean = line_clean.replace("│", " ").replace("|", " ").strip()
        if not line_clean:
            continue

        lower_line = line_clean.lower()
        if any(lower_line.startswith(prefix) for prefix in [
            "you have", "total:", "models:", "llms", "embedding models",
            "loaded models", "available models", "installed models",
            "to load a model", "use 'lms load", "run 'lms"
        ]):
            continue

        parts = line_clean.split()
        if not parts:
            continue

        candidate = parts[0].strip("(),:;'\"")
        candidate = re.sub(r"\(.*?\)", "", candidate).strip()

        if not candidate or candidate.upper() in noise_words:
            continue

        if candidate not in models:
            models.append(candidate)

    return models


def find_best_model_candidate(candidates: List[str], target: Optional[str]) -> Optional[str]:
    """Sélectionne le meilleur modèle parmi les candidats disponibles selon le palier et le modèle cible."""
    if not candidates:
        return None
    if not target:
        return candidates[0]

    t_clean = strip_ansi_codes(target).strip()
    t_l = t_clean.lower()

    for c in candidates:
        if c == t_clean or c.lower() == t_l:
            return c

    t_norm = re.sub(r"[^a-zA-Z0-9]", "", t_l)
    for c in candidates:
        c_norm = re.sub(r"[^a-zA-Z0-9]", "", c.lower())
        if t_norm in c_norm or c_norm in t_norm:
            return c

    is_qwen_target = any(q in t_l for q in ["qwen", "qwen3.8", "qwen3", "qwen2.5", "qwen2"])
    qwen_cands = [c for c in candidates if "qwen" in c.lower()]
    if is_qwen_target and qwen_cands:
        if ("3.8" in t_l or "38" in t_l) and "27b" in t_l:
            for c in qwen_cands:
                cl = c.lower()
                if ("3.8" in cl or "38" in cl) and "27b" in cl:
                    return c
            for c in qwen_cands:
                cl = c.lower()
                if "3.8" in cl or "38" in cl:
                    return c

        if "27b" in t_l:
            for pref in ["27b", "28b", "30b", "32b", "14b", "7b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c
        elif any(s in t_l for s in ["30b", "32b"]):
            for pref in ["32b", "30b", "27b", "28b", "14b", "7b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c
        elif "14b" in t_l:
            for pref in ["14b", "12b", "16b", "7b", "32b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c
        elif any(s in t_l for s in ["7b", "8b"]):
            for pref in ["7b", "8b", "9b", "14b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c

        for c in qwen_cands:
            if "coder" in c.lower():
                return c
        return qwen_cands[0]

    if any(s in t_l for s in ["27b", "30b", "32b"]):
        for preferred in ["32b", "30b", "27b", "28b", "14b", "7b"]:
            for c in candidates:
                if preferred in c.lower():
                    return c
    elif "14b" in t_l:
        for preferred in ["14b", "12b", "16b", "7b"]:
            for c in candidates:
                if preferred in c.lower():
                    return c
    elif any(s in t_l for s in ["7b", "8b"]):
        for preferred in ["7b", "8b", "9b", "14b"]:
            for c in candidates:
                if preferred in c.lower():
                    return c

    for family in ["llama", "deepseek", "mistral", "gemma", "phi"]:
        if family in t_l:
            for c in candidates:
                if family in c.lower():
                    return c

    return None


class LMStudioCardCompiler:
    """Compilateur de cartes s'appuyant sur l'API OpenAI-compatible de LM Studio (REST direct)."""

    def __init__(
        self,
        api_base_url: Optional[str] = None,
        remote_host: Optional[str] = None,
        remote_port: Optional[int] = None,
        model: Optional[str] = None,
        model_name: Optional[str] = None,
        timeout_seconds: float = 180.0,
        tier: ModelTier = ModelTier.qwen3,
        disable_thinking: Optional[bool] = None,
        thinking: Optional[str] = None,
        **kwargs: Any,
    ) -> None:
        load_env_file()

        self.tier = tier

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

        env_base_url = os.environ.get("LM_STUDIO_BASE_URL")
        explicit_url = api_base_url or env_base_url
        if explicit_url:
            cleaned_url = explicit_url.strip().rstrip("/")
            if not cleaned_url.endswith("/v1"):
                cleaned_url = f"{cleaned_url}/v1"
            self.api_base_url = cleaned_url
            self.remote_host = None
            self.remote_port = 1234
        else:
            env_host = os.environ.get("LM_STUDIO_HOST") or None
            self.remote_host = remote_host or env_host
            self.remote_port = int(remote_port or os.environ.get("LM_STUDIO_PORT") or 1234)
            if self.remote_host:
                self.api_base_url = f"http://{self.remote_host}:{self.remote_port}/v1"
            else:
                self.api_base_url = f"http://127.0.0.1:{self.remote_port}/v1"

        # Modèle d'inférence
        env_model = os.environ.get("LLM_MODEL") or os.environ.get("MODEL") or os.environ.get("LM_STUDIO_MODEL")
        chosen_model = model_name or model or env_model
        if chosen_model and str(chosen_model).strip():
            self.model_name = str(chosen_model).strip()
        else:
            self.model_name = None  # Auto-détecté depuis le modèle actuellement chargé sur le serveur

        self.timeout_seconds = timeout_seconds
        self._json_schema: Dict[str, Any] = LLMCompiledCardPart.model_json_schema()
        self._use_json_schema_format: bool = True
        self._ready: bool = False
        self.hf_token: Optional[str] = None

    @property
    def repo_id(self) -> str:
        if self.remote_host and self.remote_host not in {"127.0.0.1", "localhost"}:
            return "LM_STUDIO_REMOTE"
        return "LM_STUDIO"

    @property
    def filename(self) -> str:
        model_label = self.model_name or "active_server_model"
        return f"{model_label} ({self.api_base_url})"

    def load_model_in_memory(self) -> None:
        """Vérifie le modèle actuellement chargé sur le serveur LM Studio."""
        if self._ready:
            return

        models_url = f"{self.api_base_url}/models"
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(models_url)
                resp.raise_for_status()
                data = resp.json()
                models_list = data.get("data", [])
                active_ids = [
                    m.get("id")
                    for m in models_list
                    if isinstance(m, dict) and m.get("id")
                ] if isinstance(models_list, list) else []

                if not active_ids:
                    raise RuntimeError(
                        f"Aucun modèle n'est actuellement chargé sur le serveur LM Studio ({self.api_base_url}).\n"
                        f"Veuillez charger le modèle de votre choix dans l'interface LM Studio avant de lancer le compilateur."
                    )

                if self.model_name:
                    matched = find_best_model_candidate(active_ids, self.model_name)
                    if not matched:
                        raise RuntimeError(
                            f"Le modèle demandé '{self.model_name}' n'est pas chargé sur le serveur LM Studio.\n"
                            f"Modèle(s) actuellement actif(s) sur le serveur : {', '.join(active_ids)}.\n"
                            f"Veuillez charger '{self.model_name}' dans LM Studio ou laisser LM_STUDIO_MODEL vide pour utiliser automatiquement le modèle actif."
                        )
                    self.model_name = matched
                else:
                    self.model_name = active_ids[0]

        except Exception as exc:
            self.close()
            target_desc = self.remote_host if self.remote_host else self.api_base_url
            if isinstance(exc, RuntimeError):
                raise
            raise ConnectionError(
                f"Impossible de joindre le serveur LM Studio sur {target_desc} : {exc}\n"
                f"Assurez-vous que le serveur LM Studio est démarré et écoute sur le port {self.remote_port}."
            ) from exc

        self._ready = True

    def _send_completion_request(
        self,
        client: httpx.Client,
        chat_url: str,
        payload: Dict[str, Any],
        should_stream: bool,
        t0: float,
        on_token: Optional[Callable[[int, float], None]],
    ) -> Tuple[Optional[Dict[str, Any]], Optional[httpx.Response], Optional[Exception]]:
        """Envoie la requête de complétion à LM Studio soit en streaming SSE (temps réel), soit en POST direct."""
        if should_stream:
            payload["stream"] = True
            payload["stream_options"] = {"include_usage": True}
            try:
                with client.stream("POST", chat_url, json=payload) as resp:
                    if not resp.is_success:
                        resp.read()
                        return None, resp, None

                    accumulated_content: List[str] = []
                    accumulated_reasoning: List[str] = []
                    token_count = 0
                    last_cb_time = 0.0
                    first_token_time: Optional[float] = None
                    last_token_time: Optional[float] = None
                    window_start_time: Optional[float] = None
                    window_start_tokens = 0
                    live_tps = 0.0
                    usage_info: Dict[str, Any] = {}
                    finish_reason: Optional[str] = None

                    stream_error: Optional[str] = None
                    for line in resp.iter_lines():
                        if not line:
                            continue
                        line_str = line.strip()
                        if line_str.startswith("data: "):
                            line_str = line_str[6:].strip()
                        elif line_str.startswith("data:"):
                            line_str = line_str[5:].strip()
                        if line_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(line_str)
                        except Exception:
                            continue

                        # Capture des erreurs explicites renvoyées dans les chunks SSE
                        if isinstance(chunk, dict) and "error" in chunk:
                            err_obj = chunk["error"]
                            stream_error = err_obj.get("message") if isinstance(err_obj, dict) else str(err_obj)
                            break

                        if "usage" in chunk and chunk["usage"]:
                            usage_info = chunk["usage"]

                        choices = chunk.get("choices") or []
                        if choices:
                            c0 = choices[0]
                            if c0.get("finish_reason"):
                                finish_reason = c0["finish_reason"]
                            delta = c0.get("delta") or {}
                            d_content = delta.get("content") or ""
                            d_reasoning = delta.get("reasoning_content") or delta.get("reasoning") or ""
                            has_tok = False
                            if d_content:
                                accumulated_content.append(d_content)
                                has_tok = True
                            if d_reasoning:
                                accumulated_reasoning.append(d_reasoning)
                                has_tok = True

                            if has_tok:
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

                    if stream_error:
                        return None, resp, RuntimeError(f"Erreur streaming LM Studio : {stream_error}")

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

                    content = "".join(accumulated_content).strip()
                    reasoning = "".join(accumulated_reasoning).strip()
                    if not content and reasoning:
                        content = reasoning

                    if token_count == 0 and not content:
                        return None, resp, RuntimeError(
                            "Le serveur LM Studio a fermé la connexion sans générer de tokens (0 token reçu). "
                            "Vérifiez que la taille de contexte allouée par slot (context-length / parallel) est suffisante."
                        )

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

                    data = {
                        "choices": [
                            {
                                "message": {
                                    "content": content,
                                    "reasoning_content": reasoning,
                                },
                                "finish_reason": finish_reason or "stop",
                            }
                        ],
                        "usage": usage_info or {"completion_tokens": token_count},
                        "generation_duration": gen_duration,
                        "time_to_first_token": ttft,
                        "tokens_per_second": tps,
                    }
                    return data, resp, None
            except (AttributeError, TypeError):
                # Fallback sur POST standard si le mock ou client ne supporte pas stream()
                pass
            except httpx.RequestError as net_err:
                return None, None, net_err

        # Mode non-streamé standard
        payload.pop("stream", None)
        payload.pop("stream_options", None)
        try:
            resp = client.post(chat_url, json=payload)
            if resp.is_success:
                return resp.json(), resp, None
            return None, resp, None
        except httpx.RequestError as net_err:
            return None, None, net_err

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
        """Compile une carte Pokémon TCG via LM Studio (REST direct) avec format contraint."""
        from compiler.llm_engine import (
            CODING_SYSTEM_PROMPT,
            SYSTEM_PROMPT,
            build_coding_prompt,
            build_user_prompt,
            enforce_ptcg_invariants,
        )

        # Court-circuit déterministe pour les Énergies de Base (0 token, 0s)
        if is_basic_energy(bundle):
            return build_basic_energy_model(bundle)

        self.load_model_in_memory()

        # Résolution du niveau de réflexion / thinking pour cette compilation
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
        chat_url = f"{self.api_base_url}/chat/completions"
        model_to_request = self.model_name or "default"

        with httpx.Client(timeout=self.timeout_seconds) as client:
            for attempt in range(max_retries + 1):
                if attempt > 0:
                    current_max_tokens = min(current_max_tokens + 1024, 8192)

                t0 = time.perf_counter()

                payload: Dict[str, Any] = {
                    "model": model_to_request,
                    "messages": [
                        {"role": "system", "content": sys_prompt},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": temperature,
                    "max_tokens": current_max_tokens,
                }

                if thinking_level == "null" or is_thinking_disabled:
                    payload["chat_template_kwargs"] = {"enable_thinking": False}
                    payload["chat_template_args"] = {"enable_thinking": False}
                    payload["enable_thinking"] = False
                    payload["reasoning_effort"] = "none"
                    payload["reasoning"] = {"effort": "none"}
                elif thinking_level is not None:
                    payload["chat_template_kwargs"] = {"enable_thinking": True}
                    payload["chat_template_args"] = {"enable_thinking": True}
                    payload["enable_thinking"] = True
                    if thinking_level in {"low", "medium", "high"}:
                        payload["reasoning_effort"] = thinking_level
                        payload["reasoning"] = {"effort": thinking_level}
                    elif thinking_level.isdigit():
                        payload["max_thinking_tokens"] = int(thinking_level)

                formats_to_try: List[str] = []
                if self._use_json_schema_format:
                    formats_to_try.append("json_schema")
                formats_to_try.append("none")

                data: Optional[Dict[str, Any]] = None
                call_err: Optional[Exception] = None

                for fmt in formats_to_try:
                    if fmt == "json_schema":
                        payload["response_format"] = {
                            "type": "json_schema",
                            "json_schema": {
                                "name": "LLMCompiledCardPart",
                                "schema": self._json_schema,
                            },
                        }
                    else:
                        payload.pop("response_format", None)

                    data_candidate, resp, net_err = self._send_completion_request(
                        client, chat_url, payload, should_stream, t0, on_token
                    )
                    if net_err:
                        call_err = net_err
                        break

                    if data_candidate is not None:
                        choices = data_candidate.get("choices") or []
                        content = ""
                        if choices:
                            msg = choices[0].get("message") or {}
                            content = (msg.get("content") or choices[0].get("text") or "").strip()
                            reasoning = (msg.get("reasoning_content") or msg.get("reasoning") or "").strip()
                            if not content and reasoning:
                                cand_json = extract_json_payload(reasoning)
                                if cand_json.startswith("{") and cand_json.endswith("}"):
                                    content = cand_json
                                    if "message" in choices[0]:
                                        choices[0]["message"]["content"] = cand_json

                        cleaned_candidate = extract_json_payload(content)
                        if is_valid_json_object(cleaned_candidate):
                            data = data_candidate
                            if fmt != "json_schema":
                                self._use_json_schema_format = False
                            break
                        else:
                            # Le format actuel a produit une réponse vide ou invalide pour cette tentative
                            if not content:
                                call_err = RuntimeError(
                                    "Le modèle LM Studio a renvoyé un flux vide (0 token). "
                                    "La fenêtre de contexte allouée par slot (context-length / parallel) est probablement insuffisante pour contenir le prompt (~4500-5000 tokens)."
                                )
                            else:
                                call_err = ValueError(
                                    f"Le modèle LM Studio n'a pas produit d'objet JSON valide (contenu: {content[:150]!r})"
                                )
                            if fmt == "json_schema":
                                self._use_json_schema_format = False
                            continue

                    # Analyse détaillée de l'erreur HTTP retournée par LM Studio
                    assert resp is not None
                    err_msg = ""
                    try:
                        err_json = resp.json()
                        err_obj = err_json.get("error", {})
                        if isinstance(err_obj, dict):
                            err_msg = err_obj.get("message") or str(err_obj)
                        else:
                            err_msg = str(err_obj)
                    except Exception:
                        err_msg = resp.text

                    call_err = RuntimeError(
                        f"Erreur LM Studio (HTTP {resp.status_code}) : {err_msg or resp.text}"
                    )

                    # 1. Gestion du modèle non trouvé ou non chargé
                    if resp.status_code == 400 and any(
                        w in err_msg.lower() for w in ["model", "not loaded", "not found"]
                    ):
                        try:
                            models_resp = client.get(f"{self.api_base_url}/models")
                            if models_resp.is_success:
                                m_list = models_resp.json().get("data", [])
                                active_m = [
                                    m.get("id")
                                    for m in m_list
                                    if isinstance(m, dict) and m.get("id")
                                ]
                                if active_m and payload.get("model") != active_m[0]:
                                    payload["model"] = active_m[0]
                                    self.model_name = active_m[0]
                                    model_to_request = active_m[0]
                                    retry_data, retry_resp, _ = self._send_completion_request(
                                        client, chat_url, payload, should_stream, t0, on_token
                                    )
                                    if retry_data is not None:
                                        data = retry_data
                                        break
                        except Exception:
                            pass

                    # 2. Gestion du dépassement de la fenêtre de contexte / tokens
                    if resp.status_code == 400 and any(
                        w in err_msg.lower()
                        for w in ["token", "context", "length", "exceed", "n_ctx", "maximum"]
                    ):
                        if payload["max_tokens"] > 1536:
                            payload["max_tokens"] = 1536
                            current_max_tokens = 1536
                            retry_data, retry_resp, _ = self._send_completion_request(
                                client, chat_url, payload, should_stream, t0, on_token
                            )
                            if retry_data is not None:
                                data = retry_data
                                break

                    # 3. Si 400 causé par response_format ou paramètres non supportés : on retire les paramètres optionnels et on tente le format suivant
                    if resp.status_code == 400:
                        err_lower = err_msg.lower()
                        if any(k in err_lower for k in ["response_format", "json_schema", "schema", "'text'"]):
                            self._use_json_schema_format = False
                            payload.pop("response_format", None)

                        for param in [
                            "chat_template_kwargs",
                            "chat_template_args",
                            "enable_thinking",
                            "reasoning_effort",
                            "reasoning",
                        ]:
                            payload.pop(param, None)
                        continue

                    # Pour toute autre erreur non-400 (500, 401, etc.)
                    break

                if data is None:
                    last_error = call_err or RuntimeError("Réponse vide ou indisponible de LM Studio")
                    if attempt < max_retries:
                        time.sleep(1.0)
                        continue
                    raise RuntimeError(f"Erreur de communication avec LM Studio : {last_error}") from last_error

                elapsed = max(0.001, round(time.perf_counter() - t0, 3))
                choices = data.get("choices") or []
                if not choices:
                    raise RuntimeError(f"Réponse vide reçue de LM Studio : {data}")

                choice = choices[0]
                finish_reason = choice.get("finish_reason")
                msg = choice.get("message") or {}
                raw_content = (msg.get("content") or choice.get("text") or "").strip()
                if not raw_content and (msg.get("reasoning_content") or msg.get("reasoning")):
                    raw_content = (msg.get("reasoning_content") or msg.get("reasoning") or "").strip()

                # Troncation de tokens détectée
                if finish_reason == "length" and attempt < max_retries:
                    continue

                cleaned_json = extract_json_payload(raw_content)

                if not cleaned_json or not cleaned_json.startswith("{") or not cleaned_json.endswith("}"):
                    val_err = ValueError(
                        f"Le modèle LLM n'a pas retourné d'objet JSON valide pour la carte {bundle.card_id} "
                        f"(contenu brut : {raw_content[:200]!r})"
                    )
                    last_error = val_err
                    if attempt < max_retries:
                        continue
                    raise val_err

                try:
                    compiled_part = LLMCompiledCardPart.model_validate_json(cleaned_json)
                    break
                except Exception as val_err:
                    last_error = val_err
                    try:
                        raw_dict = json.loads(cleaned_json)
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
                                            "actionId": "attack_0",
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
                    if ("eof" in err_str or "expecting value" in err_str or finish_reason == "length") and attempt < max_retries:
                        continue
            else:
                raise last_error or RuntimeError(f"Échec de validation de la carte {bundle.card_id} via LM Studio")

        assert compiled_part is not None
        compiled_part = enforce_ptcg_invariants(compiled_part, bundle)

        # Calcul des métriques de débit (tokens par seconde)
        usage = data.get("usage") if isinstance(data, dict) else {}
        completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
        generation_duration = data.get("generation_duration") if isinstance(data, dict) else None
        ttft = data.get("time_to_first_token") if isinstance(data, dict) else None

        tokens_per_second: Optional[float] = None
        if isinstance(data, dict) and data.get("tokens_per_second") is not None:
            tokens_per_second = data.get("tokens_per_second")
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

        from compiler.deterministic_builder import (
            build_deterministic_skeleton,
            merge_llm_payload_into_skeleton,
        )

        skeleton = build_deterministic_skeleton(bundle)
        engine_card = merge_llm_payload_into_skeleton(skeleton, compiled_part, metadata)
        return engine_card

    def unload_model(self) -> None:
        """Conservé pour compatibilité d'interface (le client ne modifie pas les modèles d'un serveur partagé)."""
        pass

    def close(self) -> None:
        """Ferme proprement le compilateur."""
        self._ready = False
