"""Gestionnaire central et matrice des modèles LLM pour Pokémon TCG Card Compiler.

Définit :
1. Les modes d'exécution :
   - Mode 1 (`single` / `direct`) : Inférence directe en 1 passe (IA générale -> JSON formé).
   - Mode 2 (`two_pass` / `two_step`) : Inférence en 2 passes découplées :
     * Passe 1 (`reason`) : IA de raisonnement approfondi -> texte d'explication exhaustif du fonctionnement.
     * Passe 2 (`code`) : IA de programmation -> transformation du texte d'explication en JSON formel conforme.
2. Les paliers d'intensité :
   - `soft` (défaut) : Modèles légers et sécurisés en mémoire unifiée (~7 à 8.5 Go RAM),
     permettant de compiler sans risque de crash même avec navigateur et applications ouvertes.
   - `intense` : Modèles haute précision (~14 à 18 Go RAM), réservés aux sessions sans multitâche / mode nuit (AFK).
3. Les backends d'exécution :
   - `mlx` : Modèles safetensors exécutés nativement sur Apple Silicon via `mlx-lm`.
   - `llama_cpp` : Modèles quantifiés GGUF exécutés sur Apple Metal via `llama-cpp-python`.
"""

from __future__ import annotations

import os
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from compiler import load_env_file


class PipelineMode(str, Enum):
    """Mode de pipeline du compilateur."""

    single = "single"      # Mode 1 : IA générale direct -> JSON
    two_pass = "two_pass"  # Mode 2 : Passe 1 (Raisonnement) -> Déchargement -> Passe 2 (Codage JSON)


class IntensityMode(str, Enum):
    """Niveau de puissance et d'empreinte mémoire du modèle."""

    soft = "soft"        # Défaut : modèles légers (14B 4-bit / 7B 8-bit), ~7-8 Go RAM
    intense = "intense"  # Modèles puissants (32B 4-bit / 14B 8-bit), ~14-18 Go RAM


class PipelinePhase(str, Enum):
    """Phase d'exécution en mode Two-Pass."""

    all = "all"        # Exécute Passe 1 (toutes cartes), décharge l'IA 1, puis Passe 2 (toutes cartes)
    reason = "reason"  # Exécute uniquement la Passe 1 (Génération des textes d'analyse)
    code = "code"      # Exécute uniquement la Passe 2 (Génération des JSONs à partir des textes)


# ==============================================================================
# MATRICE OFFICIELLE DES MODÈLES (Spécifiée par le projet)
# ==============================================================================

# Mode 1 : Inférence Directe (L'IA fait tout)
SINGLE_PASS_MODELS: Dict[Tuple[IntensityMode, str], str] = {
    (IntensityMode.soft, "mlx"): "mlx-community/gemma-4-26b-a4b-it-4bit",
    (IntensityMode.intense, "mlx"): "mlx-community/gemma-4-26b-a4b-it-4bit",
    (IntensityMode.soft, "llama_cpp"): "bartowski/Qwen2.5-Coder-14B-Instruct-GGUF",
    (IntensityMode.intense, "llama_cpp"): "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF",
}

# Mode 2 : Passe 1 (Raisonnement approfondi - Gemma 4 avec enable_thinking=True)
REASONING_PASS_MODELS: Dict[Tuple[IntensityMode, str], str] = {
    (IntensityMode.soft, "mlx"): "mlx-community/gemma-4-26b-a4b-it-4bit",
    (IntensityMode.intense, "mlx"): "mlx-community/gemma-4-26b-a4b-it-4bit",
    (IntensityMode.soft, "llama_cpp"): "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF",
    (IntensityMode.intense, "llama_cpp"): "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF",
}

# Mode 2 : Passe 2 (Coding / JSON - Gemma 4 avec enable_thinking=False)
CODING_PASS_MODELS: Dict[Tuple[IntensityMode, str], str] = {
    (IntensityMode.soft, "mlx"): "mlx-community/gemma-4-26b-a4b-it-4bit",
    (IntensityMode.intense, "mlx"): "mlx-community/gemma-4-26b-a4b-it-4bit",
    (IntensityMode.soft, "llama_cpp"): "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF",
    (IntensityMode.intense, "llama_cpp"): "bartowski/Qwen2.5-Coder-14B-Instruct-GGUF",
}

# Fichiers GGUF par défaut et quantifications recommandées pour llama_cpp
GGUF_DEFAULT_FILENAMES: Dict[str, Dict[str, str]] = {
    "bartowski/Qwen2.5-Coder-14B-Instruct-GGUF": {
        "soft": "Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf",
        "intense": "Qwen2.5-Coder-14B-Instruct-Q8_0.gguf",
    },
    "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF": {
        "soft": "Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf",
        "intense": "Qwen2.5-Coder-32B-Instruct-Q4_K_M.gguf",
    },
    "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF": {
        "soft": "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf",
        "intense": "DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf",
    },
    "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF": {
        "soft": "Qwen2.5-Coder-7B-Instruct-Q8_0.gguf",
        "intense": "Qwen2.5-Coder-7B-Instruct-Q8_0.gguf",
    },
}


def normalize_pipeline_mode(raw: Optional[Union[PipelineMode, str]]) -> PipelineMode:
    """Normalise le mode de pipeline."""
    if isinstance(raw, PipelineMode):
        return raw
    if not raw or not str(raw).strip():
        return PipelineMode.single
    cleaned = str(raw).strip().lower().replace("-", "_")
    if cleaned in {"two_pass", "twopass", "two_step", "double", "step2", "pass2"}:
        return PipelineMode.two_pass
    return PipelineMode.single


def normalize_intensity_mode(raw: Optional[Union[IntensityMode, str]]) -> IntensityMode:
    """Normalise le niveau d'intensité."""
    if isinstance(raw, IntensityMode):
        return raw
    if not raw or not str(raw).strip():
        return IntensityMode.soft
    cleaned = str(raw).strip().lower()
    if cleaned in {"intense", "high", "max", "full", "afk"}:
        return IntensityMode.intense
    return IntensityMode.soft


def normalize_pipeline_phase(raw: Optional[Union[PipelinePhase, str]]) -> PipelinePhase:
    """Normalise la phase d'exécution pour le mode Two-Pass."""
    if isinstance(raw, PipelinePhase):
        return raw
    if not raw or not str(raw).strip():
        return PipelinePhase.all
    cleaned = str(raw).strip().lower().replace("-", "_")
    if cleaned in {"reason", "reasoning", "pass1", "step1", "texte", "textes"}:
        return PipelinePhase.reason
    if cleaned in {"code", "coding", "pass2", "step2", "json"}:
        return PipelinePhase.code
    return PipelinePhase.all


def resolve_model_for_configuration(
    pipeline_mode: Optional[Union[PipelineMode, str]] = None,
    intensity: Optional[Union[IntensityMode, str]] = None,
    phase: Optional[Union[PipelinePhase, str]] = None,
    backend: Optional[str] = None,
    explicit_model: Optional[str] = None,
) -> str:
    """Résout le nom de modèle officiel adapté selon la configuration demandée.
    
    Prend en compte :
    1. Les arguments explicites passés en CLI ou code.
    2. Les variables d'environnement (`LLM_MODEL`, `REASONING_MODEL`, `CODING_MODEL`,
       `PIPELINE_MODE`, `INTENSITY_MODE`, `LOCAL_BACKEND`).
    3. La matrice officielle définie par le projet.
    """
    load_env_file()

    eff_pipeline = (
        normalize_pipeline_mode(pipeline_mode)
        if pipeline_mode is not None
        else normalize_pipeline_mode(os.environ.get("PIPELINE_MODE"))
    )

    eff_intensity = (
        normalize_intensity_mode(intensity)
        if intensity is not None
        else normalize_intensity_mode(os.environ.get("INTENSITY_MODE"))
    )

    eff_phase = (
        normalize_pipeline_phase(phase)
        if phase is not None
        else normalize_pipeline_phase(os.environ.get("PIPELINE_PHASE"))
    )

    raw_backend = (
        backend
        or os.environ.get("LOCAL_BACKEND")
        or os.environ.get("LOCAL_OPTIMIZATION")
        or "mlx"
    ).strip().lower()
    eff_backend = "mlx" if raw_backend == "mlx" else "llama_cpp"

    # Vérification des overrides explicites
    if explicit_model and str(explicit_model).strip():
        return str(explicit_model).strip()

    if eff_pipeline == PipelineMode.two_pass:
        if eff_phase == PipelinePhase.reason:
            env_override = os.environ.get("REASONING_MODEL")
            if env_override and env_override.strip():
                return env_override.strip()
            return REASONING_PASS_MODELS.get(
                (eff_intensity, eff_backend),
                REASONING_PASS_MODELS[(IntensityMode.soft, eff_backend)],
            )
        elif eff_phase == PipelinePhase.code:
            env_override = os.environ.get("CODING_MODEL")
            if env_override and env_override.strip():
                return env_override.strip()
            return CODING_PASS_MODELS.get(
                (eff_intensity, eff_backend),
                CODING_PASS_MODELS[(IntensityMode.soft, eff_backend)],
            )

    env_general = os.environ.get("LLM_MODEL") or os.environ.get("MODEL")
    if env_general and env_general.strip():
        return env_general.strip()

    return SINGLE_PASS_MODELS.get(
        (eff_intensity, eff_backend),
        SINGLE_PASS_MODELS[(IntensityMode.soft, eff_backend)],
    )


def resolve_gguf_filename_for_repo(
    repo_id: str,
    intensity: IntensityMode = IntensityMode.soft,
) -> Optional[str]:
    """Retourne le nom de fichier .gguf par défaut pour un repo GGUF connu."""
    repo_cleaned = str(repo_id).strip()
    entry = GGUF_DEFAULT_FILENAMES.get(repo_cleaned)
    if entry:
        key = "intense" if intensity == IntensityMode.intense else "soft"
        return entry.get(key)
    return None
