"""Utilitaires partagés pour l'inférence locale Apple MLX (sampling, tokenisation, batching continu)."""

from __future__ import annotations

import gc
import importlib
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple


DEFAULT_MLX_BATCH_SIZE = 1


def resolve_mlx_batch_size(batch_size: Optional[int] = None) -> int:
    """Résout la taille de lot MLX depuis l'argument explicite ou la variable `MLX_BATCH_SIZE`."""
    import os

    if batch_size is not None:
        return max(1, int(batch_size))
    raw = os.environ.get("MLX_BATCH_SIZE")
    if raw is not None and str(raw).strip():
        try:
            return max(1, int(str(raw).strip()))
        except ValueError:
            pass
    return DEFAULT_MLX_BATCH_SIZE


def encode_prompt_tokens(tokenizer: Any, formatted_prompt: str) -> List[int]:
    """Encode un prompt formaté en tokens sans dupliquer le token `<bos>`."""
    bos_tok = getattr(tokenizer, "bos_token", None)
    add_special = bos_tok is None or not (
        isinstance(bos_tok, str) and bool(bos_tok) and formatted_prompt.startswith(bos_tok)
    )
    try:
        tokens = tokenizer.encode(formatted_prompt, add_special_tokens=add_special)
    except TypeError:
        tokens = tokenizer.encode(formatted_prompt)
    return [int(t) for t in tokens]


def resolve_stop_token_ids(tokenizer: Any) -> List[List[int]]:
    """Retourne la liste des séquences d'arrêt EOS du tokenizer pour `BatchGenerator`."""
    eos_ids = getattr(tokenizer, "eos_token_ids", None)
    if isinstance(eos_ids, (set, list, tuple)):
        stops = [[int(t)] for t in eos_ids if isinstance(t, int)]
        if stops:
            return stops
    single_eos = getattr(tokenizer, "eos_token_id", None)
    if isinstance(single_eos, int):
        return [[int(single_eos)]]
    return []


def build_mlx_sampler(
    temperature: float,
    top_p: Optional[float] = None,
    top_k: Optional[int] = None,
) -> Any:
    """Construit un sampler `mlx_lm` avec `temp`, `top_p` et `top_k` officiels."""
    from mlx_lm.sample_utils import make_sampler

    sampler_kwargs: Dict[str, Any] = {"temp": float(temperature)}
    if top_p is not None and 0.0 < float(top_p) <= 1.0:
        sampler_kwargs["top_p"] = float(top_p)
    if top_k is not None and int(top_k) > 0:
        sampler_kwargs["top_k"] = int(top_k)

    try:
        return make_sampler(**sampler_kwargs)
    except TypeError:
        return make_sampler(temp=float(temperature))


def build_mlx_logits_processors(
    repetition_penalty: Optional[float] = None,
    repetition_context_size: int = 128,
) -> Optional[List[Any]]:
    """Construit les processeurs de logits MLX (ex: `repetition_penalty`) si configurés (> 1.0)."""
    if repetition_penalty is None:
        return None
    penalty = float(repetition_penalty)
    if penalty <= 1.0:
        return None

    try:
        from mlx_lm.sample_utils import make_logits_processors

        processors = make_logits_processors(
            repetition_penalty=penalty,
            repetition_context_size=max(16, int(repetition_context_size)),
        )
    except (ImportError, TypeError):
        return None

    return list(processors) if processors else None


def clear_mlx_memory_cache() -> None:
    """Force la collecte Python et vide le cache Metal MLX."""
    gc.collect()
    try:
        import mlx.core as mx

        if hasattr(mx, "clear_cache"):
            mx.clear_cache()
        elif hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
            mx.metal.clear_cache()
    except Exception:
        pass


@dataclass
class MLXBatchItemResult:
    """Résultat individuel produit par le générateur continu MLX."""

    index: int
    text: str
    completion_tokens: int
    finish_reason: Optional[str]
    duration_seconds: float
    generation_duration_seconds: float
    time_to_first_token_seconds: float
    tokens_per_second: float


@dataclass
class MLXBatchRunStats:
    """Statistiques agrégées d'un lot MLX continu."""

    prompt_tokens: int = 0
    prompt_tps: float = 0.0
    generation_tokens: int = 0
    generation_tps: float = 0.0
    peak_memory_gb: float = 0.0
    wall_seconds: float = 0.0


def run_mlx_continuous_batch(
    model: Any,
    tokenizer: Any,
    prompts_tokens: Sequence[List[int]],
    max_tokens: int,
    sampler: Any,
    batch_size: int = DEFAULT_MLX_BATCH_SIZE,
    on_item_complete: Optional[Callable[[MLXBatchItemResult], None]] = None,
    logits_processors: Optional[Sequence[Any]] = None,
) -> Tuple[List[MLXBatchItemResult], MLXBatchRunStats]:
    """Exécute un lot de prompts en parallélisme continu via `mlx_lm.generate.BatchGenerator`.

    Chaque prompt est préfillé puis décodé en concurrence (`batch_size` slots actifs) et libéré
    dès son token d'arrêt pour laisser la place au suivant sans bloquer sur les cartes longues.
    """
    if not prompts_tokens:
        return [], MLXBatchRunStats()

    eff_batch = max(1, int(batch_size))
    mlx_generate = importlib.import_module("mlx_lm.generate")
    BatchGenerator = mlx_generate.BatchGenerator

    stop_tokens = resolve_stop_token_ids(tokenizer)
    bg_kwargs: Dict[str, Any] = {
        "max_tokens": max_tokens,
        "stop_tokens": stop_tokens,
        "sampler": sampler,
        "prefill_batch_size": min(eff_batch, len(prompts_tokens)),
        "completion_batch_size": eff_batch,
        "max_kv_size": 4096,
    }
    if logits_processors:
        bg_kwargs["logits_processors"] = list(logits_processors)

    gen = BatchGenerator(model, **bg_kwargs)

    t_batch_start = time.perf_counter()
    uids = list(gen.insert(list(prompts_tokens), max_tokens=[max_tokens] * len(prompts_tokens)))
    idx_by_uid: Dict[int, int] = {uid: i for i, uid in enumerate(uids)}
    tokens_by_uid: Dict[int, List[int]] = {uid: [] for uid in uids}
    first_tok_time_by_uid: Dict[int, float] = {}
    results_by_idx: Dict[int, MLXBatchItemResult] = {}

    stats_obj = None
    try:
        with gen.stats() as stats_obj:
            while True:
                prompt_responses, gen_responses = gen.next()
                if not prompt_responses and not gen_responses:
                    break
                if not gen_responses:
                    continue

                t_now = time.perf_counter()
                for r in gen_responses:
                    if r.uid not in first_tok_time_by_uid:
                        first_tok_time_by_uid[r.uid] = t_now
                    if r.finish_reason != "stop":
                        tokens_by_uid[r.uid].append(int(r.token))
                    if r.finish_reason is not None:
                        item_toks = tokens_by_uid[r.uid]
                        t_first = first_tok_time_by_uid.get(r.uid, t_now)
                        wall_dur = max(0.001, t_now - t_batch_start)
                        gen_dur = max(0.001, t_now - t_first)
                        ttft = max(0.0, t_first - t_batch_start)
                        n_tok = len(item_toks)
                        item_tps = round(n_tok / gen_dur, 2) if n_tok > 0 and gen_dur > 0 else 0.0
                        decoded_text = str(tokenizer.decode(item_toks))

                        item_res = MLXBatchItemResult(
                            index=idx_by_uid[r.uid],
                            text=decoded_text,
                            completion_tokens=n_tok,
                            finish_reason=r.finish_reason,
                            duration_seconds=round(wall_dur, 3),
                            generation_duration_seconds=round(gen_dur, 3),
                            time_to_first_token_seconds=round(ttft, 3),
                            tokens_per_second=item_tps,
                        )
                        results_by_idx[item_res.index] = item_res
                        if on_item_complete is not None:
                            on_item_complete(item_res)
    finally:
        gen.close()

    t_batch_end = time.perf_counter()
    wall_total = max(0.001, t_batch_end - t_batch_start)
    ordered = [results_by_idx[i] for i in range(len(prompts_tokens)) if i in results_by_idx]

    total_gen_tokens = int(getattr(stats_obj, "generation_tokens", 0) or sum(r.completion_tokens for r in ordered))
    agg_gen_tps = float(getattr(stats_obj, "generation_tps", 0.0) or 0.0)
    if agg_gen_tps <= 0.0 and total_gen_tokens > 0:
        agg_gen_tps = round(total_gen_tokens / wall_total, 2)

    run_stats = MLXBatchRunStats(
        prompt_tokens=int(getattr(stats_obj, "prompt_tokens", 0) or 0),
        prompt_tps=round(float(getattr(stats_obj, "prompt_tps", 0.0) or 0.0), 2),
        generation_tokens=total_gen_tokens,
        generation_tps=round(agg_gen_tps, 2),
        peak_memory_gb=round(float(getattr(stats_obj, "peak_memory", 0.0) or 0.0), 2),
        wall_seconds=round(wall_total, 3),
    )
    return ordered, run_stats
