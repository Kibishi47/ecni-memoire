"""Orchestrateur de compilation en 2 étapes (Two-Pass Pipeline) pour Pokémon TCG Card Compiler.

Ce module garantit l'isolation stricte de la mémoire entre les 2 modèles :
1. Passe 1 (`reason`) : Charge l'IA de raisonnement (ex: DeepSeek-R1 Distill Qwen 14B),
   génère toutes les analyses textuelles de toutes les cartes cibles dans `data/reasoning_texts/`,
   puis décharge intégralement l'IA de la mémoire unifiée / RAM.
2. Passe 2 (`code`) : Charge l'IA de coding (ex: Qwen2.5-Coder 7B ou 14B),
   lit les analyses textuelles de la Passe 1, et génère les modèles JSON formels
   conformes (`EngineCardModel`) dans `data/compiled_cards/`.
3. Synchronise la base de données consolidée `data/cards_database.json`.
"""

from __future__ import annotations

import gc
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
)
from rich.table import Table

from compiler import load_env_file
from compiler.deterministic_builder import (
    build_deterministic_skeleton,
    compute_card_rule_signature,
)
from compiler.mlx_utils import resolve_mlx_batch_size
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
    normalize_intensity_mode,
    normalize_pipeline_phase,
    resolve_model_for_configuration,
)
from compiler.post_processor import sanitize_and_enrich_card
from compiler.reasoning_engine import (
    DEFAULT_REASONING_MAX_TOKENS,
    ReasoningEngine,
    ReasoningRecord,
    clone_reasoning_record,
    get_reasoning_texts_dir,
    has_reasoning_record,
    load_reasoning_record,
    save_reasoning_record,
)
from compiler.schemas import CompilationMetadata, EngineCardModel
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle


def _safe_bundle_signature(bundle: FetchedCardBundle) -> Optional[str]:
    """Calcule la signature canonique d'un bundle sans échouer si le squelette est incomplet."""
    try:
        return compute_card_rule_signature(bundle)
    except Exception:
        return None


def _index_disk_reasoning_by_signature(
    reason_dir: Path,
    raw_dir: Path,
    target_names: set[str],
    cache_by_sig: Dict[str, ReasoningRecord],
) -> None:
    """Indexe à moindre coût les analyses déjà sur disque pour les noms présents dans le lot."""
    if not target_names or not reason_dir.exists() or not raw_dir.exists():
        return
    for rpath in reason_dir.glob("*.json"):
        if rpath.name.startswith("_"):
            continue
        cid = rpath.stem
        raw_path = raw_dir / f"{cid}.json"
        if not raw_path.exists():
            continue
        try:
            raw_json = json.loads(rpath.read_text(encoding="utf-8"))
            if not isinstance(raw_json, dict) or not raw_json.get("reasoningText"):
                continue
            if raw_json.get("nameFr") not in target_names:
                continue
            rec = ReasoningRecord.from_dict(raw_json)
            if rec.wasTruncated:
                continue
            sig = compute_card_rule_signature(raw_path, raw_dir=raw_dir)
            cache_by_sig.setdefault(sig, rec)
        except Exception:
            continue


def _index_disk_compiled_by_signature(
    compiled_dir: Path,
    raw_dir: Path,
    target_names: set[str],
    cache_by_sig: Dict[str, EngineCardModel],
) -> None:
    """Indexe à moindre coût les cartes JSON déjà compilées sur disque pour déduplication Passe 2."""
    if not target_names or not compiled_dir.exists() or not raw_dir.exists():
        return
    for cpath in compiled_dir.glob("*.json"):
        if cpath.name.startswith("_"):
            continue
        cid = cpath.stem
        raw_path = raw_dir / f"{cid}.json"
        if not raw_path.exists():
            continue
        try:
            raw_json = json.loads(cpath.read_text(encoding="utf-8"))
            if not isinstance(raw_json, dict):
                continue
            ident = raw_json.get("identity") or {}
            if ident.get("nameFr") not in target_names:
                continue
            model_obj = EngineCardModel.model_validate(raw_json)
            sig = compute_card_rule_signature(raw_path, raw_dir=raw_dir)
            cache_by_sig.setdefault(sig, model_obj)
        except Exception:
            continue


def _clone_compiled_card_for_bundle(
    source_card: EngineCardModel,
    target_bundle: FetchedCardBundle,
) -> EngineCardModel:
    """Réutilise le résultat IA d'une carte identique en conservant l'identité de la cible."""
    target_skeleton = build_deterministic_skeleton(target_bundle)
    src_meta = source_card.compilationMetadata
    dedup_meta = CompilationMetadata(
        modelRepoId=src_meta.modelRepoId if src_meta else "DEDUP_CLONE",
        modelFilename=(
            f"{src_meta.modelFilename} (dedup:{source_card.cardId})"
            if src_meta
            else f"dedup:{source_card.cardId}"
        ),
        compilationTimeSeconds=0.0,
        compiledAtIso=datetime.now(timezone.utc).isoformat(),
        completionTokens=0,
        tokensPerSecond=0.0,
        generationTimeSeconds=0.0,
        timeToFirstTokenSeconds=0.0,
    )
    cloned = source_card.model_copy(
        deep=True,
        update={
            "cardId": target_bundle.card_id,
            "identity": target_skeleton.identity,
            "pokemonStats": target_skeleton.pokemonStats,
            "compilationMetadata": dedup_meta,
        },
    )
    return sanitize_and_enrich_card(target_bundle, cloned)


def run_reasoning_phase(
    bundles: List[FetchedCardBundle],
    data_dir: Path,
    model: Optional[str] = None,
    intensity: Optional[Union[IntensityMode, str]] = None,
    backend: Optional[str] = None,
    hf_token: Optional[str] = None,
    force: bool = False,
    continue_on_error: bool = False,
    batch_size: Optional[int] = None,
    max_tokens: Optional[int] = None,
    console: Optional[Console] = None,
) -> Dict[str, Any]:
    """Exécute la Passe 1 (Raisonnement) sur toutes les cartes cibles avec déduplication et batching MLX."""
    load_env_file()
    out_console = console or Console()
    eff_intensity = normalize_intensity_mode(intensity or os.environ.get("INTENSITY_MODE"))
    raw_b = (backend or os.environ.get("LOCAL_BACKEND") or "mlx").strip().lower()
    eff_backend = "mlx" if raw_b == "mlx" else "llama_cpp"
    eff_batch = resolve_mlx_batch_size(batch_size) if eff_backend == "mlx" else 1

    env_max_tok = os.environ.get("REASONING_MAX_TOKENS")
    eff_max_tokens = (
        max(256, int(max_tokens))
        if max_tokens is not None
        else (
            max(256, int(env_max_tok))
            if env_max_tok and env_max_tok.strip().isdigit()
            else DEFAULT_REASONING_MAX_TOKENS
        )
    )

    reason_dir = get_reasoning_texts_dir(data_dir)
    raw_dir = data_dir / "raw_tcgdex"
    pending_candidates: List[Tuple[FetchedCardBundle, Optional[str]]] = []
    cached_records: List[ReasoningRecord] = []
    cached_by_sig: Dict[str, ReasoningRecord] = {}
    static_energy_ids: List[str] = []

    for b in bundles:
        if is_basic_energy(b):
            rec = ReasoningRecord(
                cardId=b.card_id,
                nameFr=b.identity.nameFr,
                nameEn=b.identity.nameEn,
                modelRepoId="static_energy",
                modelBackend="static",
                reasoningText=f"Énergie de base {b.identity.nameFr} (court-circuit déterministe).",
                createdAtIso=time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                completionTokens=0,
                tokensPerSecond=0.0,
                generationDurationSeconds=0.0,
                finishReason="static",
            )
            save_reasoning_record(rec, data_dir)
            cached_records.append(rec)
            static_energy_ids.append(b.card_id)
            continue

        existing = load_reasoning_record(b.card_id, data_dir)
        sig = _safe_bundle_signature(b)
        if existing and not force:
            cached_records.append(existing)
            if sig and not existing.wasTruncated:
                cached_by_sig.setdefault(sig, existing)
        else:
            pending_candidates.append((b, sig))

    if pending_candidates and not force:
        _index_disk_reasoning_by_signature(
            reason_dir=reason_dir,
            raw_dir=raw_dir,
            target_names={b.identity.nameFr for b, _ in pending_candidates},
            cache_by_sig=cached_by_sig,
        )

    bundles_to_process: List[FetchedCardBundle] = []
    dup_groups: Dict[str, List[FetchedCardBundle]] = {}
    sig_by_rep_id: Dict[str, str] = {}
    dedup_reused_records: List[ReasoningRecord] = []

    for b, sig in pending_candidates:
        if not force and sig and sig in cached_by_sig:
            cloned = clone_reasoning_record(cached_by_sig[sig], b)
            save_reasoning_record(cloned, data_dir)
            dedup_reused_records.append(cloned)
            cached_records.append(cloned)
            continue
        if sig and sig in dup_groups:
            dup_groups[sig].append(b)
            continue
        if sig:
            dup_groups[sig] = []
            sig_by_rep_id[b.card_id] = sig
        bundles_to_process.append(b)

    planned_in_batch_dups = sum(len(v) for v in dup_groups.values())
    batch_line = (
        f"• [bold]Batching continu MLX[/bold] : [bold cyan]batch_size={eff_batch}[/bold cyan]\n"
        if eff_backend == "mlx"
        else ""
    )

    out_console.print(
        Panel.fit(
            f"[bold magenta]⚡ Pipeline Two-Pass — Passe 1 / 2 : Raisonnement Approfondi[/bold magenta]\n"
            f"• [bold]Cartes totales[/bold] : {len(bundles)}\n"
            f"• [bold]Déjà en cache[/bold] : {len(cached_records) - len(dedup_reused_records)} carte(s)\n"
            f"• [bold]Doublons réutilisés (cache)[/bold] : [cyan]{len(dedup_reused_records)}[/cyan] carte(s)\n"
            f"• [bold]Cartes uniques à analyser[/bold] : {len(bundles_to_process)} carte(s)"
            + (f" [dim](+ {planned_in_batch_dups} doublon(s) cloné(s) sans appel IA)[/dim]" if planned_in_batch_dups else "")
            + "\n"
            f"• [bold]Niveau de puissance[/bold] : [bold cyan]{eff_intensity.value.upper()}[/bold cyan]\n"
            f"• [bold]Backend[/bold] : [bold green]{eff_backend}[/bold green]\n"
            f"{batch_line}"
            f"• [bold]Budget max tokens / Sampling[/bold] : [cyan]{eff_max_tokens} tokens[/cyan] "
            f"[dim](temp=1.0, top_p=0.95, top_k=64)[/dim]\n"
            f"• [bold]Raisonnement (Thinking)[/bold] : [bold green]Activé (enable_thinking=True, non borné)[/bold green]\n"
            f"• [bold]Dossier de sortie[/bold] : [cyan]{reason_dir}[/cyan]",
            border_style="magenta",
        )
    )

    if static_energy_ids:
        out_console.print(
            f"[cyan]⚡ {len(static_energy_ids)} Énergie(s) de Base court-circuitée(s) instantanément.[/cyan]"
        )

    if dedup_reused_records:
        out_console.print(
            f"[cyan]♻️ {len(dedup_reused_records)} carte(s) identique(s) clonée(s) instantanément depuis le cache existant (0 token).[/cyan]"
        )

    if not bundles_to_process:
        out_console.print(
            "[green]✓ Toutes les analyses de raisonnement sont déjà disponibles en cache.[/green]"
        )
        return {
            "total": len(bundles),
            "generated": 0,
            "deduplicated": len(dedup_reused_records),
            "cached": len(cached_records),
            "truncated": [],
            "failed": [],
        }

    engine = ReasoningEngine(
        model=model,
        intensity=eff_intensity,
        backend=eff_backend,
        hf_token=hf_token,
        max_tokens=eff_max_tokens,
        enable_thinking=True,
    )

    bundle_by_id = {b.card_id: b for b in bundles_to_process}
    failed_cards: List[Tuple[str, str, str]] = []
    generated_records: List[ReasoningRecord] = []
    cloned_in_run = 0
    truncated_cards: List[str] = []
    batch_stats: Dict[str, Any] = {}

    def _persist_and_clone(record: ReasoningRecord, log_console: Console) -> None:
        nonlocal cloned_in_run
        save_reasoning_record(record, data_dir)
        generated_records.append(record)

        rep_sig = sig_by_rep_id.get(record.cardId)
        dups_for_rep = dup_groups.get(rep_sig, []) if rep_sig else []
        for dup_b in dups_for_rep:
            dup_rec = clone_reasoning_record(record, dup_b)
            save_reasoning_record(dup_rec, data_dir)
            cloned_in_run += 1

        if record.wasTruncated:
            truncated_cards.append(record.cardId)

        tps_str = (
            f" • [cyan]{record.tokensPerSecond:.1f} t/s[/cyan]"
            if record.tokensPerSecond
            else ""
        )
        tok_str = (
            f" ({record.completionTokens} tokens)"
            if record.completionTokens
            else ""
        )
        dur_str = (
            f"[yellow]{record.generationDurationSeconds:.2f}s[/yellow]"
            if record.generationDurationSeconds is not None
            else ""
        )
        dup_str = f" [cyan](+ {len(dups_for_rep)} doublon(s) cloné(s))[/cyan]" if dups_for_rep else ""
        trunc_str = " [bold yellow]⚠️ TRONQUÉ (max_tokens atteint)[/bold yellow]" if record.wasTruncated else ""
        log_console.print(
            f"  [green]✓[/green] [bold]{record.cardId}[/bold] ({record.nameFr}) analysé en "
            f"{dur_str}{tok_str}{tps_str}{dup_str}{trunc_str}"
        )

    try:
        with out_console.status(
            f"[bold magenta]Chargement de l'IA de raisonnement {engine.repo_id}...[/bold magenta]"
        ):
            engine.load_model_in_memory()

        out_console.print(
            f"[green]✓[/green] Modèle de raisonnement [bold]{engine.repo_id}[/bold] prêt en mémoire unifiée."
        )

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=out_console,
        ) as progress:
            task_id = progress.add_task(
                "[magenta]Génération des analyses textuelles...",
                total=len(bundles_to_process),
            )

            use_batch = eff_backend == "mlx" and eff_batch > 1 and len(bundles_to_process) > 1
            if use_batch:
                progress.update(
                    task_id,
                    description=f"[magenta]Analyse MLX en batch (batch_size={eff_batch}, {len(bundles_to_process)} carte(s))...",
                )

                def on_batch_done(rec: ReasoningRecord) -> None:
                    _persist_and_clone(rec, progress.console)
                    progress.advance(task_id)

                _, batch_stats = engine.generate_reasoning_batch(
                    bundles_to_process,
                    batch_size=eff_batch,
                    on_card_done=on_batch_done,
                )
            else:
                for b in bundles_to_process:
                    progress.update(
                        task_id,
                        description=f"[magenta]Analyse de [bold]{b.card_id}[/bold] ({b.identity.nameFr})...",
                    )

                    def make_token_callback(bundle: FetchedCardBundle = b) -> Callable[[int, float], None]:
                        def on_token(tok_count: int, live_tps: float) -> None:
                            tps_disp = (
                                f"[bold green]{live_tps:.1f} t/s[/bold green]"
                                if live_tps > 0
                                else "[dim]calcul...[/dim]"
                            )
                            progress.update(
                                task_id,
                                description=(
                                    f"[magenta]Analyse de [bold]{bundle.card_id}[/bold] ({bundle.identity.nameFr}) "
                                    f"[dim]•[/dim] {tps_disp} [dim]({tok_count} tok)[/dim]"
                                ),
                            )
                        return on_token

                    try:
                        record = engine.generate_reasoning(b, on_token=make_token_callback(b))
                        _persist_and_clone(record, progress.console)
                    except Exception as card_err:
                        progress.console.print(
                            f"\n[bold red]✗ Erreur lors de l'analyse de {b.card_id} ({b.identity.nameFr}) :[/bold red] {card_err}"
                        )
                        failed_cards.append((b.card_id, b.identity.nameFr, str(card_err)))
                        if not continue_on_error:
                            raise
                    finally:
                        progress.advance(task_id)

    finally:
        # DÉCHARGEMENT STRICT DE L'IA 1
        out_console.print(
            "[dim]Libération de la mémoire de l'IA de raisonnement (Passe 1)...[/dim]"
        )
        engine.close()
        del engine
        gc.collect()

    if batch_stats and batch_stats.get("batch_tps"):
        out_console.print(
            f"[cyan]⚡ Débit batch global MLX : [bold]{batch_stats['batch_tps']:.1f} t/s[/bold] • "
            f"{batch_stats.get('generation_tokens', 0)} tokens en {batch_stats.get('wall_seconds', 0):.2f}s"
            + (f" • Mémoire pic : {batch_stats['peak_memory_gb']:.2f} Go" if batch_stats.get("peak_memory_gb") else "")
            + "[/cyan]"
        )
    if truncated_cards:
        out_console.print(
            f"[bold yellow]⚠️ {len(truncated_cards)} carte(s) ont atteint `max_tokens={eff_max_tokens}` : "
            f"{', '.join(truncated_cards[:10])}{'...' if len(truncated_cards) > 10 else ''}[/bold yellow]"
        )

    total_written = len(generated_records) + cloned_in_run + len(dedup_reused_records)
    out_console.print(
        f"[bold green]✓ Passe 1 terminée : {len(generated_records)} analyse(s) générée(s)"
        + (f" + {cloned_in_run + len(dedup_reused_records)} doublon(s) cloné(s)" if (cloned_in_run or dedup_reused_records) else "")
        + f" ({total_written} fiche(s) enregistrée(s) dans data/reasoning_texts/).[/bold green]\n"
        "[dim]Mémoire unifiée 100% libérée pour la Passe 2.[/dim]\n"
    )

    return {
        "total": len(bundles),
        "generated": len(generated_records),
        "deduplicated": cloned_in_run + len(dedup_reused_records),
        "cached": len(cached_records),
        "truncated": truncated_cards,
        "failed": failed_cards,
        "batch_stats": batch_stats,
    }


def run_coding_phase(
    bundles: List[FetchedCardBundle],
    data_dir: Path,
    model: Optional[str] = None,
    intensity: Optional[Union[IntensityMode, str]] = None,
    backend: Optional[str] = None,
    hf_token: Optional[str] = None,
    force: bool = False,
    continue_on_error: bool = False,
    batch_size: Optional[int] = None,
    console: Optional[Console] = None,
) -> Dict[str, Any]:
    """Exécute la Passe 2 (Codage JSON) à partir des analyses textuelles préalables."""
    load_env_file()
    out_console = console or Console()
    eff_intensity = normalize_intensity_mode(intensity or os.environ.get("INTENSITY_MODE"))
    raw_b = (backend or os.environ.get("LOCAL_BACKEND") or "mlx").strip().lower()
    eff_backend = "mlx" if raw_b == "mlx" else "llama_cpp"
    eff_batch = resolve_mlx_batch_size(batch_size) if eff_backend == "mlx" else 1

    compiled_dir = data_dir / "compiled_cards"
    compiled_dir.mkdir(parents=True, exist_ok=True)
    raw_dir = data_dir / "raw_tcgdex"

    pending_candidates: List[Tuple[FetchedCardBundle, Optional[str]]] = []
    no_reasoning_candidates: List[Tuple[FetchedCardBundle, Optional[str]]] = []
    compiled_results: List[EngineCardModel] = []
    compiled_by_sig: Dict[str, EngineCardModel] = {}
    missing_reasoning: List[Tuple[str, str]] = []
    static_energy_ids: List[str] = []

    for b in bundles:
        out_path = compiled_dir / f"{b.card_id}.json"

        if is_basic_energy(b):
            static_model = build_basic_energy_model(b)
            out_path.write_text(
                json.dumps(static_model.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            compiled_results.append(static_model)
            static_energy_ids.append(b.card_id)
            continue

        sig = _safe_bundle_signature(b)
        if out_path.exists() and not force:
            try:
                existing = EngineCardModel.model_validate_json(out_path.read_text(encoding="utf-8"))
                existing = sanitize_and_enrich_card(b, existing)
                out_path.write_text(
                    json.dumps(existing.model_dump(mode="json"), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                compiled_results.append(existing)
                if sig:
                    compiled_by_sig.setdefault(sig, existing)
                continue
            except Exception:
                pass

        if not has_reasoning_record(b.card_id, data_dir):
            no_reasoning_candidates.append((b, sig))
        else:
            pending_candidates.append((b, sig))

    if (pending_candidates or no_reasoning_candidates) and not force:
        _index_disk_compiled_by_signature(
            compiled_dir=compiled_dir,
            raw_dir=raw_dir,
            target_names={b.identity.nameFr for b, _ in pending_candidates} | {b.identity.nameFr for b, _ in no_reasoning_candidates},
            cache_by_sig=compiled_by_sig,
        )

    bundles_to_compile: List[FetchedCardBundle] = []
    dup_groups: Dict[str, List[FetchedCardBundle]] = {}
    sig_by_rep_id: Dict[str, str] = {}
    dedup_cloned_count = 0

    for b, sig in pending_candidates:
        if not force and sig and sig in compiled_by_sig:
            cloned_card = _clone_compiled_card_for_bundle(compiled_by_sig[sig], b)
            out_path = compiled_dir / f"{b.card_id}.json"
            out_path.write_text(
                json.dumps(cloned_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            compiled_results.append(cloned_card)
            dedup_cloned_count += 1
            continue
        if sig and sig in dup_groups:
            dup_groups[sig].append(b)
            continue
        if sig:
            dup_groups[sig] = []
            sig_by_rep_id[b.card_id] = sig
        bundles_to_compile.append(b)

    # Permet de cloner un doublon sans fiche d'analyse propre dès lors qu'un équivalent est déjà compilé ou en cours
    for b, sig in no_reasoning_candidates:
        if not force and sig and sig in compiled_by_sig:
            cloned_card = _clone_compiled_card_for_bundle(compiled_by_sig[sig], b)
            out_path = compiled_dir / f"{b.card_id}.json"
            out_path.write_text(
                json.dumps(cloned_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            compiled_results.append(cloned_card)
            dedup_cloned_count += 1
        elif sig and sig in dup_groups:
            dup_groups[sig].append(b)
        else:
            missing_reasoning.append((b.card_id, b.identity.nameFr))

    planned_in_batch_dups = sum(len(v) for v in dup_groups.values())
    batch_line = (
        f"• [bold]Batching continu MLX[/bold] : [bold cyan]batch_size={eff_batch}[/bold cyan]\n"
        if eff_backend == "mlx"
        else ""
    )

    out_console.print(
        Panel.fit(
            f"[bold cyan]⚡ Pipeline Two-Pass — Passe 2 / 2 : Codage JSON Formel[/bold cyan]\n"
            f"• [bold]Cartes totales[/bold] : {len(bundles)}\n"
            f"• [bold]Déjà compilées[/bold] : {len(compiled_results) - dedup_cloned_count} carte(s)\n"
            f"• [bold]Doublons réutilisés (cache)[/bold] : [cyan]{dedup_cloned_count}[/cyan] carte(s)\n"
            f"• [bold]Cartes uniques à coder en JSON[/bold] : {len(bundles_to_compile)} carte(s)"
            + (f" [dim](+ {planned_in_batch_dups} doublon(s) cloné(s) sans appel IA)[/dim]" if planned_in_batch_dups else "")
            + "\n"
            f"• [bold]Analyses manquantes[/bold] : {len(missing_reasoning)} carte(s)\n"
            f"• [bold]Niveau de puissance[/bold] : [bold cyan]{eff_intensity.value.upper()}[/bold cyan]\n"
            f"• [bold]Backend[/bold] : [bold green]{eff_backend}[/bold green]\n"
            f"{batch_line}"
            f"• [bold]Raisonnement (Thinking)[/bold] : [yellow]Désactivé (enable_thinking=False)[/yellow]\n"
            f"• [bold]Dossier de sortie[/bold] : [cyan]{compiled_dir}[/cyan]",
            border_style="cyan",
        )
    )

    if dedup_cloned_count:
        out_console.print(
            f"[cyan]♻️ {dedup_cloned_count} carte(s) identique(s) clonée(s) instantanément depuis le cache JSON existant (0 token).[/cyan]"
        )

    if missing_reasoning:
        out_console.print(
            f"[bold yellow]⚠️ Attention : {len(missing_reasoning)} carte(s) n'ont pas encore d'analyse de Passe 1 dans data/reasoning_texts/ :[/bold yellow]\n"
            f"[yellow]{', '.join(cid for cid, _ in missing_reasoning[:10])}{'...' if len(missing_reasoning) > 10 else ''}[/yellow]\n"
            "[yellow]👉 Lancez d'abord la Passe 1 avec : python -m compiler.cli reason (ou run --phase reason).[/yellow]"
        )

    if not bundles_to_compile:
        out_console.print(
            "[green]✓ Aucune nouvelle carte à coder en JSON.[/green]"
        )
        return {
            "total": len(bundles),
            "compiled": len(compiled_results),
            "deduplicated": dedup_cloned_count,
            "missing_reasoning": missing_reasoning,
            "failed": [],
        }

    resolved_coding_model = resolve_model_for_configuration(
        pipeline_mode=PipelineMode.two_pass,
        intensity=eff_intensity,
        phase=PipelinePhase.code,
        backend=eff_backend,
        explicit_model=model,
    )

    # Instanciation de l'IA de coding (Passe 2)
    if eff_backend == "mlx":
        from compiler.mlx_engine import MLXCardCompiler
        coding_engine: Any = MLXCardCompiler(
            model=resolved_coding_model,
            hf_token=hf_token,
            disable_thinking=True,  # Pour l'IA de coding, on désactive le CoT libre pour maximiser la vitesse du JSON
        )
    else:
        from compiler.llm_engine import LocalLLMCardCompiler
        coding_engine = LocalLLMCardCompiler(
            model=resolved_coding_model,
            hf_token=hf_token,
            disable_thinking=True,
        )

    failed_cards: List[Tuple[str, str, str]] = []
    bundle_by_id = {b.card_id: b for b in bundles_to_compile}
    cloned_in_run = 0
    batch_stats: Dict[str, Any] = {}

    def _persist_and_clone_compiled(engine_card: EngineCardModel, log_console: Console) -> None:
        nonlocal cloned_in_run
        rep_b = bundle_by_id.get(engine_card.cardId)
        out_path = compiled_dir / f"{engine_card.cardId}.json"
        out_path.write_text(
            json.dumps(engine_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        compiled_results.append(engine_card)

        rep_sig = sig_by_rep_id.get(engine_card.cardId)
        dups_for_rep = dup_groups.get(rep_sig, []) if rep_sig else []
        for dup_b in dups_for_rep:
            dup_card = _clone_compiled_card_for_bundle(engine_card, dup_b)
            dup_path = compiled_dir / f"{dup_b.card_id}.json"
            dup_path.write_text(
                json.dumps(dup_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            compiled_results.append(dup_card)
            cloned_in_run += 1

        meta = engine_card.compilationMetadata
        tps_str = (
            f" • [cyan]{meta.tokensPerSecond:.1f} t/s[/cyan]"
            if meta and meta.tokensPerSecond
            else ""
        )
        tok_str = (
            f" ({meta.completionTokens} tokens)"
            if meta and meta.completionTokens
            else ""
        )
        elapsed_str = f"{meta.compilationTimeSeconds:.2f}s" if meta else ""
        dup_str = f" [cyan](+ {len(dups_for_rep)} doublon(s) cloné(s))[/cyan]" if dups_for_rep else ""
        card_name = rep_b.identity.nameFr if rep_b else engine_card.identity.nameFr
        log_console.print(
            f"  [green]✓[/green] [bold]{engine_card.cardId}[/bold] ({card_name}) compilé en JSON en "
            f"[yellow]{elapsed_str}[/yellow]{tok_str}{tps_str}{dup_str}"
        )

    try:
        with out_console.status(
            f"[bold cyan]Chargement de l'IA de coding {coding_engine.repo_id}...[/bold cyan]"
        ):
            coding_engine.load_model_in_memory()

        out_console.print(
            f"[green]✓[/green] Modèle de coding [bold]{coding_engine.repo_id}[/bold] prêt en mémoire unifiée."
        )

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            TaskProgressColumn(),
            TimeElapsedColumn(),
            console=out_console,
        ) as progress:
            task_id = progress.add_task(
                "[cyan]Génération du code JSON formel...",
                total=len(bundles_to_compile),
            )

            use_batch = eff_backend == "mlx" and eff_batch > 1 and len(bundles_to_compile) > 1 and hasattr(coding_engine, "compile_cards_batch")
            if use_batch:
                progress.update(
                    task_id,
                    description=f"[cyan]Codage JSON MLX en batch (batch_size={eff_batch}, {len(bundles_to_compile)} carte(s))...",
                )
                batch_items: List[Tuple[FetchedCardBundle, Optional[str]]] = []
                for b in bundles_to_compile:
                    reason_rec = load_reasoning_record(b.card_id, data_dir)
                    batch_items.append((b, reason_rec.reasoningText if reason_rec else ""))

                def on_batch_compiled(card_model: EngineCardModel) -> None:
                    _persist_and_clone_compiled(card_model, progress.console)
                    progress.advance(task_id)

                def on_batch_error(err_bundle: FetchedCardBundle, card_err: Exception) -> None:
                    progress.console.print(
                        f"\n[bold red]✗ Erreur lors du codage JSON de {err_bundle.card_id} ({err_bundle.identity.nameFr}) :[/bold red] {card_err}"
                    )
                    failed_cards.append((err_bundle.card_id, err_bundle.identity.nameFr, str(card_err)))
                    progress.advance(task_id)

                _, batch_stats = coding_engine.compile_cards_batch(
                    batch_items,
                    batch_size=eff_batch,
                    continue_on_error=continue_on_error,
                    on_card_done=on_batch_compiled,
                    on_card_error=on_batch_error,
                )
            else:
                for b in bundles_to_compile:
                    reason_rec = load_reasoning_record(b.card_id, data_dir)
                    reason_text = reason_rec.reasoningText if reason_rec else ""

                    progress.update(
                        task_id,
                        description=f"[cyan]Codage JSON de [bold]{b.card_id}[/bold] ({b.identity.nameFr})...",
                    )

                    def make_token_callback(bundle: FetchedCardBundle = b) -> Callable[[int, float], None]:
                        def on_token(tok_count: int, live_tps: float) -> None:
                            tps_disp = (
                                f"[bold green]{live_tps:.1f} t/s[/bold green]"
                                if live_tps > 0
                                else "[dim]calcul...[/dim]"
                            )
                            progress.update(
                                task_id,
                                description=(
                                    f"[cyan]Codage JSON de [bold]{bundle.card_id}[/bold] ({bundle.identity.nameFr}) "
                                    f"[dim]•[/dim] {tps_disp} [dim]({tok_count} tok)[/dim]"
                                ),
                            )
                        return on_token

                    try:
                        engine_card = coding_engine.compile_card(
                            bundle=b,
                            reasoning_text=reason_text,
                            on_token=make_token_callback(b),
                        )
                        _persist_and_clone_compiled(engine_card, progress.console)
                    except Exception as card_err:
                        progress.console.print(
                            f"\n[bold red]✗ Erreur lors du codage JSON de {b.card_id} ({b.identity.nameFr}) :[/bold red] {card_err}"
                        )
                        failed_cards.append((b.card_id, b.identity.nameFr, str(card_err)))
                        if not continue_on_error:
                            raise
                    finally:
                        progress.advance(task_id)

    finally:
        # DÉCHARGEMENT STRICT DE L'IA 2
        out_console.print(
            "[dim]Libération de la mémoire de l'IA de coding (Passe 2)...[/dim]"
        )
        coding_engine.close()
        del coding_engine
        gc.collect()

    if batch_stats and batch_stats.get("batch_tps"):
        out_console.print(
            f"[cyan]⚡ Débit batch global MLX (Passe 2) : [bold]{batch_stats['batch_tps']:.1f} t/s[/bold] • "
            f"{batch_stats.get('generation_tokens', 0)} tokens en {batch_stats.get('wall_seconds', 0):.2f}s"
            + (f" • Mémoire pic : {batch_stats['peak_memory_gb']:.2f} Go" if batch_stats.get("peak_memory_gb") else "")
            + "[/cyan]"
        )

    return {
        "total": len(bundles),
        "compiled": len(compiled_results),
        "deduplicated": dedup_cloned_count + cloned_in_run,
        "missing_reasoning": missing_reasoning,
        "failed": failed_cards,
        "batch_stats": batch_stats,
    }


def run_two_pass_pipeline(
    bundles: List[FetchedCardBundle],
    data_dir: Path,
    phase: Union[PipelinePhase, str] = PipelinePhase.all,
    model: Optional[str] = None,
    intensity: Optional[Union[IntensityMode, str]] = None,
    backend: Optional[str] = None,
    hf_token: Optional[str] = None,
    force: bool = False,
    continue_on_error: bool = False,
    batch_size: Optional[int] = None,
    max_tokens: Optional[int] = None,
    console: Optional[Console] = None,
) -> Dict[str, Any]:
    """Point d'entrée unifié pour le pipeline Two-Pass."""
    eff_phase = normalize_pipeline_phase(phase)
    out_console = console or Console()

    results: Dict[str, Any] = {}

    if eff_phase in {PipelinePhase.all, PipelinePhase.reason}:
        results["reasoning"] = run_reasoning_phase(
            bundles=bundles,
            data_dir=data_dir,
            model=model if eff_phase == PipelinePhase.reason else None,
            intensity=intensity,
            backend=backend,
            hf_token=hf_token,
            force=force,
            continue_on_error=continue_on_error,
            batch_size=batch_size,
            max_tokens=max_tokens,
            console=out_console,
        )

    if eff_phase in {PipelinePhase.all, PipelinePhase.code}:
        results["coding"] = run_coding_phase(
            bundles=bundles,
            data_dir=data_dir,
            model=model if eff_phase == PipelinePhase.code else None,
            intensity=intensity,
            backend=backend,
            hf_token=hf_token,
            force=force,
            continue_on_error=continue_on_error,
            batch_size=batch_size,
            console=out_console,
        )

    return results
