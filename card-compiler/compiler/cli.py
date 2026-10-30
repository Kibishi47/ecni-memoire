"""Interface en ligne de commande (CLI Typer + Rich) pour le compilateur de cartes Pokémon TCG.

Commandes disponibles :
- `python -m compiler.cli run` (alias `compile`) : Exécute le pipeline complet (TCGdex -> Llama GBNF -> Disque)
  avec support de `--mode test|standard`, `--test`, `--standard`, `--ids`, `--fast`, `--force`.
- `python -m compiler.cli count` : Compte le nombre de cartes déjà compilées dans `data/compiled_cards/` (options `--details` et `--quiet`).
- `python -m compiler.cli inspect <card_id>` : Affiche avec coloration syntaxique JSON et panneaux Rich
  le modèle complet généré dans `data/compiled_cards/<card_id>.json`.
- `python -m compiler.cli stats` (alias `validate`) : Vérifie l'intégrité Pydantic V2 de tous les fichiers JSON
  présents dans `data/compiled_cards/` et affiche les statistiques du corpus.
"""

from __future__ import annotations

import asyncio
import json
from collections import Counter
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, List, Optional

import typer
from pydantic import ValidationError
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
from rich.syntax import Syntax
from rich.table import Table

from compiler.llm_engine import (
    DEFAULT_MODEL_FILENAME,
    DEFAULT_MODEL_REPO_ID,
    FAST_MODEL_FILENAME,
    FAST_MODEL_REPO_ID,
    LocalLLMCardCompiler,
    ModelTier,
)
from compiler.lm_studio_compiler import LMStudioCardCompiler
from compiler.post_processor import sanitize_and_enrich_card
from compiler.schemas import CardSubCategory, EngineCardModel
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import (
    TEST_CARD_IDS,
    FetcherProvider,
    TCGdexFetcher,
)

app = typer.Typer(
    name="pokemon-tcg-compiler",
    help="Outil CLI autonome d'extraction TCGdex et de compilation de cartes Pokémon TCG via LLM local (llama.cpp Metal + GBNF).",
    add_completion=False,
    no_args_is_help=True,
)

console = Console()


class RunMode(str, Enum):
    test = "test"
    standard = "standard"


class LLMProvider(str, Enum):
    """Fournisseurs d'exécution pour le modèle LLM."""

    local = "local"
    lm_studio = "lm_studio"


def get_project_root() -> Path:
    """Retourne la racine du dossier `card-compiler/`."""
    return Path(__file__).resolve().parent.parent


def get_data_dir() -> Path:
    """Retourne le dossier `card-compiler/data/` et garantit l'existence des sous-dossiers."""
    data_dir = get_project_root() / "data"
    (data_dir / "raw_tcgdex").mkdir(parents=True, exist_ok=True)
    (data_dir / "compiled_cards").mkdir(parents=True, exist_ok=True)
    return data_dir


def rebuild_consolidated_database(
    data_dir: Path,
    active_ids: Optional[List[str]] = None,
) -> Path:
    """Regroupe les fichiers `data/compiled_cards/*.json` valides dans `data/cards_database.json`."""
    compiled_dir = data_dir / "compiled_cards"
    db_path = data_dir / "cards_database.json"

    allowed_ids = set(active_ids) if active_ids is not None else None
    cards_by_id: Dict[str, Any] = {}
    for json_file in sorted(compiled_dir.glob("*.json")):
        try:
            model = EngineCardModel.model_validate_json(json_file.read_text(encoding="utf-8"))
            if allowed_ids is not None and model.cardId not in allowed_ids:
                continue
            cards_by_id[model.cardId] = model.model_dump(mode="json")
        except Exception:
            continue

    consolidated = {
        "schemaVersion": "1.0.0",
        "updatedAtIso": datetime.now(timezone.utc).isoformat(),
        "totalCards": len(cards_by_id),
        "cards": cards_by_id,
    }
    db_path.write_text(
        json.dumps(consolidated, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return db_path


def create_compiler_engine(
    provider: LLMProvider,
    tier: ModelTier = ModelTier.qwen3,
    fast: bool = False,
    hf_token: Optional[str] = None,
    ssh_password: Optional[str] = None,
) -> Union[LocalLLMCardCompiler, LMStudioCardCompiler]:
    """Instancie le compilateur LLM selon le fournisseur sélectionné (local Metal ou LM Studio SSH/REST)."""
    if provider == LLMProvider.lm_studio:
        return LMStudioCardCompiler(tier=tier, ssh_password=ssh_password)
    return LocalLLMCardCompiler(tier=tier, fast=fast, hf_token=hf_token)


def _execute_run_pipeline(
    mode: RunMode,
    test_flag: bool,
    standard_flag: bool,
    ids: Optional[str],
    provider: FetcherProvider,
    llm_provider: LLMProvider,
    tier: ModelTier,
    fast: bool,
    force: bool,
    limit: Optional[int],
    hf_token: Optional[str] = None,
    ssh_password: Optional[str] = None,
) -> None:
    """Implémentation partagée pour les commandes `run` et `compile`."""
    effective_mode = mode.value
    if standard_flag:
        effective_mode = RunMode.standard.value
    elif test_flag:
        effective_mode = RunMode.test.value

    effective_tier = ModelTier.fast if (fast and tier == ModelTier.qwen3) else tier

    custom_ids: Optional[List[str]] = None
    if ids:
        custom_ids = [cid.strip() for cid in ids.split(",") if cid.strip()]

    data_dir = get_data_dir()
    compiled_dir = data_dir / "compiled_cards"

    mode_label = (
        f"IDs personnalisés ({len(custom_ids)})"
        if custom_ids
        else (f"Standard (limite={limit or 'toutes'})" if effective_mode == "standard" else f"Test ({len(TEST_CARD_IDS)} cartes de référence)")
    )

    if llm_provider == LLMProvider.lm_studio:
        engine_preview = LMStudioCardCompiler(tier=effective_tier, ssh_password=ssh_password)
        title_text = "[bold cyan]Pokémon TCG Card Compiler — Exécution LM Studio (Distant SSH / Local REST)[/bold cyan]"
        if engine_preview.ssh_host:
            auth_info = (
                "[green]Mot de passe (SSH_PASSWORD)[/green]"
                if engine_preview.ssh_password
                else (f"Clé privée ([cyan]{engine_preview.ssh_key_path}[/cyan])" if engine_preview.ssh_key_path else "Clé SSH standard / Agent")
            )
            llm_lines = (
                f"• [bold]Fournisseur LLM[/bold] : [bold magenta]LM Studio (Distant via SSH)[/bold magenta]\n"
                f"• [bold]Cible SSH[/bold] : [bold green]{engine_preview.ssh_target}[/bold green]\n"
                f"• [bold]Authentification[/bold] : {auth_info}\n"
                f"• [bold]Tunnel SSH[/bold] : {'Actif (port local ' + str(engine_preview.local_port) + ' -> distant ' + str(engine_preview.remote_port) + ')' if engine_preview.use_tunnel else 'Désactivé (connexion directe)'}\n"
                f"• [bold]Palier (--tier)[/bold] : [bold yellow]{effective_tier.value}[/bold yellow] — Modèle distant : [cyan]{engine_preview.model_name}[/cyan]"
            )
        else:
            llm_lines = (
                f"• [bold]Fournisseur LLM[/bold] : [bold magenta]LM Studio (Local REST)[/bold magenta]\n"
                f"• [bold]URL API[/bold] : [bold green]{engine_preview.api_base_url}[/bold green]\n"
                f"• [bold]Palier (--tier)[/bold] : [bold yellow]{effective_tier.value}[/bold yellow] — Modèle local : [cyan]{engine_preview.model_name}[/cyan]"
            )
    else:
        engine_preview = LocalLLMCardCompiler(tier=effective_tier, fast=fast, hf_token=hf_token)
        title_text = "[bold cyan]Pokémon TCG Card Compiler — Exécution Locale Apple Metal (GBNF + CoT)[/bold cyan]"
        token_status = (
            "[green]Configuré ✓ (téléchargement accéléré)[/green]"
            if engine_preview.hf_token
            else "[yellow]Non renseigné (anonyme)[/yellow]"
        )
        llm_lines = (
            f"• [bold]Fournisseur LLM[/bold] : [bold magenta]LOCAL (Apple Metal in-memory)[/bold magenta]\n"
            f"• [bold]Palier (--tier)[/bold] : [bold yellow]{effective_tier.value}[/bold yellow] — [yellow]{engine_preview.repo_id}[/yellow] ([green]{engine_preview.filename}[/green])\n"
            f"• [bold]HF Token[/bold] : {token_status}\n"
            f"• [bold]Offload GPU[/bold] : [magenta]n_gpu_layers=-1 (100% Metal)[/magenta]"
        )

    console.print(
        Panel.fit(
            f"{title_text}\n"
            f"• [bold]Mode[/bold] : {mode_label}\n"
            f"• [bold]Fournisseur TCGdex[/bold] : [bold green]{provider.value.upper()}[/bold green] (SDK Python par défaut)\n"
            f"{llm_lines}\n"
            f"• [bold]Recompilation forcée[/bold] : {'Oui' if force else 'Non (reprise sur cache activée)'}",
            border_style="cyan",
        )
    )

    fetcher = TCGdexFetcher(data_dir=data_dir, provider=provider)

    with console.status("[bold blue]Étape 1 & 2 : Récupération de l'index global TCGdex et des données brutes FR/EN...[/bold blue]"):
        bundles = asyncio.run(
            fetcher.fetch_batch(
                mode=effective_mode,
                custom_ids=custom_ids,
                force=force,
                standard_limit=limit,
            )
        )

    console.print(
        f"[green]✓[/green] {len(bundles)} carte(s) récupérée(s) et mise(s) en cache dans [bold]data/raw_tcgdex/[/bold]."
    )

    if not bundles:
        console.print("[yellow]Aucune carte à compiler.[/yellow]")
        return

    # Séparation entre cartes statiques, cartes déjà compilées (batch resume) et cartes nécessitant l'inférence LLM
    bundles_to_compile = []
    compiled_results: List[EngineCardModel] = []
    skipped_ids: set[str] = set()
    static_energy_ids: set[str] = set()

    for bundle in bundles:
        out_path = compiled_dir / f"{bundle.card_id}.json"

        # 1. Court-circuit déterministe pour les Énergies de Base (0 token, 0s, 0 hallucination)
        if is_basic_energy(bundle):
            static_model = build_basic_energy_model(bundle)
            out_path.write_text(
                json.dumps(static_model.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            compiled_results.append(static_model)
            static_energy_ids.add(bundle.card_id)
            continue

        # 2. Séparation entre cartes déjà compilées (batch resume) et cartes nécessitant l'inférence LLM
        if out_path.exists() and not force:
            try:
                existing_model = EngineCardModel.model_validate_json(out_path.read_text(encoding="utf-8"))
                existing_model = sanitize_and_enrich_card(bundle, existing_model)
                out_path.write_text(
                    json.dumps(existing_model.model_dump(mode="json"), ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                compiled_results.append(existing_model)
                skipped_ids.add(bundle.card_id)
                continue
            except Exception:
                pass
        bundles_to_compile.append(bundle)

    if static_energy_ids:
        console.print(
            f"[bold cyan]⚡ {len(static_energy_ids)} Énergie(s) de Base court-circuitée(s) instantanément (0 token, 0.00s).[/bold cyan]"
        )

    if bundles_to_compile:
        compiler_engine = create_compiler_engine(
            provider=llm_provider,
            tier=effective_tier,
            fast=fast,
            hf_token=hf_token,
            ssh_password=ssh_password,
        )
        try:
            with console.status(
                f"[bold magenta]Étape 3a : Connexion & initialisation du moteur {compiler_engine.repo_id} ({compiler_engine.filename})...[/bold magenta]"
            ):
                compiler_engine.load_model_in_memory()

            console.print(
                f"[green]✓[/green] Moteur LLM [bold]{compiler_engine.repo_id}[/bold] ([cyan]{compiler_engine.filename}[/cyan]) prêt."
            )

            failed_cards: List[Tuple[str, str, str]] = []
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                BarColumn(),
                TaskProgressColumn(),
                TimeElapsedColumn(),
                console=console,
            ) as progress:
                task_id = progress.add_task(
                    "[cyan]Compilation GBNF des cartes...",
                    total=len(bundles_to_compile),
                )
                for bundle in bundles_to_compile:
                    progress.update(
                        task_id,
                        description=f"[cyan]Compilation de [bold]{bundle.card_id}[/bold] ({bundle.identity.nameFr})...",
                    )
                    try:
                        engine_card = compiler_engine.compile_card(bundle)
                        out_path = compiled_dir / f"{bundle.card_id}.json"
                        out_path.write_text(
                            json.dumps(engine_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                        compiled_results.append(engine_card)
                    except Exception as card_err:
                        console.print(
                            f"\n[bold red]✗ Erreur lors de la compilation de {bundle.card_id} ({bundle.identity.nameFr}):[/bold red] {card_err}"
                        )
                        failed_cards.append((bundle.card_id, bundle.identity.nameFr, str(card_err)))
                    finally:
                        progress.advance(task_id)

            if failed_cards:
                console.print(
                    f"\n[bold red]⚠️ {len(failed_cards)} carte(s) ont échoué lors de la compilation :[/bold red] "
                    f"{', '.join(c[0] for c in failed_cards)}"
                )
        finally:
            compiler_engine.close()
    elif not static_energy_ids:
        console.print(
            "[green]✓[/green] Toutes les cartes cibles sont déjà compilées et valides (utilisez [bold]--force[/bold] pour recompiler)."
        )
    else:
        console.print(
            "[green]✓[/green] Inférence LLM non requise : toutes les cartes sont valides ou court-circuitées statiquement."
        )

    # Consolidation dans data/cards_database.json (filtrée sur les cartes du mode test si mode == test)
    active_ids_for_db = [b.card_id for b in bundles] if effective_mode == "test" and not custom_ids else None
    db_path = rebuild_consolidated_database(data_dir, active_ids=active_ids_for_db)
    console.print(
        f"[green]✓[/green] Base consolidée mise à jour : [bold]{db_path}[/bold]."
    )

    # Ordre d'affichage fidèle aux bundles demandés
    order_map = {b.card_id: idx for idx, b in enumerate(bundles)}
    compiled_results.sort(key=lambda c: order_map.get(c.cardId, 9999))

    # Table récapitulative Rich (ID, Nom, Rôle, Primitives générées, Conditions de Carte Morte, Temps en secondes)
    table = Table(
        title="Récapitulatif de la Compilation des Cartes Pokémon TCG",
        show_lines=True,
        header_style="bold cyan",
    )
    table.add_column("ID", style="bold yellow", no_wrap=True)
    table.add_column("Nom", style="bold white")
    table.add_column("Rôle", style="magenta")
    table.add_column("Primitives générées", style="green")
    table.add_column("Conditions de Carte Morte", style="red")
    table.add_column("Temps (s)", justify="right", style="cyan")

    for model in compiled_results:
        is_static = (
            model.cardId in static_energy_ids
            or (model.compilationMetadata and model.compilationMetadata.modelRepoId == "STATIC_DETERMINISTIC")
            or model.subCategory == CardSubCategory.BASIC_ENERGY
        )

        if is_static:
            primitives_str = "[cyan]⚡ STATIQUE (Skip LLM)[/cyan]"
            dead_str = "—"
            elapsed_s = "0.00s"
        else:
            primitives: List[str] = []
            for action in model.playableActions:
                for eff in action.effects:
                    primitives.append(eff.primitive.value)
            primitives_str = ", ".join(primitives) if primitives else "—"

            dead_reasons = [cond.reason.value for cond in model.strategicEvaluator.inGameDeadCardConditions]
            dead_str = ", ".join(dead_reasons) if dead_reasons else "—"

            elapsed_s = (
                f"{model.compilationMetadata.compilationTimeSeconds:.2f}s"
                if model.compilationMetadata
                else "—"
            )
            if model.cardId in skipped_ids:
                elapsed_s = f"{elapsed_s} (cache)"

        display_name = model.identity.nameFr
        if model.identity.nameEn and model.identity.nameEn.lower() != model.identity.nameFr.lower():
            display_name = f"{model.identity.nameFr} ({model.identity.nameEn})"

        table.add_row(
            model.cardId,
            display_name,
            model.strategicEvaluator.primaryRole.value,
            primitives_str,
            dead_str,
            elapsed_s,
        )

    console.print(table)


@app.command("run")
def run_command(
    mode: RunMode = typer.Option(
        RunMode.test,
        "--mode",
        "-m",
        help="Mode d'exécution : 'test' (11 cartes stratégiques de référence) ou 'standard' (cartes légales Standard).",
    ),
    test_flag: bool = typer.Option(
        False,
        "--test",
        help="Raccourci pour forcer le mode test (11 cartes de référence).",
    ),
    standard_flag: bool = typer.Option(
        False,
        "--standard",
        help="Raccourci pour forcer le mode standard (cartes légales au format Standard).",
    ),
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants TCGdex séparés par des virgules (ex: 'sv04-125,sv03-125').",
    ),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        help="Fournisseur d'accès aux cartes TCGdex : 'sdk' (SDK Python officiel tcgdex-sdk par défaut) ou 'rest' (API HTTP directe httpx).",
    ),
    llm_provider: LLMProvider = typer.Option(
        LLMProvider.local,
        "--llm-provider",
        "-lp",
        envvar=["LLM_PROVIDER"],
        help="Fournisseur d'inférence LLM : 'local' (Apple Metal llama.cpp local par défaut) ou 'lm_studio' (machine distante via SSH ou serveur LM Studio).",
    ),
    tier: ModelTier = typer.Option(
        ModelTier.qwen3,
        "--tier",
        "-t",
        help="Palier de modèle LLM : 'qwen3' (Qwen3-14B Q6_K par défaut), 'max' (Qwen3-30B-A3B / 32B Q4_K_M), ou 'fast' (7B Q4_K_M).",
    ),
    fast: bool = typer.Option(
        False,
        "--fast",
        help="Raccourci pour '--tier fast' (Qwen2.5-Coder-7B-Instruct-Q4_K_M).",
    ),
    force: bool = typer.Option(
        False,
        "--force",
        help="Force le re-téléchargement et la recompilation même si le fichier JSON existe déjà.",
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit",
        help="Nombre maximum de cartes à traiter en mode standard.",
    ),
    hf_token: Optional[str] = typer.Option(
        None,
        "--hf-token",
        envvar=["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"],
        help="Jeton Hugging Face (HF_TOKEN) pour accélérer le téléchargement du modèle GGUF.",
    ),
    ssh_password: Optional[str] = typer.Option(
        None,
        "--ssh-password",
        envvar=["SSH_PASSWORD"],
        help="Mot de passe SSH pour la machine distante (si connexion sans clé publique).",
    ),
    prompt_ssh_password: bool = typer.Option(
        False,
        "--prompt-ssh-password",
        help="Demande interactivement le mot de passe SSH dans le terminal de manière masquée.",
    ),
) -> None:
    """Exécute le pipeline complet d'extraction TCGdex et de compilation LLM sous contrainte GBNF."""
    if prompt_ssh_password and not ssh_password:
        import getpass

        ssh_password = getpass.getpass("Mot de passe SSH pour la machine distante : ")

    _execute_run_pipeline(
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        provider=provider,
        llm_provider=llm_provider,
        tier=tier,
        fast=fast,
        force=force,
        limit=limit,
        hf_token=hf_token,
        ssh_password=ssh_password,
    )


@app.command("compile", hidden=True)
def compile_alias(
    mode: RunMode = typer.Option(RunMode.test, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        help="Fournisseur d'accès aux cartes TCGdex : 'sdk' (SDK Python officiel tcgdex-sdk par défaut) ou 'rest' (API HTTP directe httpx).",
    ),
    llm_provider: LLMProvider = typer.Option(
        LLMProvider.local,
        "--llm-provider",
        "-lp",
        envvar=["LLM_PROVIDER"],
        help="Fournisseur d'inférence LLM : 'local' ou 'lm_studio'.",
    ),
    tier: ModelTier = typer.Option(ModelTier.qwen3, "--tier", "-t"),
    fast: bool = typer.Option(False, "--fast"),
    force: bool = typer.Option(False, "--force"),
    limit: Optional[int] = typer.Option(None, "--limit"),
    hf_token: Optional[str] = typer.Option(
        None,
        "--hf-token",
        envvar=["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"],
        help="Jeton Hugging Face (HF_TOKEN) pour accélérer le téléchargement du modèle GGUF.",
    ),
    ssh_password: Optional[str] = typer.Option(
        None,
        "--ssh-password",
        envvar=["SSH_PASSWORD"],
        help="Mot de passe SSH pour la machine distante (si connexion sans clé publique).",
    ),
    prompt_ssh_password: bool = typer.Option(
        False,
        "--prompt-ssh-password",
        help="Demande interactivement le mot de passe SSH dans le terminal.",
    ),
) -> None:
    """Alias de la commande `run`."""
    if prompt_ssh_password and not ssh_password:
        import getpass

        ssh_password = getpass.getpass("Mot de passe SSH pour la machine distante : ")

    _execute_run_pipeline(
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        provider=provider,
        llm_provider=llm_provider,
        tier=tier,
        fast=fast,
        force=force,
        limit=limit,
        hf_token=hf_token,
        ssh_password=ssh_password,
    )


@app.command("inspect")
def inspect_command(
    card_id: str = typer.Argument(..., help="Identifiant de la carte à inspecter (ex: sv04-125, sv03-125)."),
) -> None:
    """Affiche avec coloration syntaxique JSON le modèle complet généré dans `data/compiled_cards/<card_id>.json`."""
    data_dir = get_data_dir()
    file_path = data_dir / "compiled_cards" / f"{card_id.strip()}.json"

    if not file_path.exists():
        console.print(
            f"[bold red]Erreur :[/bold red] Le fichier [bold]{file_path}[/bold] n'existe pas.\n"
            f"Lancez d'abord : [cyan]python -m compiler.cli run --ids {card_id}[/cyan]"
        )
        raise typer.Exit(code=1)

    raw_json_str = file_path.read_text(encoding="utf-8")
    try:
        model = EngineCardModel.model_validate_json(raw_json_str)
    except ValidationError as exc:
        console.print(f"[bold red]Validation Pydantic échouée pour {file_path} :[/bold red]\n{exc}")
        raise typer.Exit(code=1)

    evo_line = ""
    if model.pokemonStats:
        chain_str = " ➔ ".join(model.pokemonStats.evolutionChain)
        evo_line = (
            f"\n• [bold]PV / Types[/bold] : {model.pokemonStats.hp} PV | {', '.join(model.pokemonStats.types)}"
            f"\n• [bold]Lignée d'évolution[/bold] : {chain_str} (Base racine : [green]{model.pokemonStats.rootBasicName}[/green])"
        )

    console.print(
        Panel.fit(
            f"[bold yellow]{model.cardId}[/bold yellow] — [bold white]{model.identity.nameFr}[/bold white] "
            f"({model.identity.nameEn or 'N/A'})\n"
            f"• [bold]Catégorie[/bold] : {model.category.value} / {model.subCategory.value}\n"
            f"• [bold]Rôle Stratégique[/bold] : [magenta]{model.strategicEvaluator.primaryRole.value}[/magenta] "
            f"(Score intrinsèque : {model.strategicEvaluator.intrinsicBaseScore}/100)"
            f"{evo_line}",
            title="Inspection du Modèle de Carte",
            border_style="green",
        )
    )

    formatted_json = json.dumps(model.model_dump(mode="json"), ensure_ascii=False, indent=2)
    syntax = Syntax(formatted_json, "json", theme="monokai", line_numbers=True, word_wrap=True)
    console.print(syntax)


def _execute_stats_validation() -> None:
    """Vérifie l'intégrité Pydantic de tous les fichiers JSON dans `data/compiled_cards/`."""
    data_dir = get_data_dir()
    compiled_dir = data_dir / "compiled_cards"
    json_files = sorted(compiled_dir.glob("*.json"))

    if not json_files:
        console.print(
            f"[yellow]Aucun fichier JSON trouvé dans {compiled_dir}.[/yellow]\n"
            "Lancez [cyan]python -m compiler.cli run --mode test[/cyan] pour générer les modèles."
        )
        raise typer.Exit(code=0)

    valid_models: List[EngineCardModel] = []
    invalid_files: List[tuple[Path, str]] = []

    for fpath in json_files:
        try:
            model = EngineCardModel.model_validate_json(fpath.read_text(encoding="utf-8"))
            valid_models.append(model)
        except Exception as exc:
            invalid_files.append((fpath, str(exc)))

    summary_table = Table(
        title="Vérification d'Intégrité Pydantic V2 (`data/compiled_cards/`)",
        header_style="bold cyan",
        show_lines=True,
    )
    summary_table.add_column("ID", style="bold yellow")
    summary_table.add_column("Nom", style="white")
    summary_table.add_column("Catégorie / Sous-catégorie", style="cyan")
    summary_table.add_column("Rôle Stratégique", style="magenta")
    summary_table.add_column("Actions", justify="right", style="green")
    summary_table.add_column("Synergies", justify="right", style="blue")
    summary_table.add_column("Dead Conditions", justify="right", style="red")
    summary_table.add_column("Statut Pydantic", justify="center")

    for m in valid_models:
        summary_table.add_row(
            m.cardId,
            m.identity.nameFr,
            f"{m.category.value} / {m.subCategory.value}",
            m.strategicEvaluator.primaryRole.value,
            str(len(m.playableActions)),
            str(len(m.strategicEvaluator.decklistSynergyRequirements)),
            str(len(m.strategicEvaluator.inGameDeadCardConditions)),
            "[bold green]VALIDE ✓[/bold green]",
        )

    for bad_path, err_msg in invalid_files:
        summary_table.add_row(
            bad_path.stem,
            bad_path.name,
            "—",
            "—",
            "—",
            "—",
            "—",
            f"[bold red]INVALIDE ✗[/bold red]\n{err_msg[:120]}",
        )

    console.print(summary_table)

    cat_counts = Counter(m.category.value for m in valid_models)
    role_counts = Counter(m.strategicEvaluator.primaryRole.value for m in valid_models)

    console.print(
        Panel.fit(
            f"• [bold]Total de fichiers inspectés[/bold] : {len(json_files)}\n"
            f"• [bold green]Modèles Pydantic V2 valides[/bold green] : {len(valid_models)}\n"
            f"• [bold red]Modèles invalides[/bold red] : {len(invalid_files)}\n"
            f"• [bold]Répartition par catégorie[/bold] : {dict(cat_counts)}\n"
            f"• [bold]Répartition par rôle[/bold] : {dict(role_counts)}",
            title="Statistiques Globales du Corpus",
            border_style="green" if not invalid_files else "red",
        )
    )

    if invalid_files:
        raise typer.Exit(code=1)


@app.command("count")
def count_command(
    quiet: bool = typer.Option(
        False,
        "--quiet",
        "-q",
        help="Affiche uniquement le nombre entier de cartes compilées (idéal pour les scripts bash).",
    ),
    details: bool = typer.Option(
        False,
        "--details",
        "-d",
        help="Affiche la liste détaillée des cartes compilées avec leurs noms et catégories.",
    ),
) -> None:
    """Compte et résume le nombre de cartes Pokémon déjà compilées dans `data/compiled_cards/`."""
    data_dir = get_data_dir()
    compiled_dir = data_dir / "compiled_cards"
    json_files = sorted(compiled_dir.glob("*.json"))
    total_count = len(json_files)

    if quiet:
        console.print(str(total_count))
        return

    if total_count == 0:
        console.print(
            f"[yellow]Aucune carte compilée trouvée dans [bold]{compiled_dir}[/bold] (0 carte).[/yellow]\n"
            "Pour lancer la compilation, exécutez : [cyan]python -m compiler.cli run --mode test[/cyan]"
        )
        return

    categories_counter: Counter[str] = Counter()
    cards_summary: List[Dict[str, str]] = []

    for fpath in json_files:
        card_id = fpath.stem
        card_name = "Inconnu"
        category = "Inconnu"
        sub_category = ""
        model_name = ""
        try:
            with open(fpath, "r", encoding="utf-8") as jf:
                data = json.load(jf)
                identity = data.get("identity") or {}
                card_name = identity.get("nameFr") or identity.get("nameEn") or card_id
                category = data.get("category", "Inconnu")
                sub_category = data.get("subCategory", "")
                meta = data.get("compilationMetadata") or {}
                model_name = meta.get("modelFilename") or meta.get("modelRepoId") or ""
        except Exception:
            pass

        categories_counter[category] += 1
        cards_summary.append({
            "id": card_id,
            "name": card_name,
            "category": f"{category} / {sub_category}" if sub_category else category,
            "model": model_name,
        })

    db_path = data_dir / "cards_database.json"
    db_count = 0
    if db_path.exists():
        try:
            with open(db_path, "r", encoding="utf-8") as df:
                db_data = json.load(df)
                if isinstance(db_data, dict):
                    db_count = len(db_data.get("cards", {}))
                elif isinstance(db_data, list):
                    db_count = len(db_data)
        except Exception:
            pass

    repartition_str = ", ".join(f"[bold cyan]{cnt}[/bold cyan] {cat}" for cat, cnt in categories_counter.items())
    db_line = f"\n• [bold]Base consolidée ([cyan]cards_database.json[/cyan])[/bold] : {db_count} carte(s)" if db_path.exists() else ""

    console.print(
        Panel.fit(
            f"• [bold]Cartes compilées sur le disque[/bold] : [bold green]{total_count}[/bold green]\n"
            f"• [bold]Dossier de stockage[/bold] : [cyan]{compiled_dir}[/cyan]\n"
            f"• [bold]Répartition par catégorie[/bold] : {repartition_str}"
            f"{db_line}",
            title="[bold green]Corpus de Cartes Compilées[/bold green]",
            border_style="green",
        )
    )

    if details:
        table = Table(
            title=f"Détail des {total_count} Cartes Compilées",
            header_style="bold cyan",
            show_lines=False,
        )
        table.add_column("ID", style="bold yellow")
        table.add_column("Nom", style="white")
        table.add_column("Catégorie", style="cyan")
        table.add_column("Généré par", style="magenta")

        for c in cards_summary:
            table.add_row(c["id"], c["name"], c["category"], c["model"] or "—")

        console.print(table)


@app.command("stats")
def stats_command() -> None:
    """Vérifie l'intégrité Pydantic de tous les fichiers JSON générés dans `data/compiled_cards/`."""
    _execute_stats_validation()


@app.command("validate", hidden=True)
def validate_alias() -> None:
    """Alias de la commande `stats`."""
    _execute_stats_validation()


if __name__ == "__main__":
    app()
