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
    ReasoningEngine,
    ReasoningRecord,
    get_reasoning_texts_dir,
    has_reasoning_record,
    load_reasoning_record,
    save_reasoning_record,
)
from compiler.schemas import EngineCardModel
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle


def run_reasoning_phase(
    bundles: List[FetchedCardBundle],
    data_dir: Path,
    model: Optional[str] = None,
    intensity: Optional[Union[IntensityMode, str]] = None,
    backend: Optional[str] = None,
    hf_token: Optional[str] = None,
    force: bool = False,
    continue_on_error: bool = False,
    console: Optional[Console] = None,
) -> Dict[str, Any]:
    """Exécute la Passe 1 (Raisonnement) sur toutes les cartes cibles."""
    load_env_file()
    out_console = console or Console()
    eff_intensity = normalize_intensity_mode(intensity or os.environ.get("INTENSITY_MODE"))
    raw_b = (backend or os.environ.get("LOCAL_BACKEND") or "mlx").strip().lower()
    eff_backend = "mlx" if raw_b == "mlx" else "llama_cpp"

    reason_dir = get_reasoning_texts_dir(data_dir)
    bundles_to_process: List[FetchedCardBundle] = []
    cached_records: List[ReasoningRecord] = []
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
            )
            save_reasoning_record(rec, data_dir)
            cached_records.append(rec)
            static_energy_ids.append(b.card_id)
            continue

        existing = load_reasoning_record(b.card_id, data_dir)
        if existing and not force:
            cached_records.append(existing)
        else:
            bundles_to_process.append(b)

    out_console.print(
        Panel.fit(
            f"[bold magenta]⚡ Pipeline Two-Pass — Passe 1 / 2 : Raisonnement Approfondi[/bold magenta]\n"
            f"• [bold]Cartes totales[/bold] : {len(bundles)}\n"
            f"• [bold]Déjà en cache[/bold] : {len(cached_records)} carte(s)\n"
            f"• [bold]À analyser[/bold] : {len(bundles_to_process)} carte(s)\n"
            f"• [bold]Niveau de puissance[/bold] : [bold cyan]{eff_intensity.value.upper()}[/bold cyan]\n"
            f"• [bold]Backend[/bold] : [bold green]{eff_backend}[/bold green]\n"
            f"• [bold]Dossier de sortie[/bold] : [cyan]{reason_dir}[/cyan]",
            border_style="magenta",
        )
    )

    if static_energy_ids:
        out_console.print(
            f"[cyan]⚡ {len(static_energy_ids)} Énergie(s) de Base court-circuitée(s) instantanément.[/cyan]"
        )

    if not bundles_to_process:
        out_console.print(
            "[green]✓ Toutes les analyses de raisonnement sont déjà disponibles en cache.[/green]"
        )
        return {
            "total": len(bundles),
            "generated": 0,
            "cached": len(cached_records),
            "failed": [],
        }

    engine = ReasoningEngine(
        model=model,
        intensity=eff_intensity,
        backend=eff_backend,
        hf_token=hf_token,
    )

    failed_cards: List[Tuple[str, str, str]] = []
    generated_records: List[ReasoningRecord] = []

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

            for b in bundles_to_process:
                progress.update(
                    task_id,
                    description=f"[magenta]Analyse de [bold]{b.card_id}[/bold] ({b.identity.nameFr})...",
                )

                def make_token_callback(bundle=b):
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
                    save_reasoning_record(record, data_dir)
                    generated_records.append(record)

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
                    progress.console.print(
                        f"  [green]✓[/green] [bold]{b.card_id}[/bold] ({b.identity.nameFr}) analysé en "
                        f"{dur_str}{tok_str}{tps_str}"
                    )
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

    out_console.print(
        f"[bold green]✓ Passe 1 terminée : {len(generated_records)} analyse(s) textuelle(s) enregistrée(s) dans data/reasoning_texts/.[/bold green]\n"
        "[dim]Mémoire unifiée 100% libérée pour la Passe 2.[/dim]\n"
    )

    return {
        "total": len(bundles),
        "generated": len(generated_records),
        "cached": len(cached_records),
        "failed": failed_cards,
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
    console: Optional[Console] = None,
) -> Dict[str, Any]:
    """Exécute la Passe 2 (Codage JSON) à partir des analyses textuelles préalables."""
    load_env_file()
    out_console = console or Console()
    eff_intensity = normalize_intensity_mode(intensity or os.environ.get("INTENSITY_MODE"))
    raw_b = (backend or os.environ.get("LOCAL_BACKEND") or "mlx").strip().lower()
    eff_backend = "mlx" if raw_b == "mlx" else "llama_cpp"

    compiled_dir = data_dir / "compiled_cards"
    compiled_dir.mkdir(parents=True, exist_ok=True)

    bundles_to_compile: List[FetchedCardBundle] = []
    compiled_results: List[EngineCardModel] = []
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

        if out_path.exists() and not force:
            try:
                existing = EngineCardModel.model_validate_json(out_path.read_text(encoding="utf-8"))
                existing = sanitize_and_enrich_card(b, existing)
                out_path.write_text(
                    json.dumps(existing.model_dump(mode="json"), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                compiled_results.append(existing)
                continue
            except Exception:
                pass

        if not has_reasoning_record(b.card_id, data_dir):
            missing_reasoning.append((b.card_id, b.identity.nameFr))
        else:
            bundles_to_compile.append(b)

    out_console.print(
        Panel.fit(
            f"[bold cyan]⚡ Pipeline Two-Pass — Passe 2 / 2 : Codage JSON Formel[/bold cyan]\n"
            f"• [bold]Cartes totales[/bold] : {len(bundles)}\n"
            f"• [bold]Déjà compilées[/bold] : {len(compiled_results)} carte(s)\n"
            f"• [bold]À compiler en JSON[/bold] : {len(bundles_to_compile)} carte(s)\n"
            f"• [bold]Analyses manquantes[/bold] : {len(missing_reasoning)} carte(s)\n"
            f"• [bold]Niveau de puissance[/bold] : [bold cyan]{eff_intensity.value.upper()}[/bold cyan]\n"
            f"• [bold]Backend[/bold] : [bold green]{eff_backend}[/bold green]\n"
            f"• [bold]Dossier de sortie[/bold] : [cyan]{compiled_dir}[/cyan]",
            border_style="cyan",
        )
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

            for b in bundles_to_compile:
                reason_rec = load_reasoning_record(b.card_id, data_dir)
                reason_text = reason_rec.reasoningText if reason_rec else ""

                progress.update(
                    task_id,
                    description=f"[cyan]Codage JSON de [bold]{b.card_id}[/bold] ({b.identity.nameFr})...",
                )

                def make_token_callback(bundle=b):
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
                    out_path = compiled_dir / f"{b.card_id}.json"
                    out_path.write_text(
                        json.dumps(engine_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    compiled_results.append(engine_card)

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
                    progress.console.print(
                        f"  [green]✓[/green] [bold]{b.card_id}[/bold] ({b.identity.nameFr}) compilé en JSON en "
                        f"[yellow]{elapsed_str}[/yellow]{tok_str}{tps_str}"
                    )
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

    return {
        "total": len(bundles),
        "compiled": len(compiled_results),
        "missing_reasoning": missing_reasoning,
        "failed": failed_cards,
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
            console=out_console,
        )

    return results
