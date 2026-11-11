"""Interface en ligne de commande (CLI Typer + Rich) pour le compilateur de cartes Pokémon TCG.

Commandes disponibles :
- `python -m compiler.cli run` (alias `compile`) : Exécute le pipeline complet (TCGdex -> Llama GBNF -> Disque)
  avec support de `--mode test|standard`, `--test`, `--standard`, `--ids`, `--fast`, `--force`.
- `python -m compiler.cli code` : Exécute la Passe 2 (Codage JSON formel) dans `data/compiled_cards/`.
- `python -m compiler.cli re-run` (alias `rerun`, `redo`, `recompile`, `reexecute`) : Réexécute une phase (`--phase all|reason|code`) sur les cartes des dossiers cibles ou une sélection ciblée (`--ids`, `--ids-file`, `--set`, `--mode`), avec récupération automatique depuis TCGdex pour tout ID manquant.
- `python -m compiler.cli count` : Compte le nombre de cartes déjà compilées dans `data/compiled_cards/` (options `--details` et `--quiet`).
- `python -m compiler.cli remaining` (alias `todo`, `left`, `pending`, `a-compiler`) : Affiche le nombre de cartes restant à compiler (globalement, par extension via `--set`, avec progression et options `--details` et `--quiet`).
- `python -m compiler.cli sync` (alias `sync-database`, `sync-db`, `check-database`) : Vérifie que toutes les cartes compilées sont présentes dans `data/cards_database.json` et ajoute automatiquement les cartes manquantes.
- `python -m compiler.cli inspect <card_id>` : Affiche avec coloration syntaxique JSON et panneaux Rich
  le modèle complet généré dans `data/compiled_cards/<card_id>.json`.
- `python -m compiler.cli stats` (alias `validate`) : Vérifie l'intégrité Pydantic V2 de tous les fichiers JSON
  présents dans `data/compiled_cards/` et affiche les statistiques du corpus.
"""

from __future__ import annotations

import asyncio
import concurrent.futures
import json
import queue
import threading
from collections import Counter
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

import httpx
import typer
from pydantic import ValidationError
from rich.console import Console
from rich.panel import Panel
from rich.progress import (
    BarColumn,
    MofNCompleteColumn,
    Progress,
    SpinnerColumn,
    TaskProgressColumn,
    TextColumn,
    TimeElapsedColumn,
    TimeRemainingColumn,
)
from rich.syntax import Syntax
from rich.table import Table
from rich.text import Text

from compiler.llm_engine import (
    DEFAULT_MODEL_FILENAME,
    DEFAULT_MODEL_REPO_ID,
    FAST_MODEL_FILENAME,
    FAST_MODEL_REPO_ID,
    LocalLLMCardCompiler,
    ModelTier,
)
from compiler.lm_studio_compiler import LMStudioCardCompiler
from compiler.mlx_engine import MLXCardCompiler
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
    normalize_intensity_mode,
    normalize_pipeline_mode,
    normalize_pipeline_phase,
    resolve_model_for_configuration,
)
from compiler.post_processor import repair_compiled_corpus, sanitize_and_enrich_card
from compiler.reasoning_engine import (
    ReasoningRecord,
    get_reasoning_texts_dir,
    has_reasoning_record,
    load_reasoning_record,
)
from compiler.schemas import CardSubCategory, EngineCardModel
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import (
    TEST_CARD_IDS,
    FetchedCardBundle,
    FetcherProvider,
    TCGdexFetcher,
)
from compiler.two_pass_pipeline import (
    run_coding_phase,
    run_reasoning_phase,
    run_two_pass_pipeline,
)


class ConditionalBarColumn(BarColumn):
    """BarColumn conditionnelle qui n'affiche une barre de progression que si le total est défini."""

    def render(self, task: Any) -> Any:
        if task.total is None:
            return Text("")
        return super().render(task)

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


SV_SET_NAMES: Dict[str, str] = {
    "sv01": "Écarlate et Violet",
    "sv02": "Évolutions à Paldéa",
    "sv03": "Flammes Obsidiennes",
    "sv03.5": "151",
    "sv04": "Faille Paradoxe",
    "sv04.5": "Destinées de Paldéa",
    "sv05": "Forces Temporelles",
    "sv06": "Mascarade Crépusculaire",
    "sv06.5": "Fable Nébuleuse",
    "sv07": "Couronne Stellaire",
    "sv08": "Étincelles Déferlantes",
    "sv08.5": "Évolutions Prismatiques",
    "sv09": "Voyage Éclair",
    "sv10": "Destin Éternel",
    "sv10.5b": "Forces Noires (SV10.5)",
    "sv10.5w": "Forces Blanches (SV10.5)",
    "sve": "Énergies de Base SV",
    "svp": "Promos Écarlate et Violet",
    "me01": "Méga-Évolution 1",
    "me02": "Méga-Évolution 2",
    "me02.5": "Méga-Évolution 2.5",
    "me03": "Méga-Évolution 3",
    "me04": "Méga-Évolution 4",
    "me05": "Méga-Évolution 5",
    "mee": "Énergies Spéciales ME",
    "mep": "Promos Méga-Évolution",
    "30th": "30e Anniversaire",
    "tk": "Kit du Dresseur",
}


def load_ids_from_file(file_path: Union[str, Path]) -> List[str]:
    """Charge une liste d'identifiants depuis un fichier texte (un ID par ligne ou séparés par des virgules).

    - Ignore les lignes vides et les commentaires (#).
    - Préserve l'ordre sans dédupliquer à ce niveau.
    - Cherche le fichier au chemin fourni, puis relativement à la racine du projet ou à `data/`.
    - Lève une FileNotFoundError claire si le fichier est introuvable.
    """
    raw_path = Path(file_path)
    candidate_paths = [
        raw_path,
        get_project_root() / raw_path,
        get_data_dir() / raw_path,
        Path.cwd() / raw_path,
    ]
    target_file: Optional[Path] = None
    for cp in candidate_paths:
        if cp.is_file():
            target_file = cp
            break

    if target_file is None:
        raise FileNotFoundError(f"Le fichier d'identifiants de cartes n'existe pas : {file_path}")

    raw_text = target_file.read_text(encoding="utf-8")
    ids: List[str] = []
    for line in raw_text.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        parts = [p.strip() for p in line.replace(",", " ").split() if p.strip()]
        ids.extend(parts)
    return ids


def resolve_card_ids(
    ids: Optional[str] = None,
    ids_file: Optional[Union[str, Path]] = None,
) -> Optional[List[str]]:
    """Résout et déduplique automatiquement les identifiants de cartes fournis via chaîne ou fichier.

    - Supporte --ids "id1,id2,id3"
    - Supporte --ids-file path/to/file.txt (ou -f)
    - Supporte --ids "@path/to/file.txt" ou un chemin de fichier passé directement dans --ids
    - Déduplique automatiquement en conservant le premier ordre d'apparition (`dict.fromkeys`).
    - Retourne None si aucun identifiant n'est spécifié.
    """
    collected: List[str] = []

    if ids_file:
        collected.extend(load_ids_from_file(ids_file))

    if ids:
        ids_clean = ids.strip()
        if ids_clean.startswith("@"):
            collected.extend(load_ids_from_file(ids_clean[1:]))
        else:
            is_file = False
            for test_p in [Path(ids_clean), get_project_root() / ids_clean, get_data_dir() / ids_clean]:
                if test_p.is_file():
                    is_file = True
                    collected.extend(load_ids_from_file(test_p))
                    break
            if not is_file:
                for part in ids_clean.split(","):
                    p = part.strip()
                    if p:
                        collected.append(p)

    if not collected:
        return None

    return list(dict.fromkeys(collected))


def get_remaining_cards_summary(
    data_dir: Path,
    mode: str = "standard",
    set_filter: Optional[str] = None,
    provider: FetcherProvider = FetcherProvider.sdk,
    reasoned: bool = False,
    custom_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Calcule le statut et le nombre de cartes restant à compiler ou à raisonner.

    Retourne un dictionnaire contenant les statistiques globales et par extension :
    - mode : 'standard', 'test', 'all', ou 'custom'
    - set_filter : préfixe de set filtré (si spécifié)
    - reasoned : True si l'on inspecte data/reasoning_texts/ (Passe 1), False pour data/compiled_cards/ (Passe 2)
    - total_target : nombre total de cartes visées
    - total_compiled : nombre de cartes cibles déjà traitées (conservé pour rétrocompatibilité)
    - total_done : nombre de cartes cibles déjà traitées
    - total_remaining : nombre de cartes restant à traiter
    - progress_pct : pourcentage d'avancement
    - remaining_ids : liste des identifiants des cartes non traitées
    - by_set : statistiques groupées par extension
    - total_disk_compiled : total absolu de fichiers sur le disque (conservé pour rétrocompatibilité)
    - total_disk_done : total absolu de fichiers sur le disque
    """
    if reasoned:
        target_dir = get_reasoning_texts_dir(data_dir)
    else:
        target_dir = data_dir / "compiled_cards"
    target_dir.mkdir(parents=True, exist_ok=True)
    done_ids = set(f.stem for f in target_dir.glob("*.json"))

    fetcher = TCGdexFetcher(data_dir=data_dir, provider=provider)

    effective_mode = mode.lower().strip()
    target_ids: List[str] = []

    if custom_ids is not None:
        target_ids = list(dict.fromkeys(cid.strip() for cid in custom_ids if cid.strip()))
        effective_mode = "custom"
    elif effective_mode == "test":
        target_ids = list(TEST_CARD_IDS)
    elif effective_mode == "all":
        index_path = data_dir / "raw_tcgdex" / "_cards_index.json"
        if index_path.exists():
            try:
                cached_idx = json.loads(index_path.read_text(encoding="utf-8"))
                target_ids = [
                    str(c.get("id")).strip()
                    for c in cached_idx
                    if isinstance(c, dict) and c.get("id")
                ]
            except Exception:
                target_ids = []
        if not target_ids:
            async def _fetch_all():
                async with httpx.AsyncClient() as client:
                    idx = await fetcher.fetch_cards_index(client, force=False)
                    return [str(c.get("id")).strip() for c in idx if isinstance(c, dict) and c.get("id")]
            target_ids = asyncio.run(_fetch_all())
    else:
        # Mode standard par défaut : vérifie d'abord le cache local _cards_standard_index.json
        std_index_path = data_dir / "raw_tcgdex" / "_cards_standard_index.json"
        if std_index_path.exists():
            try:
                cached_std = json.loads(std_index_path.read_text(encoding="utf-8"))
                target_ids = [
                    str(c.get("id")).strip()
                    for c in cached_std
                    if isinstance(c, dict) and c.get("id")
                ]
            except Exception:
                target_ids = []
        if not target_ids:
            async def _resolve_std():
                async with httpx.AsyncClient() as client:
                    return await fetcher.resolve_standard_card_ids(client)
            target_ids = asyncio.run(_resolve_std())

    # Application du filtre par extension / set
    if set_filter:
        s_clean = set_filter.strip().lower()
        target_ids = [
            cid for cid in target_ids
            if cid.lower().startswith(f"{s_clean}-") or cid.lower() == s_clean
        ]

    # Analyse des cartes traitées vs restantes
    done_target = [cid for cid in target_ids if cid in done_ids]
    remaining_ids = [cid for cid in target_ids if cid not in done_ids]

    total_target = len(target_ids)
    total_done = len(done_target)
    total_remaining = len(remaining_ids)
    progress_pct = (total_done / total_target * 100.0) if total_target > 0 else 100.0

    # Ventilation par extension
    by_set: Dict[str, Dict[str, Any]] = {}
    for cid in target_ids:
        prefix = cid.split("-")[0].lower() if "-" in cid else "autres"
        if prefix not in by_set:
            by_set[prefix] = {
                "set_code": prefix,
                "set_name": SV_SET_NAMES.get(prefix, prefix.upper()),
                "total": 0,
                "compiled": 0,
                "done": 0,
                "remaining": 0,
                "remaining_ids": [],
            }
        by_set[prefix]["total"] += 1
        if cid in done_ids:
            by_set[prefix]["compiled"] += 1
            by_set[prefix]["done"] += 1
        else:
            by_set[prefix]["remaining"] += 1
            by_set[prefix]["remaining_ids"].append(cid)

    for s_info in by_set.values():
        t = s_info["total"]
        c = s_info["done"]
        s_info["progress_pct"] = (c / t * 100.0) if t > 0 else 100.0

    return {
        "mode": effective_mode,
        "set_filter": set_filter,
        "reasoned": reasoned,
        "total_target": total_target,
        "total_compiled": total_done,
        "total_done": total_done,
        "total_remaining": total_remaining,
        "progress_pct": progress_pct,
        "remaining_ids": remaining_ids,
        "by_set": by_set,
        "total_disk_compiled": len(done_ids),
        "total_disk_done": len(done_ids),
    }


def sync_cards_database(
    data_dir: Path,
    db_path: Optional[Path] = None,
    dry_run: bool = False,
    force_update: bool = False,
    target_card_ids: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """Vérifie que tous les fichiers valides de `data/compiled_cards/*.json` sont inclus dans le fichier JSON global (`cards_database.json`).

    Si une carte est manquante, elle est automatiquement ajoutée au fichier JSON en préservant son format (liste ou dictionnaire).

    Retourne un dictionnaire résumant l'opération :
    - db_path : Chemin vers le fichier JSON consolidé
    - total_disk_cards : Nombre total de cartes compilées trouvées sur le disque
    - initial_db_cards : Nombre initial de cartes dans le fichier JSON
    - added_card_ids : Liste des IDs de cartes ajoutées
    - updated_card_ids : Liste des IDs de cartes mises à jour (si force_update)
    - missing_on_disk_ids : Liste des IDs présents dans le JSON mais absents du disque
    - corrupted_files : Liste des fichiers illisibles/invalides
    - db_format : 'list' ou 'dict_cards_dict' ou 'dict_cards_list' ou 'dict_raw'
    - disk_cards : Dictionnaire card_id -> card_dict
    """
    target_db = db_path or (data_dir / "cards_database.json")
    compiled_dir = data_dir / "compiled_cards"
    compiled_dir.mkdir(parents=True, exist_ok=True)

    disk_cards: Dict[str, Dict[str, Any]] = {}
    corrupted_files: List[tuple[str, str]] = []

    for fpath in sorted(compiled_dir.glob("*.json")):
        try:
            content = fpath.read_text(encoding="utf-8")
            card_json = json.loads(content)
            card_id = (
                card_json.get("cardId")
                or (card_json.get("identity") or {}).get("cardId")
                or fpath.stem
            )
            disk_cards[card_id] = card_json
        except Exception as e:
            corrupted_files.append((fpath.name, str(e)))

    if target_card_ids is not None:
        target_set = set(target_card_ids)
        disk_cards = {k: v for k, v in disk_cards.items() if k in target_set}

    db_data: Any = None
    db_format = "list"
    existing_ids: set[str] = set()
    id_to_list_index: Dict[str, int] = {}

    if target_db.exists() and target_db.stat().st_size > 0:
        try:
            db_data = json.loads(target_db.read_text(encoding="utf-8"))
        except Exception as e:
            raise ValueError(f"Impossible de parser le fichier JSON global {target_db} : {e}")

        if isinstance(db_data, list):
            db_format = "list"
            for idx, item in enumerate(db_data):
                if isinstance(item, dict):
                    cid = item.get("cardId") or (item.get("identity") or {}).get("cardId")
                    if cid:
                        existing_ids.add(cid)
                        id_to_list_index[cid] = idx
        elif isinstance(db_data, dict):
            if "cards" in db_data:
                if isinstance(db_data["cards"], dict):
                    db_format = "dict_cards_dict"
                    existing_ids = set(db_data["cards"].keys())
                elif isinstance(db_data["cards"], list):
                    db_format = "dict_cards_list"
                    for idx, item in enumerate(db_data["cards"]):
                        if isinstance(item, dict):
                            cid = item.get("cardId") or (item.get("identity") or {}).get("cardId")
                            if cid:
                                existing_ids.add(cid)
                                id_to_list_index[cid] = idx
                else:
                    db_format = "dict_raw"
                    existing_ids = set(db_data.keys())
            else:
                db_format = "dict_raw"
                existing_ids = set(db_data.keys())
    else:
        db_data = []
        db_format = "list"

    added_ids: List[str] = []
    updated_ids: List[str] = []

    for card_id in sorted(disk_cards.keys()):
        if card_id not in existing_ids:
            added_ids.append(card_id)
        elif force_update:
            updated_ids.append(card_id)

    if target_card_ids is not None:
        missing_on_disk_ids = sorted(list((existing_ids & set(target_card_ids)) - set(disk_cards.keys())))
    else:
        missing_on_disk_ids = sorted(list(existing_ids - set(disk_cards.keys())))

    if not dry_run and (added_ids or updated_ids or not target_db.exists()):
        if db_format == "list":
            for cid in added_ids:
                db_data.append(disk_cards[cid])
            if force_update:
                for cid in updated_ids:
                    idx = id_to_list_index.get(cid)
                    if idx is not None:
                        db_data[idx] = disk_cards[cid]
            db_data.sort(key=lambda c: c.get("cardId") or (c.get("identity") or {}).get("cardId") or "")

        elif db_format == "dict_cards_dict":
            for cid in added_ids:
                db_data["cards"][cid] = disk_cards[cid]
            if force_update:
                for cid in updated_ids:
                    db_data["cards"][cid] = disk_cards[cid]
            db_data["cards"] = dict(sorted(db_data["cards"].items()))
            db_data["totalCards"] = len(db_data["cards"])
            db_data["updatedAtIso"] = datetime.now(timezone.utc).isoformat()

        elif db_format == "dict_cards_list":
            for cid in added_ids:
                db_data["cards"].append(disk_cards[cid])
            if force_update:
                for cid in updated_ids:
                    idx = id_to_list_index.get(cid)
                    if idx is not None:
                        db_data["cards"][idx] = disk_cards[cid]
            db_data["cards"].sort(key=lambda c: c.get("cardId") or "")
            db_data["totalCards"] = len(db_data["cards"])
            db_data["updatedAtIso"] = datetime.now(timezone.utc).isoformat()

        elif db_format == "dict_raw":
            for cid in added_ids:
                db_data[cid] = disk_cards[cid]
            if force_update:
                for cid in updated_ids:
                    db_data[cid] = disk_cards[cid]
            db_data = dict(sorted(db_data.items()))

        target_db.parent.mkdir(parents=True, exist_ok=True)
        target_db.write_text(
            json.dumps(db_data, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return {
        "db_path": target_db,
        "total_disk_cards": len(disk_cards),
        "initial_db_cards": len(existing_ids),
        "added_card_ids": added_ids,
        "updated_card_ids": updated_ids,
        "missing_on_disk_ids": missing_on_disk_ids,
        "corrupted_files": corrupted_files,
        "db_format": db_format,
        "disk_cards": disk_cards,
    }


def rebuild_consolidated_database(
    data_dir: Path,
    active_ids: Optional[List[str]] = None,
) -> Path:
    """Regroupe les fichiers `data/compiled_cards/*.json` valides dans `data/cards_database.json`."""
    db_path = data_dir / "cards_database.json"
    if active_ids is None:
        sync_cards_database(data_dir=data_dir, db_path=db_path)
        return db_path

    compiled_dir = data_dir / "compiled_cards"
    allowed_ids = set(active_ids)
    cards_by_id: Dict[str, Any] = {}
    for json_file in sorted(compiled_dir.glob("*.json")):
        try:
            model = EngineCardModel.model_validate_json(json_file.read_text(encoding="utf-8"))
            if model.cardId not in allowed_ids:
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
    disable_thinking: bool = False,
    thinking: Optional[str] = None,
    model: Optional[str] = None,
    local_backend: Optional[str] = None,
    pipeline_mode: Optional[Union[PipelineMode, str]] = None,
    intensity: Optional[Union[IntensityMode, str]] = None,
    phase: Optional[Union[PipelinePhase, str]] = None,
) -> Union[LocalLLMCardCompiler, LMStudioCardCompiler, MLXCardCompiler]:
    """Instancie le compilateur LLM selon le fournisseur sélectionné (local Metal GGUF, local MLX ou LM Studio REST)."""
    if provider == LLMProvider.lm_studio:
        return LMStudioCardCompiler(
            tier=tier,
            model_name=model,
            disable_thinking=disable_thinking,
            thinking=thinking,
        )

    import os

    resolved_backend = (
        local_backend
        or os.environ.get("LOCAL_BACKEND")
        or os.environ.get("LOCAL_OPTIMIZATION")
        or "mlx"
    ).strip().lower()

    if model and (".gguf" in str(model).lower() or ":" in str(model)):
        if not local_backend or local_backend != "mlx":
            resolved_backend = "llama_cpp"

    if resolved_backend == "mlx":
        return MLXCardCompiler(
            model=model,
            intensity=intensity,
            phase=phase,
            pipeline_mode=pipeline_mode,
            hf_token=hf_token,
            disable_thinking=disable_thinking,
            thinking=thinking,
        )

    return LocalLLMCardCompiler(
        tier=tier,
        fast=fast,
        model=model,
        hf_token=hf_token,
        disable_thinking=disable_thinking,
        thinking=thinking,
    )


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
    disable_thinking: bool = False,
    thinking: Optional[str] = None,
    parallel: int = 1,
    continue_on_error: bool = False,
    model: Optional[str] = None,
    local_backend: Optional[str] = None,
    pipeline: Optional[str] = None,
    intensity: Optional[str] = None,
    phase: Optional[str] = None,
    ids_file: Optional[Path] = None,
) -> None:
    """Implémentation partagée pour les commandes `run` et `compile`."""
    effective_mode = mode.value
    if standard_flag:
        effective_mode = RunMode.standard.value
    elif test_flag:
        effective_mode = RunMode.test.value

    effective_tier = ModelTier.fast if (fast and tier == ModelTier.qwen3) else tier

    import os
    effective_backend = (
        local_backend
        or os.environ.get("LOCAL_BACKEND")
        or os.environ.get("LOCAL_OPTIMIZATION")
        or "mlx"
    ).strip().lower()

    eff_pipeline = normalize_pipeline_mode(pipeline or os.environ.get("PIPELINE_MODE"))
    eff_intensity = normalize_intensity_mode(intensity or os.environ.get("INTENSITY_MODE"))
    eff_phase = normalize_pipeline_phase(phase or os.environ.get("PIPELINE_PHASE"))

    # Validation et préparation du parallélisme
    requested_parallel = max(1, parallel)
    effective_parallel = requested_parallel
    if requested_parallel > 1 and llm_provider == LLMProvider.local:
        console.print(
            "[yellow]⚠️ La parallélisation (--parallel > 1) n'est pas supportée avec le moteur 'local' "
            "(Apple Metal / MLX in-memory KV-cache partagé). L'exécution se poursuit en mode séquentiel (parallel=1). "
            "Utilisez '--llm-provider lm_studio' pour la parallélisation multi-slots.[/yellow]"
        )
        effective_parallel = 1

    parallel_display = (
        f"{requested_parallel} slots en parallèle"
        if requested_parallel > 1
        else "1 (séquentiel)"
    )

    custom_ids: Optional[List[str]] = resolve_card_ids(ids=ids, ids_file=ids_file)

    data_dir = get_data_dir()
    compiled_dir = data_dir / "compiled_cards"

    mode_label = (
        f"IDs personnalisés ({len(custom_ids)} carte(s) unique(s))"
        if custom_ids
        else (f"Standard (limite={limit or 'toutes'})" if effective_mode == "standard" else f"Test ({len(TEST_CARD_IDS)} cartes de référence)")
    )

    if llm_provider == LLMProvider.lm_studio:
        engine_preview = LMStudioCardCompiler(
            tier=effective_tier,
            model_name=model,
            disable_thinking=disable_thinking,
            thinking=thinking,
        )
        title_text = "[bold cyan]Pokémon TCG Card Compiler — Exécution LM Studio (API REST)[/bold cyan]"
        model_display = engine_preview.model_name or "Auto-détection (modèle actuellement actif sur le serveur)"
        if engine_preview.disable_thinking or getattr(engine_preview, "thinking", None) == "null":
            thinking_display = "[yellow]Désactivé (null / --no-think)[/yellow]"
        elif getattr(engine_preview, "thinking", None) is not None:
            thinking_display = f"[green]Activé (niveau: [bold cyan]{engine_preview.thinking}[/bold cyan])[/green]"
        else:
            thinking_display = "[green]Activé / Standard[/green]"
        conn_type = f"Distant ({engine_preview.remote_host})" if engine_preview.remote_host and engine_preview.remote_host not in {"127.0.0.1", "localhost"} else "Local"
        llm_lines = (
            f"• [bold]Fournisseur LLM[/bold] : [bold magenta]LM Studio ({conn_type} REST direct)[/bold magenta]\n"
            f"• [bold]URL API[/bold] : [bold green]{engine_preview.api_base_url}[/bold green]\n"
            f"• [bold]Modèle[/bold] : [cyan]{model_display}[/cyan]\n"
            f"• [bold]Mode Thinking[/bold] : {thinking_display}\n"
            f"• [bold]Slots parallèles[/bold] : [bold cyan]{parallel_display}[/bold cyan]"
        )
    elif effective_backend == "mlx":
        engine_preview = MLXCardCompiler(
            model=model,
            hf_token=hf_token,
            disable_thinking=disable_thinking,
            thinking=thinking,
        )
        title_text = "[bold cyan]Pokémon TCG Card Compiler — Exécution Locale Apple MLX Native (CoT)[/bold cyan]"
        token_status = (
            "[green]Configuré ✓ (téléchargement accéléré)[/green]"
            if engine_preview.hf_token
            else "[yellow]Non renseigné (anonyme)[/yellow]"
        )
        if engine_preview.disable_thinking or getattr(engine_preview, "thinking", None) == "null":
            thinking_display = "[yellow]Désactivé (null / --no-think)[/yellow]"
        elif getattr(engine_preview, "thinking", None) is not None:
            thinking_display = f"[green]Activé (niveau: [bold cyan]{engine_preview.thinking}[/bold cyan])[/green]"
        else:
            thinking_display = "[green]Activé / Standard[/green]"

        model_disp = f"[bold green]{engine_preview.repo_id}[/bold green]"
        llm_lines = (
            f"• [bold]Fournisseur LLM[/bold] : [bold magenta]LOCAL (Apple Silicon MLX Native)[/bold magenta]\n"
            f"• [bold]Optimisation locale[/bold] : [cyan]mlx (Apple Silicon Unified Memory Safetensors)[/cyan]\n"
            f"• [bold]Modèle[/bold] : {model_disp}\n"
            f"• [bold]HF Token[/bold] : {token_status}\n"
            f"• [bold]Mode Thinking[/bold] : {thinking_display}"
        )
    else:
        engine_preview = LocalLLMCardCompiler(
            tier=effective_tier,
            fast=fast,
            model=model,
            hf_token=hf_token,
            disable_thinking=disable_thinking,
            thinking=thinking,
        )
        title_text = "[bold cyan]Pokémon TCG Card Compiler — Exécution Locale Apple Metal (GBNF + CoT)[/bold cyan]"
        token_status = (
            "[green]Configuré ✓ (téléchargement accéléré)[/green]"
            if engine_preview.hf_token
            else "[yellow]Non renseigné (anonyme)[/yellow]"
        )
        if engine_preview.disable_thinking or getattr(engine_preview, "thinking", None) == "null":
            thinking_display = "[yellow]Désactivé (null / --no-think)[/yellow]"
        elif getattr(engine_preview, "thinking", None) is not None:
            thinking_display = f"[green]Activé (niveau: [bold cyan]{engine_preview.thinking}[/bold cyan])[/green]"
        else:
            thinking_display = "[green]Activé / Standard[/green]"

        if getattr(engine_preview, "model_spec", None):
            local_model_display = f"[bold green]{engine_preview.model_spec}[/bold green] ([yellow]{engine_preview.repo_id}[/yellow] / [green]{engine_preview.filename}[/green])"
        else:
            local_model_display = f"[yellow]{engine_preview.repo_id}[/yellow] ([green]{engine_preview.filename}[/green])"

        llm_lines = (
            f"• [bold]Fournisseur LLM[/bold] : [bold magenta]LOCAL (Apple Metal in-memory)[/bold magenta]\n"
            f"• [bold]Optimisation locale[/bold] : [cyan]llama_cpp (GGUF Metal)[/cyan]\n"
            f"• [bold]Modèle[/bold] : {local_model_display}\n"
            f"• [bold]HF Token[/bold] : {token_status}\n"
            f"• [bold]Offload GPU[/bold] : [magenta]n_gpu_layers=-1 (100% Metal)[/magenta]\n"
            f"• [bold]Mode Thinking[/bold] : {thinking_display}"
        )

    if eff_pipeline == PipelineMode.two_pass:
        pipeline_info = (
            f"• [bold]Pipeline[/bold] : [bold magenta]Two-Pass (1. Raisonnement approfondi -> 2. Codage JSON formel)[/bold magenta]\n"
            f"• [bold]Phase Two-Pass[/bold] : [bold cyan]{eff_phase.value.upper()}[/bold cyan]\n"
            f"• [bold]Intensité[/bold] : [bold green]{eff_intensity.value.upper()}[/bold green]"
        )
    else:
        pipeline_info = (
            f"• [bold]Pipeline[/bold] : [cyan]Single-Pass (IA générale directe -> JSON)[/cyan]\n"
            f"• [bold]Intensité[/bold] : [bold green]{eff_intensity.value.upper()}[/bold green]"
        )

    console.print(
        Panel.fit(
            f"{title_text}\n"
            f"• [bold]Mode[/bold] : {mode_label}\n"
            f"• [bold]Fournisseur TCGdex[/bold] : [bold green]{provider.value.upper()}[/bold green] (SDK Python par défaut)\n"
            f"{pipeline_info}\n"
            f"{llm_lines}\n"
            f"• [bold]Recompilation forcée[/bold] : {'Oui' if force else 'Non (reprise sur cache activée)'}\n"
            f"• [bold]Gestion des erreurs[/bold] : {'Ignorer et passer à la suivante (--continue-on-error)' if continue_on_error else 'Arrêt immédiat (défaut)'}",
            border_style="cyan",
        )
    )

    fetcher = TCGdexFetcher(data_dir=data_dir, provider=provider)

    with console.status("[bold blue]Étape 1 & 2 : Récupération de l'index global TCGdex et des données brutes FR/EN...[/bold blue]"):
        bundles = asyncio.run(
            fetcher.fetch_batch(
                mode=effective_mode,
                custom_ids=custom_ids,
                force=False,
                standard_limit=limit,
            )
        )

    console.print(
        f"[green]✓[/green] {len(bundles)} carte(s) récupérée(s) et mise(s) en cache dans [bold]data/raw_tcgdex/[/bold]."
    )

    if not bundles:
        console.print("[yellow]Aucune carte à compiler.[/yellow]")
        return

    # Routage vers le Two-Pass Pipeline si configuré
    if (
        eff_pipeline == PipelineMode.two_pass
        and llm_provider == LLMProvider.local
        and all(isinstance(b, FetchedCardBundle) for b in bundles)
    ):
        run_two_pass_pipeline(
            bundles=bundles,
            data_dir=data_dir,
            phase=eff_phase,
            model=model,
            intensity=eff_intensity,
            backend=effective_backend,
            hf_token=hf_token,
            force=force,
            continue_on_error=continue_on_error,
            console=console,
        )
        if eff_phase in {PipelinePhase.all, PipelinePhase.code}:
            db_path = rebuild_consolidated_database(data_dir, active_ids=None)
            console.print(
                f"[green]✓[/green] Base consolidée mise à jour : [bold]{db_path}[/bold]."
            )
        return

    bundles_to_compile = []
    compiled_results: List[EngineCardModel] = []
    skipped_ids: set[str] = set()
    static_energy_ids: set[str] = set()

    for bundle in bundles:
        out_path = compiled_dir / f"{bundle.card_id}.json"

        if is_basic_energy(bundle):
            static_model = build_basic_energy_model(bundle)
            out_path.write_text(
                json.dumps(static_model.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            compiled_results.append(static_model)
            static_energy_ids.add(bundle.card_id)
            continue

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
            disable_thinking=disable_thinking,
            thinking=thinking,
            model=model,
            local_backend=effective_backend,
        )
        try:
            try:
                with console.status(
                    f"[bold magenta]Étape 3a : Connexion au serveur {compiler_engine.repo_id} et détection du modèle...[/bold magenta]"
                ):
                    compiler_engine.load_model_in_memory()
            except Exception as init_err:
                console.print(
                    f"\n[bold red]✗ Erreur d'initialisation du serveur LLM :[/bold red] {init_err}"
                )
                raise typer.Exit(code=1)

            console.print(
                f"[green]✓[/green] Moteur LLM [bold]{compiler_engine.repo_id}[/bold] ([cyan]{compiler_engine.filename}[/cyan]) prêt."
            )

            actual_parallel = max(1, min(effective_parallel, len(bundles_to_compile)))
            failed_cards: List[Tuple[str, str, str]] = []
            with Progress(
                SpinnerColumn(),
                TextColumn("[progress.description]{task.description}"),
                ConditionalBarColumn(),
                TaskProgressColumn(),
                TimeElapsedColumn(),
                console=console,
            ) as progress:
                if actual_parallel <= 1:
                    task_id = progress.add_task(
                        "[cyan]Compilation GBNF des cartes...",
                        total=len(bundles_to_compile),
                    )
                    for bundle in bundles_to_compile:
                        progress.update(
                            task_id,
                            description=f"[cyan]Compilation de [bold]{bundle.card_id}[/bold] ({bundle.identity.nameFr})...",
                        )

                        def make_token_callback(b=bundle):
                            def on_live_token(tok_count: int, live_tps: float) -> None:
                                tps_display = (
                                    f"[bold green]{live_tps:.1f} t/s[/bold green] "
                                    if live_tps > 0
                                    else "[dim yellow]calcul...[/dim yellow] "
                                )
                                progress.update(
                                    task_id,
                                    description=(
                                        f"[cyan]Compilation de [bold]{b.card_id}[/bold] ({b.identity.nameFr})... "
                                        f"{tps_display}[dim]({tok_count} tok)[/dim]"
                                    ),
                                )
                            return on_live_token

                        try:
                            engine_card = compiler_engine.compile_card(
                                bundle,
                                on_token=make_token_callback(bundle),
                            )
                            out_path = compiled_dir / f"{bundle.card_id}.json"
                            out_path.write_text(
                                json.dumps(engine_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
                                encoding="utf-8",
                            )
                            compiled_results.append(engine_card)

                            # Affichage du débit et de la durée dès la fin de compilation de chaque carte
                            meta = engine_card.compilationMetadata
                            tps_text = (
                                f" • [cyan]{meta.tokensPerSecond:.1f} t/s[/cyan]"
                                if meta and meta.tokensPerSecond is not None
                                else ""
                            )
                            tok_count = (
                                f" ({meta.completionTokens} tokens)"
                                if meta and meta.completionTokens is not None
                                else ""
                            )
                            elapsed_text = f"{meta.compilationTimeSeconds:.2f}s" if meta else ""
                            gen_text = (
                                f" [dim](gén: {meta.generationTimeSeconds:.2f}s)[/dim]"
                                if meta and meta.generationTimeSeconds is not None
                                else ""
                            )
                            progress.console.print(
                                f"  [green]✓[/green] [bold]{bundle.card_id}[/bold] ({bundle.identity.nameFr}) compilé en [yellow]{elapsed_text}[/yellow]{gen_text}{tok_count}{tps_text}"
                            )
                        except Exception as card_err:
                            console.print(
                                f"\n[bold red]✗ Erreur lors de la compilation de {bundle.card_id} ({bundle.identity.nameFr}):[/bold red] {card_err}"
                            )
                            failed_cards.append((bundle.card_id, bundle.identity.nameFr, str(card_err)))
                            if not continue_on_error:
                                # Arrêt immédiat dès la première erreur si continue_on_error est False
                                raise typer.Exit(code=1)
                        finally:
                            progress.advance(task_id)
                else:
                    # Mode multi-slots parallèle : affichage simultané et temps réel des X cartes
                    overall_task = progress.add_task(
                        f"[bold cyan]Compilation de {len(bundles_to_compile)} cartes ({actual_parallel} slots en parallèle)...[/bold cyan]",
                        total=len(bundles_to_compile),
                    )
                    slot_tasks = [
                        progress.add_task(f"  [dim]Slot {s + 1} : En attente...[/dim]", total=None)
                        for s in range(actual_parallel)
                    ]

                    slot_queue: queue.Queue[int] = queue.Queue()
                    for s in range(actual_parallel):
                        slot_queue.put(s)

                    compiled_lock = threading.Lock()
                    failed_lock = threading.Lock()
                    abort_event = threading.Event()

                    def compile_single_bundle(b: FetchedCardBundle) -> None:
                        if abort_event.is_set():
                            progress.advance(overall_task, 1)
                            return

                        slot_id = slot_queue.get()
                        try:
                            if abort_event.is_set():
                                return

                            progress.reset(
                                slot_tasks[slot_id],
                                description=f"  [cyan]Slot {slot_id + 1} : [bold]{b.card_id}[/bold] ({b.identity.nameFr})... [dim yellow]attente tokens...[/dim yellow][/cyan]",
                                total=None,
                                visible=True,
                            )

                            def on_slot_token(tok_count: int, live_tps: float) -> None:
                                tps_display = (
                                    f"[bold green]{live_tps:.1f} t/s[/bold green]"
                                    if live_tps > 0
                                    else "[dim yellow]calcul...[/dim yellow]"
                                )
                                progress.update(
                                    slot_tasks[slot_id],
                                    description=(
                                        f"  [cyan]Slot {slot_id + 1} : [bold]{b.card_id}[/bold] ({b.identity.nameFr}) "
                                        f"[dim]•[/dim] {tps_display} [dim]({tok_count} tok)[/dim][/cyan]"
                                    ),
                                )

                            engine_card = compiler_engine.compile_card(
                                b,
                                on_token=on_slot_token,
                            )
                            out_path = compiled_dir / f"{b.card_id}.json"
                            out_path.write_text(
                                json.dumps(engine_card.model_dump(mode="json"), ensure_ascii=False, indent=2),
                                encoding="utf-8",
                            )

                            with compiled_lock:
                                compiled_results.append(engine_card)

                            meta = engine_card.compilationMetadata
                            tps_text = (
                                f" • [cyan]{meta.tokensPerSecond:.1f} t/s[/cyan]"
                                if meta and meta.tokensPerSecond is not None
                                else ""
                            )
                            tok_count = (
                                f" ({meta.completionTokens} tokens)"
                                if meta and meta.completionTokens is not None
                                else ""
                            )
                            elapsed_text = f"{meta.compilationTimeSeconds:.2f}s" if meta else ""
                            gen_text = (
                                f" [dim](gén: {meta.generationTimeSeconds:.2f}s)[/dim]"
                                if meta and meta.generationTimeSeconds is not None
                                else ""
                            )
                            progress.console.print(
                                f"  [green]✓[/green] [bold]{b.card_id}[/bold] ({b.identity.nameFr}) compilé en [yellow]{elapsed_text}[/yellow]{gen_text}{tok_count}{tps_text} [dim](Slot {slot_id + 1})[/dim]"
                            )
                        except Exception as card_err:
                            if not continue_on_error:
                                abort_event.set()
                            with failed_lock:
                                failed_cards.append((b.card_id, b.identity.nameFr, str(card_err)))
                            progress.console.print(
                                f"\n[bold red]✗ Erreur lors de la compilation de {b.card_id} ({b.identity.nameFr}) sur Slot {slot_id + 1}:[/bold red] {card_err}"
                            )
                        finally:
                            progress.update(
                                slot_tasks[slot_id],
                                description=f"  [dim]Slot {slot_id + 1} : En attente...[/dim]",
                            )
                            progress.advance(overall_task, 1)
                            slot_queue.put(slot_id)

                    with concurrent.futures.ThreadPoolExecutor(max_workers=actual_parallel) as executor:
                        futures = [executor.submit(compile_single_bundle, bundle) for bundle in bundles_to_compile]
                        for fut in concurrent.futures.as_completed(futures):
                            try:
                                fut.result()
                            except Exception:
                                pass

                    for s_task in slot_tasks:
                        progress.update(s_task, visible=False)

                    if failed_cards and not continue_on_error:
                        raise typer.Exit(code=1)

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

    # Consolidation dans data/cards_database.json (conserve et synchronise toutes les cartes compilées)
    db_path = rebuild_consolidated_database(data_dir, active_ids=None)
    console.print(
        f"[green]✓[/green] Base consolidée mise à jour : [bold]{db_path}[/bold]."
    )

    # Ordre d'affichage fidèle aux bundles demandés
    order_map = {b.card_id: idx for idx, b in enumerate(bundles)}
    compiled_results.sort(key=lambda c: order_map.get(c.cardId, 9999))

    # Table récapitulative Rich (ID, Nom, Rôle, Primitives générées, Conditions de Carte Morte, Temps / Débit)
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
    table.add_column("Temps / Débit", justify="right", style="cyan")

    for model in compiled_results:
        is_static = (
            model.cardId in static_energy_ids
            or (model.compilationMetadata and model.compilationMetadata.modelRepoId == "STATIC_DETERMINISTIC")
            or model.subCategory == CardSubCategory.BASIC_ENERGY
        )

        if is_static:
            primitives_str = "[cyan]⚡ STATIQUE (Skip LLM)[/cyan]"
            dead_str = "—"
            perf_str = "0.00s"
        else:
            primitives: List[str] = []
            for action in model.playableActions:
                for eff in action.effects:
                    primitives.append(eff.primitive.value)
            primitives_str = ", ".join(primitives) if primitives else "—"

            dead_reasons = [act.deadCardCondition for act in model.playableActions if act.deadCardCondition]
            dead_str = ", ".join(dead_reasons) if dead_reasons else "—"

            meta = model.compilationMetadata
            if meta:
                time_str = f"{meta.compilationTimeSeconds:.2f}s"
                if meta.tokensPerSecond is not None:
                    perf_str = f"{time_str} ({meta.tokensPerSecond:.1f} t/s)"
                else:
                    perf_str = time_str
            else:
                perf_str = "—"

            if model.cardId in skipped_ids:
                perf_str = f"{perf_str} (cache)"

        display_name = model.identity.nameFr
        if model.identity.nameEn and model.identity.nameEn.lower() != model.identity.nameFr.lower():
            display_name = f"{model.identity.nameFr} ({model.identity.nameEn})"

        role_attr = getattr(model.strategicEvaluator, "aiRole", None)
        role_val = getattr(role_attr, "value", None)
        if not isinstance(role_val, str):
            prim_attr = getattr(model.strategicEvaluator, "primaryRole", None)
            role_val = getattr(prim_attr, "value", None)
        role_str = str(role_val) if isinstance(role_val, str) else "—"

        table.add_row(
            model.cardId,
            display_name,
            role_str,
            primitives_str,
            dead_str,
            perf_str,
        )

    console.print(table)

    # Statistiques de débit global
    tps_values = [
        m.compilationMetadata.tokensPerSecond
        for m in compiled_results
        if m.cardId not in skipped_ids
        and m.cardId not in static_energy_ids
        and m.compilationMetadata
        and m.compilationMetadata.tokensPerSecond is not None
    ]
    if tps_values:
        avg_tps = sum(tps_values) / len(tps_values)
        total_toks = sum(
            m.compilationMetadata.completionTokens
            for m in compiled_results
            if m.cardId not in skipped_ids
            and m.compilationMetadata
            and m.compilationMetadata.completionTokens is not None
        )
        tok_info = f" • [cyan]{total_toks}[/cyan] tokens générés au total" if total_toks > 0 else ""
        console.print(
            f"[bold cyan]⚡ Débit moyen d'inférence :[/bold cyan] [bold green]{avg_tps:.1f} tokens/seconde[/bold green]"
            f"{tok_info} ([dim]{len(tps_values)} carte(s) compilée(s)[/dim])"
        )

    if failed_cards:
        failed_table = Table(
            title=f"⚠️ Récapitulatif des Cartes en Échec ({len(failed_cards)} carte(s) à recompiler)",
            show_lines=True,
            border_style="red",
            header_style="bold red",
        )
        failed_table.add_column("ID", style="bold yellow", no_wrap=True)
        failed_table.add_column("Nom", style="bold white")
        failed_table.add_column("Détail de l'Erreur", style="red")
        for cid, cname, err_desc in failed_cards:
            short_err = err_desc.strip().replace("\n", " ")
            if len(short_err) > 120:
                short_err = short_err[:117] + "..."
            failed_table.add_row(cid, cname, short_err)
        console.print(failed_table)
        console.print(
            f"[yellow]💡 Astuce : Relancez la commande pour ne recompiler que ces {len(failed_cards)} cartes restantes (reprise automatique sur cache).[/yellow]"
        )


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
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes ligne par ligne (déduplication automatique).",
    ),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        envvar=["TCGDEX_PROVIDER"],
        help="Fournisseur d'accès aux cartes TCGdex : 'sdk' (SDK Python officiel tcgdex-sdk par défaut) ou 'rest' (API HTTP directe httpx).",
    ),
    llm_provider: LLMProvider = typer.Option(
        LLMProvider.local,
        "--llm-provider",
        "-lp",
        envvar=["LLM_PROVIDER"],
        help="Fournisseur d'inférence LLM : 'local' (Apple Metal llama.cpp local par défaut) ou 'lm_studio' (serveur LM Studio local ou distant via API REST).",
    ),
    model: Optional[str] = typer.Option(
        None,
        "--model",
        envvar=["LLM_MODEL", "MODEL", "LM_STUDIO_MODEL"],
        help="Modèle LLM complet (commun LM Studio et Local) : nom du modèle LM Studio, chemin local .gguf, ou repo HF (ex: 'Qwen/Qwen3-14B-GGUF/Qwen3-14B-Q6_K.gguf').",
    ),
    tier: ModelTier = typer.Option(
        ModelTier.qwen3,
        "--tier",
        "-t",
        hidden=True,
        help="Palier de repli interne.",
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
    no_think: bool = typer.Option(
        False,
        "--no-think",
        "--disable-thinking",
        envvar=["LM_STUDIO_NO_THINK", "LM_STUDIO_DISABLE_THINKING", "NO_THINK", "DISABLE_THINKING"],
        help="Désactive le mode réflexion / thinking des modèles raisonnants (ex: Qwen, DeepSeek) en mode Local et LM Studio.",
    ),
    thinking: Optional[str] = typer.Option(
        None,
        "--thinking",
        "-tk",
        envvar=["LM_STUDIO_THINKING", "THINKING", "THINKING_LEVEL", "LM_STUDIO_THINKING_LEVEL"],
        help="Niveau de réflexion / thinking pour les modèles raisonnants (Local et LM Studio) : 'null' pour désactiver, ou un niveau ('low', 'medium', 'high', ou nombre de tokens).",
    ),
    parallel: int = typer.Option(
        1,
        "--parallel",
        "-j",
        "--concurrency",
        envvar=["LM_STUDIO_PARALLEL", "PARALLEL", "CONCURRENCY", "COMPILER_CONCURRENCY"],
        help="Nombre de cartes à compiler en parallèle (concurrence LLM multi-slots, LM Studio uniquement).",
    ),
    continue_on_error: bool = typer.Option(
        False,
        "--continue-on-error",
        "-k",
        "--ignore-errors",
        "--skip-errors",
        envvar=["CONTINUE_ON_ERROR", "IGNORE_ERRORS", "SKIP_ERRORS"],
        help="Ignore les erreurs d'une carte et passe à la suivante au lieu d'interrompre l'exécution (idéal pour les grands lots).",
    ),
    local_backend: Optional[str] = typer.Option(
        None,
        "--local-backend",
        "--local-opt",
        envvar=["LOCAL_BACKEND", "LOCAL_OPTIMIZATION"],
        help="Backend d'optimisation locale ('mlx' ou 'llama_cpp'). Ignoré si LLM_PROVIDER=lm_studio.",
    ),
    pipeline: Optional[str] = typer.Option(
        None,
        "--pipeline",
        "-pl",
        envvar=["PIPELINE_MODE"],
        help="Mode de pipeline : 'single' (défaut, IA générale direct -> JSON) ou 'two_pass' (double passe : 1. raisonnement -> 2. codage JSON).",
    ),
    intensity: Optional[str] = typer.Option(
        None,
        "--intensity",
        "-it",
        envvar=["INTENSITY_MODE"],
        help="Niveau d'intensité du modèle : 'soft' (défaut, ~7-8 Go RAM unifiée) ou 'intense' (~14-18 Go RAM unifiée, mode nuit/AFK).",
    ),
    phase: Optional[str] = typer.Option(
        None,
        "--phase",
        envvar=["PIPELINE_PHASE"],
        help="Phase en mode two_pass : 'all' (défaut, raisonnement puis coding), 'reason' (passe 1), 'code' (passe 2).",
    ),
) -> None:
    """Exécute le pipeline complet d'extraction TCGdex et de compilation LLM sous contrainte GBNF."""
    effective_thinking = "null" if no_think else thinking

    _execute_run_pipeline(
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        provider=provider,
        llm_provider=llm_provider,
        tier=tier,
        fast=False,
        force=force,
        limit=limit,
        hf_token=hf_token,
        disable_thinking=no_think,
        thinking=effective_thinking,
        parallel=parallel,
        continue_on_error=continue_on_error,
        model=model,
        local_backend=local_backend,
        pipeline=pipeline,
        intensity=intensity,
        phase=phase,
        ids_file=ids_file,
    )


@app.command("compile", hidden=True)
def compile_alias(
    mode: RunMode = typer.Option(RunMode.test, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes (un par ligne, déduplication automatique).",
    ),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        envvar=["TCGDEX_PROVIDER"],
        help="Fournisseur d'accès aux cartes TCGdex : 'sdk' (SDK Python officiel tcgdex-sdk par défaut) ou 'rest' (API HTTP directe httpx).",
    ),
    llm_provider: LLMProvider = typer.Option(
        LLMProvider.local,
        "--llm-provider",
        "-lp",
        envvar=["LLM_PROVIDER"],
        help="Fournisseur d'inférence LLM : 'local' ou 'lm_studio'.",
    ),
    model: Optional[str] = typer.Option(
        None,
        "--model",
        envvar=["LLM_MODEL", "MODEL", "LM_STUDIO_MODEL"],
        help="Modèle LLM complet (commun LM Studio et Local) : nom du modèle LM Studio, chemin local .gguf, ou repo HF (ex: 'Qwen/Qwen3-14B-GGUF/Qwen3-14B-Q6_K.gguf').",
    ),
    tier: ModelTier = typer.Option(
        ModelTier.qwen3,
        "--tier",
        "-t",
        hidden=True,
        help="Palier de repli interne.",
    ),
    force: bool = typer.Option(False, "--force"),
    limit: Optional[int] = typer.Option(None, "--limit"),
    hf_token: Optional[str] = typer.Option(
        None,
        "--hf-token",
        envvar=["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"],
        help="Jeton Hugging Face (HF_TOKEN) pour accélérer le téléchargement du modèle GGUF.",
    ),
    no_think: bool = typer.Option(
        False,
        "--no-think",
        "--disable-thinking",
        envvar=["LM_STUDIO_NO_THINK", "LM_STUDIO_DISABLE_THINKING", "NO_THINK", "DISABLE_THINKING"],
        help="Désactive le mode réflexion / thinking des modèles raisonnants (ex: Qwen, DeepSeek) en mode Local et LM Studio.",
    ),
    thinking: Optional[str] = typer.Option(
        None,
        "--thinking",
        "-tk",
        envvar=["LM_STUDIO_THINKING", "THINKING", "THINKING_LEVEL", "LM_STUDIO_THINKING_LEVEL"],
        help="Niveau de réflexion / thinking pour les modèles raisonnants (Local et LM Studio) : 'null' pour désactiver, ou un niveau ('low', 'medium', 'high', ou nombre de tokens).",
    ),
    parallel: int = typer.Option(
        1,
        "--parallel",
        "-j",
        "--concurrency",
        envvar=["LM_STUDIO_PARALLEL", "PARALLEL", "CONCURRENCY", "COMPILER_CONCURRENCY"],
        help="Nombre de cartes à compiler en parallèle (concurrence LLM multi-slots, LM Studio uniquement).",
    ),
    continue_on_error: bool = typer.Option(
        False,
        "--continue-on-error",
        "-k",
        "--ignore-errors",
        "--skip-errors",
        envvar=["CONTINUE_ON_ERROR", "IGNORE_ERRORS", "SKIP_ERRORS"],
        help="Ignore les erreurs d'une carte et passe à la suivante au lieu d'interrompre l'exécution (idéal pour les grands lots).",
    ),
    local_backend: Optional[str] = typer.Option(
        None,
        "--local-backend",
        "--local-opt",
        envvar=["LOCAL_BACKEND", "LOCAL_OPTIMIZATION"],
        help="Backend d'optimisation locale ('mlx' ou 'llama_cpp'). Ignoré si LLM_PROVIDER=lm_studio.",
    ),
    pipeline: Optional[str] = typer.Option(
        None,
        "--pipeline",
        "-pl",
        envvar=["PIPELINE_MODE"],
        help="Mode de pipeline : 'single' (défaut) ou 'two_pass'.",
    ),
    intensity: Optional[str] = typer.Option(
        None,
        "--intensity",
        "-it",
        envvar=["INTENSITY_MODE"],
        help="Niveau d'intensité : 'soft' (défaut) ou 'intense'.",
    ),
    phase: Optional[str] = typer.Option(
        None,
        "--phase",
        envvar=["PIPELINE_PHASE"],
        help="Phase en mode two_pass : 'all', 'reason', 'code'.",
    ),
) -> None:
    """Alias de la commande `run`."""
    effective_thinking = "null" if no_think else thinking

    _execute_run_pipeline(
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        provider=provider,
        llm_provider=llm_provider,
        tier=tier,
        fast=False,
        force=force,
        limit=limit,
        hf_token=hf_token,
        disable_thinking=no_think,
        thinking=effective_thinking,
        parallel=parallel,
        continue_on_error=continue_on_error,
        model=model,
        local_backend=local_backend,
        pipeline=pipeline,
        intensity=intensity,
        phase=phase,
        ids_file=ids_file,
    )


@app.command("reason")
def reason_command(
    mode: RunMode = typer.Option(RunMode.test, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes (un par ligne, déduplication automatique).",
    ),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        envvar=["TCGDEX_PROVIDER"],
        help="Fournisseur d'accès TCGdex.",
    ),
    intensity: Optional[str] = typer.Option(
        None,
        "--intensity",
        "-it",
        envvar=["INTENSITY_MODE"],
        help="Niveau d'intensité du modèle de raisonnement : 'soft' (défaut, 14B 4-bit) ou 'intense' (14B 8-bit).",
    ),
    local_backend: Optional[str] = typer.Option(
        None,
        "--local-backend",
        "--local-opt",
        envvar=["LOCAL_BACKEND", "LOCAL_OPTIMIZATION"],
        help="Backend d'optimisation locale ('mlx' ou 'llama_cpp').",
    ),
    model: Optional[str] = typer.Option(
        None,
        "--model",
        envvar=["REASONING_MODEL", "LLM_MODEL"],
        help="Modèle spécifique pour la Passe 1 de raisonnement.",
    ),
    force: bool = typer.Option(False, "--force", help="Force la regénération des analyses même si déjà en cache."),
    limit: Optional[int] = typer.Option(None, "--limit"),
    continue_on_error: bool = typer.Option(
        False,
        "--continue-on-error",
        "-k",
        "--ignore-errors",
        "--skip-errors",
        envvar=["CONTINUE_ON_ERROR", "IGNORE_ERRORS", "SKIP_ERRORS"],
        help="Ignore les erreurs d'une carte et passe à la suivante au lieu d'interrompre l'exécution.",
    ),
    hf_token: Optional[str] = typer.Option(None, "--hf-token", envvar=["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"]),
) -> None:
    """Exécute la Passe 1 du pipeline Two-Pass : Génère tous les textes d'analyse de règles dans data/reasoning_texts/."""
    _execute_run_pipeline(
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        provider=provider,
        llm_provider=LLMProvider.local,
        tier=ModelTier.qwen3,
        fast=False,
        force=force,
        limit=limit,
        hf_token=hf_token,
        continue_on_error=continue_on_error,
        model=model,
        local_backend=local_backend,
        pipeline="two_pass",
        intensity=intensity,
        phase="reason",
        ids_file=ids_file,
    )


@app.command("code")
def code_command(
    mode: RunMode = typer.Option(RunMode.test, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes (un par ligne, déduplication automatique).",
    ),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        envvar=["TCGDEX_PROVIDER"],
        help="Fournisseur d'accès TCGdex.",
    ),
    intensity: Optional[str] = typer.Option(
        None,
        "--intensity",
        "-it",
        envvar=["INTENSITY_MODE"],
        help="Niveau d'intensité du modèle de coding : 'soft' (défaut, 7B 8-bit) ou 'intense' (14B 8-bit).",
    ),
    local_backend: Optional[str] = typer.Option(
        None,
        "--local-backend",
        "--local-opt",
        envvar=["LOCAL_BACKEND", "LOCAL_OPTIMIZATION"],
        help="Backend d'optimisation locale ('mlx' ou 'llama_cpp').",
    ),
    model: Optional[str] = typer.Option(
        None,
        "--model",
        envvar=["CODING_MODEL", "LLM_MODEL"],
        help="Modèle spécifique pour la Passe 2 de codage JSON.",
    ),
    force: bool = typer.Option(False, "--force", help="Force la recompilation JSON même si la carte existe déjà."),
    limit: Optional[int] = typer.Option(None, "--limit"),
    continue_on_error: bool = typer.Option(
        False,
        "--continue-on-error",
        "-k",
        "--ignore-errors",
        "--skip-errors",
        envvar=["CONTINUE_ON_ERROR", "IGNORE_ERRORS", "SKIP_ERRORS"],
        help="Ignore les erreurs d'une carte et passe à la suivante au lieu d'interrompre l'exécution.",
    ),
    hf_token: Optional[str] = typer.Option(None, "--hf-token", envvar=["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"]),
) -> None:
    """Exécute la Passe 2 du pipeline Two-Pass : Transforme les textes d'analyse en code JSON formel validé."""
    _execute_run_pipeline(
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        provider=provider,
        llm_provider=LLMProvider.local,
        tier=ModelTier.qwen3,
        fast=False,
        force=force,
        limit=limit,
        hf_token=hf_token,
        continue_on_error=continue_on_error,
        model=model,
        local_backend=local_backend,
        pipeline="two_pass",
        intensity=intensity,
        phase="code",
        ids_file=ids_file,
    )


@app.command("re-run")
def re_run_command(
    phase: str = typer.Option(
        "all",
        "--phase",
        "-ph",
        help="Phase du pipeline Two-Pass à réexécuter : 'all' (Passe 1 puis Passe 2, défaut), 'reason' (Passe 1 seule), 'code' (Passe 2 seule).",
    ),
    mode: Optional[RunMode] = typer.Option(
        None,
        "--mode",
        "-m",
        help="Mode de filtrage des cartes cibles : 'standard' ou 'test'. Par défaut, inspecte les dossiers selon la phase.",
    ),
    test_flag: bool = typer.Option(
        False,
        "--test",
        help="Cible les cartes du jeu d'essai standardisé (11 cartes stratégiques de référence).",
    ),
    standard_flag: bool = typer.Option(
        False,
        "--standard",
        help="Cible l'ensemble des cartes légales au format Standard.",
    ),
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants précis (séparés par des virgules ou syntaxe @fichier.txt).",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant des IDs ligne par ligne (déduplication automatique).",
    ),
    set_name: Optional[str] = typer.Option(
        None,
        "--set",
        "-s",
        help="Filtre les cartes par extension (ex: 'sv06', 'sv05', 'me01').",
    ),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        envvar=["TCGDEX_PROVIDER"],
        help="Fournisseur d'accès TCGdex ('sdk' ou 'rest').",
    ),
    intensity: Optional[str] = typer.Option(
        None,
        "--intensity",
        "-it",
        envvar=["INTENSITY_MODE"],
        help="Niveau d'intensité du modèle : 'soft' (défaut, ~7-8 Go RAM) ou 'intense' (~14-18 Go RAM).",
    ),
    local_backend: Optional[str] = typer.Option(
        None,
        "--local-backend",
        "--local-opt",
        envvar=["LOCAL_BACKEND", "LOCAL_OPTIMIZATION"],
        help="Backend d'optimisation locale ('mlx' ou 'llama_cpp').",
    ),
    model: Optional[str] = typer.Option(
        None,
        "--model",
        envvar=["LLM_MODEL"],
        help="Override manuel du modèle LLM.",
    ),
    force: bool = typer.Option(
        True,
        "--force/--no-force",
        help="Force le recalcul et écrase les fiches existantes (défaut: True pour re-run).",
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit",
        help="Nombre maximum de cartes à réexécuter.",
    ),
    continue_on_error: bool = typer.Option(
        False,
        "--continue-on-error",
        "-k",
        "--ignore-errors",
        "--skip-errors",
        envvar=["CONTINUE_ON_ERROR", "IGNORE_ERRORS", "SKIP_ERRORS"],
        help="Ignore les erreurs d'une carte et passe à la suivante au lieu d'interrompre l'exécution.",
    ),
    hf_token: Optional[str] = typer.Option(
        None,
        "--hf-token",
        envvar=["HF_TOKEN", "HUGGING_FACE_HUB_TOKEN"],
        help="Jeton d'authentification Hugging Face.",
    ),
) -> None:
    """Réexécute une phase ou les deux phases du pipeline Two-Pass sur les cartes cibles.

    - Si `--phase reason` : inspecte `data/reasoning_texts/` et réexécute la Passe 1.
    - Si `--phase code` : inspecte `data/compiled_cards/` et réexécute la Passe 2.
    - Si `--phase all` : inspecte les cartes de `data/reasoning_texts/` et/ou `data/compiled_cards/`
      et réexécute la Passe 1 d'abord pour toutes les cartes, puis la Passe 2 ensuite pour toutes les cartes.
    - Sélection ciblée supportée via `--ids`, `--ids-file` / `-f`, `--mode test|standard`, `--test`, `--standard`, ou `--set`.
    - Si un identifiant demandé n'existe pas dans les dossiers concernés (ou dans le cache raw),
      il est automatiquement généré/téléchargé depuis TCGdex pour effectuer les phases dessus.
    """
    import os
    data_dir = get_data_dir()
    reason_dir = get_reasoning_texts_dir(data_dir)
    compiled_dir = data_dir / "compiled_cards"

    eff_phase = normalize_pipeline_phase(phase)
    eff_intensity = normalize_intensity_mode(intensity or os.environ.get("INTENSITY_MODE"))
    raw_b = (
        local_backend
        or os.environ.get("LOCAL_BACKEND")
        or os.environ.get("LOCAL_OPTIMIZATION")
        or "mlx"
    ).strip().lower()
    effective_backend = "mlx" if raw_b == "mlx" else "llama_cpp"

    fetcher = TCGdexFetcher(data_dir=data_dir, provider=provider)

    # 1. Résolution des identifiants cibles
    custom_ids = resolve_card_ids(ids=ids, ids_file=ids_file)

    if custom_ids is not None:
        target_ids = list(custom_ids)
        origin_descr = f"Sélection ciblée (--ids / --ids-file) : {len(target_ids)} carte(s)"
    elif test_flag or (mode is not None and mode == RunMode.test):
        target_ids = list(TEST_CARD_IDS)
        origin_descr = f"Jeu d'essai de référence (--test) : {len(target_ids)} carte(s)"
    elif standard_flag or (mode is not None and mode == RunMode.standard):
        std_index_path = data_dir / "raw_tcgdex" / "_cards_standard_index.json"
        if std_index_path.exists():
            try:
                cached_std = json.loads(std_index_path.read_text(encoding="utf-8"))
                target_ids = [
                    str(c.get("id")).strip()
                    for c in cached_std
                    if isinstance(c, dict) and c.get("id")
                ]
            except Exception:
                target_ids = []
        else:
            target_ids = []

        if not target_ids:
            async def _resolve_std():
                async with httpx.AsyncClient() as client:
                    return await fetcher.resolve_standard_card_ids(client)
            target_ids = asyncio.run(_resolve_std())
        origin_descr = f"Ensemble légal Standard : {len(target_ids)} carte(s)"
    else:
        # Découverte automatique selon la phase demandée
        if eff_phase == PipelinePhase.reason:
            target_ids = sorted([
                f.stem for f in reason_dir.glob("*.json")
                if not f.name.startswith("_")
            ])
            origin_descr = f"Cartes existantes dans data/reasoning_texts/ : {len(target_ids)} carte(s)"
        elif eff_phase == PipelinePhase.code:
            target_ids = sorted([
                f.stem for f in compiled_dir.glob("*.json")
                if not f.name.startswith("_")
            ])
            origin_descr = f"Cartes existantes dans data/compiled_cards/ : {len(target_ids)} carte(s)"
        else:  # PipelinePhase.all
            reason_ids = {
                f.stem for f in reason_dir.glob("*.json")
                if not f.name.startswith("_")
            }
            compiled_ids = {
                f.stem for f in compiled_dir.glob("*.json")
                if not f.name.startswith("_")
            }
            target_ids = sorted(list(reason_ids | compiled_ids))
            origin_descr = f"Cartes existantes dans data/reasoning_texts/ & data/compiled_cards/ : {len(target_ids)} carte(s)"

    # Application du filtre par extension (--set) si renseigné
    if set_name:
        s_clean = set_name.strip().lower()
        target_ids = [
            cid for cid in target_ids
            if cid.lower().startswith(f"{s_clean}-") or cid.lower() == s_clean
        ]

    # Application de la limite éventuelle
    if limit is not None and limit > 0:
        target_ids = target_ids[:limit]

    # Déduplication finale en préservant l'ordre
    target_ids = list(dict.fromkeys(target_ids))

    if not target_ids:
        console.print(
            f"[yellow]⚠️ Aucune carte trouvée à réexécuter pour la phase '{eff_phase.value}'.[/yellow]"
        )
        return

    # Détection des cartes demandées absentes des dossiers concernés
    missing_in_target_folder: List[str] = []
    if eff_phase == PipelinePhase.reason:
        missing_in_target_folder = [cid for cid in target_ids if not (reason_dir / f"{cid}.json").exists()]
    elif eff_phase == PipelinePhase.code:
        missing_in_target_folder = [cid for cid in target_ids if not (compiled_dir / f"{cid}.json").exists()]
    else:  # all
        missing_in_target_folder = [
            cid for cid in target_ids
            if not (reason_dir / f"{cid}.json").exists() and not (compiled_dir / f"{cid}.json").exists()
        ]

    if missing_in_target_folder:
        console.print(
            f"[cyan]ℹ️ {len(missing_in_target_folder)} carte(s) demandée(s) absente(s) du dossier cible : "
            f"récupération / génération depuis TCGdex...[/cyan]"
        )

    # Récupération des bundles (cache local dans data/raw_tcgdex/ ou téléchargement direct TCGdex)
    with console.status("[bold blue]Récupération et validation des données brutes TCGdex (cache local ou téléchargement)...[/bold blue]"):
        bundles = asyncio.run(
            fetcher.fetch_batch(
                custom_ids=target_ids,
                force=False,
            )
        )

    if not bundles:
        console.print("[yellow]⚠️ Aucune carte valide n'a pu être préparée.[/yellow]")
        return

    phase_title_map = {
        PipelinePhase.reason: "Passe 1 / 2 : Raisonnement Approfondi",
        PipelinePhase.code: "Passe 2 / 2 : Codage JSON Formel",
        PipelinePhase.all: "Double Passe Complète (Passe 1 puis Passe 2)",
    }
    console.print(
        Panel.fit(
            f"[bold cyan]Pokémon TCG Card Compiler — Réexécution de Phase (Two-Pass Pipeline)[/bold cyan]\n"
            f"• [bold]Phase ciblée[/bold] : [bold magenta]{phase_title_map.get(eff_phase, eff_phase.value)}[/bold magenta]\n"
            f"• [bold]Périmètre[/bold] : {origin_descr}\n"
            f"• [bold]Cartes à réexécuter[/bold] : [bold green]{len(bundles)}[/bold green]\n"
            f"• [bold]Intensité[/bold] : [bold green]{eff_intensity.value.upper()}[/bold green]\n"
            f"• [bold]Backend[/bold] : [cyan]{effective_backend}[/cyan]\n"
            f"• [bold]Recompilation forcée[/bold] : {'Oui' if force else 'Non'}\n"
            f"• [bold]Gestion des erreurs[/bold] : {'Ignorer et continuer (-k)' if continue_on_error else 'Arrêt immédiat'}",
            border_style="cyan",
        )
    )

    # Si la phase ciblée est 'code' (Passe 2 seule), vérifier si des cartes n'ont pas encore d'analyse de Passe 1
    if eff_phase == PipelinePhase.code:
        bundles_needing_reasoning = [
            b for b in bundles
            if not is_basic_energy(b) and not has_reasoning_record(b.card_id, data_dir)
        ]
        if bundles_needing_reasoning:
            console.print(
                f"[yellow]⚡ {len(bundles_needing_reasoning)} carte(s) n'ont pas encore d'analyse de Passe 1 : "
                "génération automatique préalable de la Passe 1 avant le codage JSON...[/yellow]"
            )
            run_reasoning_phase(
                bundles=bundles_needing_reasoning,
                data_dir=data_dir,
                model=model,
                intensity=eff_intensity,
                backend=effective_backend,
                hf_token=hf_token,
                force=False,
                continue_on_error=continue_on_error,
                console=console,
            )

    # Exécution du pipeline Two-Pass avec force=force pour écraser les fiches existantes
    run_two_pass_pipeline(
        bundles=bundles,
        data_dir=data_dir,
        phase=eff_phase,
        model=model,
        intensity=eff_intensity,
        backend=effective_backend,
        hf_token=hf_token,
        force=force,
        continue_on_error=continue_on_error,
        console=console,
    )

    # Si du code JSON a été généré (Passe 2 ou All), synchronisation automatique de data/cards_database.json
    if eff_phase in {PipelinePhase.all, PipelinePhase.code}:
        db_path = rebuild_consolidated_database(data_dir, active_ids=None)
        console.print(
            f"[green]✓[/green] Base consolidée mise à jour : [bold]{db_path}[/bold]."
        )


@app.command("rerun", hidden=True)
def rerun_command(
    phase: str = typer.Option("all", "--phase", "-ph"),
    mode: Optional[RunMode] = typer.Option(None, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    intensity: Optional[str] = typer.Option(None, "--intensity", "-it"),
    local_backend: Optional[str] = typer.Option(None, "--local-backend", "--local-opt"),
    model: Optional[str] = typer.Option(None, "--model"),
    force: bool = typer.Option(True, "--force/--no-force"),
    limit: Optional[int] = typer.Option(None, "--limit"),
    continue_on_error: bool = typer.Option(False, "--continue-on-error", "-k"),
    hf_token: Optional[str] = typer.Option(None, "--hf-token"),
) -> None:
    """Alias pour `re-run`."""
    re_run_command(
        phase=phase,
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        ids_file=ids_file,
        set_name=set_name,
        provider=provider,
        intensity=intensity,
        local_backend=local_backend,
        model=model,
        force=force,
        limit=limit,
        continue_on_error=continue_on_error,
        hf_token=hf_token,
    )


@app.command("redo", hidden=True)
def redo_command(
    phase: str = typer.Option("all", "--phase", "-ph"),
    mode: Optional[RunMode] = typer.Option(None, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    intensity: Optional[str] = typer.Option(None, "--intensity", "-it"),
    local_backend: Optional[str] = typer.Option(None, "--local-backend", "--local-opt"),
    model: Optional[str] = typer.Option(None, "--model"),
    force: bool = typer.Option(True, "--force/--no-force"),
    limit: Optional[int] = typer.Option(None, "--limit"),
    continue_on_error: bool = typer.Option(False, "--continue-on-error", "-k"),
    hf_token: Optional[str] = typer.Option(None, "--hf-token"),
) -> None:
    """Alias pour `re-run`."""
    re_run_command(
        phase=phase,
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        ids_file=ids_file,
        set_name=set_name,
        provider=provider,
        intensity=intensity,
        local_backend=local_backend,
        model=model,
        force=force,
        limit=limit,
        continue_on_error=continue_on_error,
        hf_token=hf_token,
    )


@app.command("recompile", hidden=True)
def recompile_command(
    phase: str = typer.Option("all", "--phase", "-ph"),
    mode: Optional[RunMode] = typer.Option(None, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    intensity: Optional[str] = typer.Option(None, "--intensity", "-it"),
    local_backend: Optional[str] = typer.Option(None, "--local-backend", "--local-opt"),
    model: Optional[str] = typer.Option(None, "--model"),
    force: bool = typer.Option(True, "--force/--no-force"),
    limit: Optional[int] = typer.Option(None, "--limit"),
    continue_on_error: bool = typer.Option(False, "--continue-on-error", "-k"),
    hf_token: Optional[str] = typer.Option(None, "--hf-token"),
) -> None:
    """Alias pour `re-run`."""
    re_run_command(
        phase=phase,
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        ids_file=ids_file,
        set_name=set_name,
        provider=provider,
        intensity=intensity,
        local_backend=local_backend,
        model=model,
        force=force,
        limit=limit,
        continue_on_error=continue_on_error,
        hf_token=hf_token,
    )


@app.command("reexecute", hidden=True)
def reexecute_command(
    phase: str = typer.Option("all", "--phase", "-ph"),
    mode: Optional[RunMode] = typer.Option(None, "--mode", "-m"),
    test_flag: bool = typer.Option(False, "--test"),
    standard_flag: bool = typer.Option(False, "--standard"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    intensity: Optional[str] = typer.Option(None, "--intensity", "-it"),
    local_backend: Optional[str] = typer.Option(None, "--local-backend", "--local-opt"),
    model: Optional[str] = typer.Option(None, "--model"),
    force: bool = typer.Option(True, "--force/--no-force"),
    limit: Optional[int] = typer.Option(None, "--limit"),
    continue_on_error: bool = typer.Option(False, "--continue-on-error", "-k"),
    hf_token: Optional[str] = typer.Option(None, "--hf-token"),
) -> None:
    """Alias pour `re-run`."""
    re_run_command(
        phase=phase,
        mode=mode,
        test_flag=test_flag,
        standard_flag=standard_flag,
        ids=ids,
        ids_file=ids_file,
        set_name=set_name,
        provider=provider,
        intensity=intensity,
        local_backend=local_backend,
        model=model,
        force=force,
        limit=limit,
        continue_on_error=continue_on_error,
        hf_token=hf_token,
    )


@app.command("inspect")
def inspect_command(
    card_id: Optional[str] = typer.Argument(
        None,
        help="Identifiant de la carte à inspecter (ex: sv04-125, sv03-125).",
    ),
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants à inspecter séparés par des virgules.",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes à inspecter (déduplication automatique).",
    ),
) -> None:
    """Affiche avec coloration syntaxique JSON le modèle complet généré dans `data/compiled_cards/<card_id>.json`."""
    target_ids: List[str] = []
    if card_id:
        target_ids.append(card_id.strip())
    resolved = resolve_card_ids(ids=ids, ids_file=ids_file)
    if resolved:
        target_ids.extend(resolved)

    target_ids = list(dict.fromkeys(target_ids))

    if not target_ids:
        console.print(
            "[bold red]Erreur :[/bold red] Veuillez spécifier un identifiant de carte en argument "
            "(ex: [cyan]python -m compiler.cli inspect sv04-125[/cyan]) ou utiliser l'option [cyan]--ids[/cyan] / [cyan]--ids-file[/cyan]."
        )
        raise typer.Exit(code=1)

    data_dir = get_data_dir()
    for cid in target_ids:
        file_path = data_dir / "compiled_cards" / f"{cid}.json"

        if not file_path.exists():
            console.print(
                f"[bold red]Erreur :[/bold red] Le fichier [bold]{file_path}[/bold] n'existe pas.\n"
                f"Lancez d'abord : [cyan]python -m compiler.cli run --ids {cid}[/cyan]"
            )
            if len(target_ids) == 1:
                raise typer.Exit(code=1)
            continue

        raw_json_str = file_path.read_text(encoding="utf-8")
        try:
            model = EngineCardModel.model_validate_json(raw_json_str)
        except ValidationError as exc:
            console.print(f"[bold red]Validation Pydantic échouée pour {file_path} :[/bold red]\n{exc}")
            if len(target_ids) == 1:
                raise typer.Exit(code=1)
            continue

        evo_line = ""
        if model.pokemonStats:
            chain_str = " ➔ ".join(model.pokemonStats.evolutionChain)
            evo_line = (
                f"\n• [bold]PV / Types[/bold] : {model.pokemonStats.hp} PV | {', '.join(model.pokemonStats.types)}"
                f"\n• [bold]Lignée d'évolution[/bold] : {chain_str} (Base racine : [green]{model.pokemonStats.rootBasicName}[/green])"
            )

        meta_line = ""
        if model.compilationMetadata:
            meta = model.compilationMetadata
            tps_part = f" | Débit : [bold green]{meta.tokensPerSecond:.1f} t/s[/bold green]" if meta.tokensPerSecond is not None else ""
            tok_part = f" ({meta.completionTokens} tokens)" if meta.completionTokens is not None else ""
            meta_line = (
                f"\n• [bold]Métadonnées LLM[/bold] : Modèle [cyan]{meta.modelFilename}[/cyan] | "
                f"Temps : [yellow]{meta.compilationTimeSeconds:.2f}s[/yellow]{tok_part}{tps_part}"
            )

        console.print(
            Panel.fit(
                f"[bold yellow]{model.cardId}[/bold yellow] — [bold white]{model.identity.nameFr}[/bold white] "
                f"({model.identity.nameEn or 'N/A'})\n"
                f"• [bold]Catégorie[/bold] : {model.category.value} / {model.subCategory.value}\n"
                f"• [bold]Rôle Stratégique[/bold] : [magenta]{model.strategicEvaluator.aiRole.value}[/magenta]"
                f"{evo_line}"
                f"{meta_line}",
                title=f"Inspection du Modèle de Carte — {model.cardId}",
                border_style="green",
            )
        )

        formatted_json = json.dumps(model.model_dump(mode="json"), ensure_ascii=False, indent=2)
        syntax = Syntax(formatted_json, "json", theme="monokai", line_numbers=True, word_wrap=True)
        console.print(syntax)


def _execute_stats_validation(target_ids: Optional[List[str]] = None) -> None:
    """Vérifie l'intégrité Pydantic de tous les fichiers JSON dans `data/compiled_cards/`."""
    data_dir = get_data_dir()
    compiled_dir = data_dir / "compiled_cards"
    json_files = sorted(compiled_dir.glob("*.json"))

    if target_ids is not None:
        target_set = set(target_ids)
        json_files = [f for f in json_files if f.stem in target_set]

    if not json_files:
        filter_hint = f" pour les {len(target_ids)} carte(s) ciblée(s)" if target_ids else ""
        console.print(
            f"[yellow]Aucun fichier JSON trouvé dans {compiled_dir}{filter_hint}.[/yellow]\n"
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
        dead_conds = [a.deadCardCondition for a in m.playableActions if a.deadCardCondition]
        summary_table.add_row(
            m.cardId,
            m.identity.nameFr,
            f"{m.category.value} / {m.subCategory.value}",
            m.strategicEvaluator.aiRole.value,
            str(len(m.playableActions)),
            str(len(m.strategicEvaluator.decklistSynergyRequirements)),
            str(len(dead_conds)),
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
    role_counts = Counter(m.strategicEvaluator.aiRole.value for m in valid_models)

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
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants TCGdex séparés par des virgules pour restreindre le comptage.",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes pour restreindre le comptage (déduplication automatique).",
    ),
    quiet: bool = typer.Option(
        False,
        "--quiet",
        "-q",
        help="Affiche uniquement le nombre entier de cartes (idéal pour les scripts bash).",
    ),
    details: bool = typer.Option(
        False,
        "--details",
        "-d",
        help="Affiche la liste détaillée des cartes avec leurs noms et métadonnées.",
    ),
    reasoned: bool = typer.Option(
        False,
        "--reasoned",
        "--reason",
        "-r",
        help="Prend en compte les cartes ayant déjà une analyse de raisonnement (Passe 1 dans data/reasoning_texts/) plutôt que compilées en JSON (Passe 2).",
    ),
) -> None:
    """Compte et résume le nombre de cartes Pokémon TCG compilées (`data/compiled_cards/`) ou raisonnées (`data/reasoning_texts/`)."""
    data_dir = get_data_dir()
    custom_ids = resolve_card_ids(ids=ids, ids_file=ids_file)
    if reasoned:
        target_dir = get_reasoning_texts_dir(data_dir)
    else:
        target_dir = data_dir / "compiled_cards"
    target_dir.mkdir(parents=True, exist_ok=True)
    json_files = sorted(target_dir.glob("*.json"))

    if custom_ids is not None:
        custom_ids_set = set(custom_ids)
        json_files = [f for f in json_files if f.stem in custom_ids_set]

    total_count = len(json_files)

    if quiet:
        console.print(str(total_count))
        return

    if reasoned:
        if total_count == 0:
            filter_hint = f" pour les {len(custom_ids)} carte(s) ciblée(s)" if custom_ids else ""
            console.print(
                f"[yellow]Aucune analyse de raisonnement trouvée dans [bold]{target_dir}[/bold]{filter_hint} (0 carte).[/yellow]\n"
                "Pour lancer l'analyse de raisonnement (Passe 1), exécutez : [cyan]python -m compiler.cli reason[/cyan]"
            )
            return

        models_counter: Counter[str] = Counter()
        cards_summary: List[Dict[str, str]] = []

        for fpath in json_files:
            card_id = fpath.stem
            card_name = "Inconnu"
            model_name = "—"
            backend = "—"
            tps = None
            tokens = None
            try:
                with open(fpath, "r", encoding="utf-8") as jf:
                    data = json.load(jf)
                    card_name = data.get("nameFr") or data.get("nameEn") or card_id
                    model_name = data.get("modelRepoId") or "—"
                    backend = data.get("modelBackend") or "—"
                    tps = data.get("tokensPerSecond")
                    tokens = data.get("completionTokens")
            except Exception:
                pass

            models_counter[model_name] += 1
            tps_str = f"{tps:.1f} t/s" if isinstance(tps, (int, float)) else "—"
            tok_str = str(tokens) if isinstance(tokens, int) else "—"
            cards_summary.append({
                "id": card_id,
                "name": card_name,
                "backend": backend,
                "model": model_name,
                "tps": tps_str,
                "tokens": tok_str,
            })

        models_str = ", ".join(f"[bold cyan]{cnt}[/bold cyan] via {m}" for m, cnt in models_counter.items())
        rem_hint = ""
        try:
            rem_summary = get_remaining_cards_summary(data_dir=data_dir, mode="standard", reasoned=True, custom_ids=custom_ids)
            rem_std = rem_summary["total_remaining"]
            tot_std = rem_summary["total_target"]
            prog_std = rem_summary["progress_pct"]
            if custom_ids is not None:
                rem_hint = f"\n• [bold]Restant à raisonner (sur {tot_std} ciblées)[/bold] : [bold yellow]{rem_std}[/bold yellow] / {tot_std} ({prog_std:.1f}% analysé)"
            else:
                rem_hint = f"\n• [bold]Restant à raisonner (Standard)[/bold] : [bold yellow]{rem_std}[/bold yellow] / {tot_std} ({prog_std:.1f}% analysé — commande 'remaining -r')"
        except Exception:
            pass

        target_display = f" / {len(custom_ids)}" if custom_ids else ""
        console.print(
            Panel.fit(
                f"• [bold]Cartes analysées sur le disque[/bold] : [bold green]{total_count}[/bold green]{target_display}\n"
                f"• [bold]Dossier de stockage[/bold] : [cyan]{target_dir}[/cyan]\n"
                f"• [bold]Modèles utilisés[/bold] : {models_str}"
                f"{rem_hint}",
                title="[bold cyan]Corpus de Cartes Raisonnées (Passe 1)[/bold cyan]",
                border_style="cyan",
            )
        )

        if details:
            table = Table(
                title=f"Détail des {total_count} Cartes Raisonnées (Passe 1)",
                header_style="bold cyan",
                show_lines=False,
            )
            table.add_column("ID", style="bold yellow")
            table.add_column("Nom", style="white")
            table.add_column("Backend", style="cyan")
            table.add_column("Modèle IA", style="magenta")
            table.add_column("Tokens", justify="right", style="white")
            table.add_column("Débit", style="green", justify="right")

            for c in cards_summary:
                table.add_row(c["id"], c["name"], c["backend"], c["model"], c["tokens"], c["tps"])

            console.print(table)
        return

    if total_count == 0:
        filter_hint = f" pour les {len(custom_ids)} carte(s) ciblée(s)" if custom_ids else ""
        console.print(
            f"[yellow]Aucune carte compilée trouvée dans [bold]{target_dir}[/bold]{filter_hint} (0 carte).[/yellow]\n"
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
                tps = meta.get("tokensPerSecond")
        except Exception:
            pass

        categories_counter[category] += 1
        tps_str = f"{tps:.1f} t/s" if isinstance(tps, (int, float)) else "—"
        cards_summary.append({
            "id": card_id,
            "name": card_name,
            "category": f"{category} / {sub_category}" if sub_category else category,
            "model": model_name,
            "tps": tps_str,
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
    db_status = ""
    if db_path.exists():
        if db_count < total_count:
            db_status = f" [bold yellow]({total_count - db_count} manquante(s) — exécutez 'sync')[/bold yellow]"
        else:
            db_status = " [bold green](à jour ✓)[/bold green]"
    db_line = f"\n• [bold]Base consolidée ([cyan]cards_database.json[/cyan])[/bold] : {db_count} carte(s){db_status}" if db_path.exists() else ""

    rem_hint = ""
    try:
        rem_summary = get_remaining_cards_summary(data_dir=data_dir, mode="standard", reasoned=False, custom_ids=custom_ids)
        rem_std = rem_summary["total_remaining"]
        tot_std = rem_summary["total_target"]
        prog_std = rem_summary["progress_pct"]
        if custom_ids is not None:
            rem_hint = f"\n• [bold]Restant à compiler (sur {tot_std} ciblées)[/bold] : [bold yellow]{rem_std}[/bold yellow] / {tot_std} ({prog_std:.1f}% compilé)"
        else:
            rem_hint = f"\n• [bold]Restant à compiler (Standard)[/bold] : [bold yellow]{rem_std}[/bold yellow] / {tot_std} ({prog_std:.1f}% compilé — commande 'remaining')"
    except Exception:
        pass

    target_display = f" / {len(custom_ids)}" if custom_ids else ""
    console.print(
        Panel.fit(
            f"• [bold]Cartes compilées sur le disque[/bold] : [bold green]{total_count}[/bold green]{target_display}\n"
            f"• [bold]Dossier de stockage[/bold] : [cyan]{target_dir}[/cyan]\n"
            f"• [bold]Répartition par catégorie[/bold] : {repartition_str}"
            f"{db_line}"
            f"{rem_hint}",
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
        table.add_column("Débit", style="green", justify="right")

        for c in cards_summary:
            table.add_row(c["id"], c["name"], c["category"], c["model"] or "—", c["tps"])

        console.print(table)


@app.command("stats")
def stats_command(
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants séparés par des virgules pour restreindre la validation Pydantic.",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes (déduplication automatique).",
    ),
) -> None:
    """Vérifie l'intégrité Pydantic de tous les fichiers JSON générés dans `data/compiled_cards/`."""
    custom_ids = resolve_card_ids(ids=ids, ids_file=ids_file)
    _execute_stats_validation(target_ids=custom_ids)


@app.command("validate", hidden=True)
def validate_alias(
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
) -> None:
    """Alias de la commande `stats`."""
    stats_command(ids=ids, ids_file=ids_file)


@app.command("sync")
def sync_command(
    db_path: Optional[Path] = typer.Option(
        None,
        "--db-path",
        "-p",
        help="Chemin vers le fichier JSON consolidé (défaut : data/cards_database.json).",
    ),
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants séparés par des virgules pour restreindre la synchronisation.",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants pour restreindre la synchronisation (déduplication automatique).",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        "-n",
        help="Simule la vérification sans modifier le fichier JSON.",
    ),
    details: bool = typer.Option(
        False,
        "--details",
        "-d",
        help="Affiche le tableau détaillé de toutes les cartes manquantes ajoutées.",
    ),
    force_update: bool = typer.Option(
        False,
        "--update",
        "-u",
        help="Met également à jour les cartes déjà présentes dans la base avec leur version disque la plus récente.",
    ),
) -> None:
    """Vérifie que toutes les cartes compilées dans `data/compiled_cards/` sont présentes dans le fichier JSON global (`data/cards_database.json`) et ajoute automatiquement celles manquantes."""
    data_dir = get_data_dir()
    target_db = db_path or (data_dir / "cards_database.json")
    custom_ids = resolve_card_ids(ids=ids, ids_file=ids_file)

    try:
        res = sync_cards_database(
            data_dir=data_dir,
            db_path=target_db,
            dry_run=dry_run,
            force_update=force_update,
            target_card_ids=custom_ids,
        )
    except Exception as e:
        console.print(f"[bold red]✗ Erreur lors de la synchronisation de la base :[/bold red] {e}")
        raise typer.Exit(code=1)

    total_disk = res["total_disk_cards"]
    initial_db = res["initial_db_cards"]
    added_ids = res["added_card_ids"]
    updated_ids = res["updated_card_ids"]
    corrupted_files = res["corrupted_files"]
    missing_on_disk = res["missing_on_disk_ids"]
    db_format = res["db_format"]
    disk_cards = res["disk_cards"]

    format_labels = {
        "list": "Tableau JSON standard (liste)",
        "dict_cards_dict": "Objet consolidé (dictionnaire 'cards')",
        "dict_cards_list": "Objet consolidé (liste 'cards')",
        "dict_raw": "Dictionnaire brut indexé par ID",
    }
    format_label = format_labels.get(db_format, db_format)

    status_color = "yellow" if added_ids else "green"
    sim_suffix = " (simulation non enregistrée)" if dry_run and added_ids else ""

    target_info = f" (sur {len(custom_ids)} ciblées)" if custom_ids else ""
    console.print(
        Panel.fit(
            f"• [bold]Cartes compilées sur le disque{target_info}[/bold] : [bold green]{total_disk}[/bold green]\n"
            f"• [bold]Fichier global cible[/bold] : [cyan]{target_db}[/cyan]\n"
            f"• [bold]Cartes déjà présentes dans la base[/bold] : [bold cyan]{initial_db}[/bold cyan]\n"
            f"• [bold]Cartes manquantes détectées[/bold] : [bold {status_color}]{len(added_ids)}[/bold {status_color}]{sim_suffix}\n"
            + (f"• [bold]Cartes mises à jour[/bold] : [bold blue]{len(updated_ids)}[/bold blue]\n" if force_update else "")
            + f"• [bold]Format du fichier JSON[/bold] : {format_label}",
            title="[bold green]Vérification & Synchronisation de la Base de Cartes[/bold green]",
            border_style="green" if not added_ids and not corrupted_files else "yellow",
        )
    )

    if corrupted_files:
        console.print(
            f"[bold yellow]⚠️ {len(corrupted_files)} fichier(s) JSON invalide(s) ignoré(s) dans data/compiled_cards/ :[/bold yellow] "
            f"{', '.join(f[0] for f in corrupted_files[:5])}"
            + ("..." if len(corrupted_files) > 5 else "")
        )

    if added_ids:
        if dry_run:
            console.print(
                f"[bold yellow]Mode simulation (--dry-run) : {len(added_ids)} carte(s) seraient ajoutées à [cyan]{target_db}[/cyan].[/bold yellow]"
            )
        else:
            console.print(
                f"[bold green]✓ {len(added_ids)} carte(s) manquante(s) ont été automatiquement ajoutées à [bold cyan]{target_db}[/bold cyan] ![/bold green]"
            )

        if details or len(added_ids) <= 30:
            table = Table(
                title=f"Cartes Manquantes {'Identifiées' if dry_run else 'Ajoutées'} ({len(added_ids)})",
                header_style="bold cyan",
                show_lines=False,
            )
            table.add_column("ID", style="bold yellow")
            table.add_column("Nom", style="white")
            table.add_column("Catégorie", style="cyan")
            table.add_column("Statut", style="green" if not dry_run else "yellow")

            for cid in added_ids:
                cdata = disk_cards.get(cid, {})
                ident = cdata.get("identity") or {}
                cname = ident.get("nameFr") or ident.get("nameEn") or cid
                cat = cdata.get("category", "")
                subcat = cdata.get("subCategory", "")
                cat_display = f"{cat} / {subcat}" if subcat else cat
                status = "Ajoutée ✓" if not dry_run else "À ajouter (dry-run)"
                table.add_row(cid, cname, cat_display, status)

            console.print(table)
    elif not force_update or not updated_ids:
        console.print(
            f"[bold green]✓ Parfait ! Toutes les cartes compilées ({total_disk}) sont déjà présentes dans [cyan]{target_db}[/cyan]. Aucune carte à ajouter.[/bold green]"
        )

    if missing_on_disk:
        console.print(
            f"[dim]ℹ Note : {len(missing_on_disk)} carte(s) présente(s) dans {target_db.name} n'ont pas de fichier individuel correspondant dans compiled_cards/.[/dim]"
        )


@app.command("sync-database", hidden=True)
def sync_database_alias(
    db_path: Optional[Path] = typer.Option(None, "--db-path", "-p"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    dry_run: bool = typer.Option(False, "--dry-run", "-n"),
    details: bool = typer.Option(False, "--details", "-d"),
    force_update: bool = typer.Option(False, "--update", "-u"),
) -> None:
    """Alias de la commande `sync`."""
    sync_command(db_path=db_path, ids=ids, ids_file=ids_file, dry_run=dry_run, details=details, force_update=force_update)


@app.command("check-database", hidden=True)
def check_database_alias(
    db_path: Optional[Path] = typer.Option(None, "--db-path", "-p"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    dry_run: bool = typer.Option(False, "--dry-run", "-n"),
    details: bool = typer.Option(False, "--details", "-d"),
    force_update: bool = typer.Option(False, "--update", "-u"),
) -> None:
    """Alias de la commande `sync`."""
    sync_command(db_path=db_path, ids=ids, ids_file=ids_file, dry_run=dry_run, details=details, force_update=force_update)


@app.command("sync-db", hidden=True)
def sync_db_alias(
    db_path: Optional[Path] = typer.Option(None, "--db-path", "-p"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    dry_run: bool = typer.Option(False, "--dry-run", "-n"),
    details: bool = typer.Option(False, "--details", "-d"),
    force_update: bool = typer.Option(False, "--update", "-u"),
) -> None:
    """Alias de la commande `sync`."""
    sync_command(db_path=db_path, ids=ids, ids_file=ids_file, dry_run=dry_run, details=details, force_update=force_update)


@app.command("remaining")
def remaining_command(
    mode: str = typer.Option(
        "standard",
        "--mode",
        "-m",
        help="Mode de filtrage des cartes cibles : 'standard' (défaut), 'test', ou 'all'.",
    ),
    set_name: Optional[str] = typer.Option(
        None,
        "--set",
        "-s",
        help="Filtre sur une extension spécifique (ex: 'sv01', 'sv05', 'sve').",
    ),
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants spécifiques séparés par des virgules pour restreindre le périmètre.",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes (un par ligne, déduplication automatique).",
    ),
    reasoned: bool = typer.Option(
        False,
        "--reasoned",
        "--reason",
        "-r",
        help="Prend en compte les cartes ayant déjà une analyse de raisonnement (Passe 1 dans data/reasoning_texts/) plutôt que compilées en JSON (Passe 2).",
    ),
    details: bool = typer.Option(
        False,
        "--details",
        "-d",
        help="Affiche la liste complète des identifiants (IDs) des cartes restant à compiler/analyser.",
    ),
    quiet: bool = typer.Option(
        False,
        "--quiet",
        "-q",
        help="Affiche uniquement le nombre entier de cartes restant à compiler/analyser (idéal pour scripts bash).",
    ),
) -> None:
    """Calcule et affiche le nombre de cartes Pokémon TCG restant à compiler ou à raisonner (globalement ou par extension)."""
    data_dir = get_data_dir()
    custom_ids = resolve_card_ids(ids=ids, ids_file=ids_file)
    try:
        summary = get_remaining_cards_summary(
            data_dir=data_dir,
            mode=mode,
            set_filter=set_name,
            reasoned=reasoned,
            custom_ids=custom_ids,
        )
    except Exception as e:
        console.print(f"[bold red]✗ Erreur lors du calcul des cartes restantes :[/bold red] {e}")
        raise typer.Exit(code=1)

    total_remaining = summary["total_remaining"]
    if quiet:
        console.print(str(total_remaining))
        return

    total_target = summary["total_target"]
    total_compiled = summary["total_compiled"]
    progress_pct = summary["progress_pct"]
    by_set = summary["by_set"]
    remaining_ids = summary["remaining_ids"]

    if custom_ids is not None:
        mode_label = f"Liste personnalisée ({total_target} carte(s) unique(s))"
    elif set_name:
        mode_label = f"Extension spécifique ({set_name.upper()})"
    elif mode == "standard":
        mode_label = "Standard (format légal officiel legal.standard=true)"
    elif mode == "test":
        mode_label = f"Test ({len(TEST_CARD_IDS)} cartes)"
    else:
        mode_label = "Total TCGdex global"

    rem_color = "bold green" if total_remaining == 0 else "bold yellow"
    prog_color = "bold green" if progress_pct >= 100.0 else ("bold cyan" if progress_pct >= 50.0 else "bold yellow")

    panel_title = "[bold cyan]État d'Avancement du Raisonnement Pokémon TCG (Passe 1)[/bold cyan]" if reasoned else "[bold cyan]État d'Avancement de la Compilation Pokémon TCG[/bold cyan]"
    action_done = "déjà analysées (Passe 1)" if reasoned else "déjà compilées"
    action_rem = "analyser en Passe 1" if reasoned else "compiler"
    storage_type = "analyses textuelles" if reasoned else "cartes compilées"

    console.print(
        Panel.fit(
            f"• [bold]Périmètre analysé[/bold] : [cyan]{mode_label}[/cyan]\n"
            f"• [bold]Total de cartes cibles[/bold] : [bold white]{total_target}[/bold white]\n"
            f"• [bold]Cartes {action_done}[/bold] : [bold green]{total_compiled}[/bold green] ([{prog_color}]{progress_pct:.1f}%[/{prog_color}])\n"
            f"• [bold]Cartes restant à {action_rem}[/bold] : [{rem_color}]{total_remaining}[/{rem_color}] ([dim]{100.0 - progress_pct:.1f}% restant[/dim])\n"
            f"• [bold]Total de {storage_type} sur le disque[/bold] : [dim]{summary['total_disk_compiled']} carte(s)[/dim]",
            title=panel_title,
            border_style="green" if total_remaining == 0 else "cyan",
        )
    )

    # Affichage du tableau de progression par set si plusieurs sets sont concernés
    if len(by_set) > 1:
        table = Table(
            title=f"Progression par Extension ({len(by_set)} sets)",
            header_style="bold cyan",
            show_lines=False,
        )
        table.add_column("Set", style="bold cyan")
        table.add_column("Nom de l'Extension", style="white")
        table.add_column("Raisonnées" if reasoned else "Compilées", justify="right", style="green")
        table.add_column("Total", justify="right", style="white")
        table.add_column("Avancement", justify="right")
        table.add_column("Restantes", justify="right", style="bold yellow")

        for s_code in sorted(by_set.keys()):
            s_data = by_set[s_code]
            pct = s_data["progress_pct"]
            rem = s_data["remaining"]
            pct_str = f"[bold green]{pct:5.1f}% ✓[/bold green]" if rem == 0 else (
                f"[bold cyan]{pct:5.1f}%[/bold cyan]" if pct >= 50.0 else (
                    f"[yellow]{pct:5.1f}%[/yellow]" if pct > 0 else "[red]  0.0%[/red]"
                )
            )
            rem_str = "[bold green]0[/bold green]" if rem == 0 else f"[bold yellow]{rem}[/bold yellow]"
            table.add_row(
                s_data["set_code"],
                s_data["set_name"],
                str(s_data["compiled"]),
                str(s_data["total"]),
                pct_str,
                rem_str,
            )

        console.print(table)

    if details and remaining_ids:
        console.print(f"\n[bold yellow]Liste des {len(remaining_ids)} cartes restant à {action_rem} :[/bold yellow]")
        chunks = [remaining_ids[i:i + 12] for i in range(0, min(len(remaining_ids), 120), 12)]
        for chunk in chunks:
            console.print("  " + ", ".join(f"[cyan]{cid}[/cyan]" for cid in chunk))
        if len(remaining_ids) > 120:
            console.print(f"  [dim]... et {len(remaining_ids) - 120} autre(s) carte(s)[/dim]")

    if total_remaining == 0:
        if reasoned:
            console.print(f"\n[bold green]🎉 Félicitations ! Toutes les cartes de ce périmètre ({total_target}) sont déjà raisonnées (Passe 1) ![/bold green]")
            console.print("[dim]👉 Vous pouvez lancer la Passe 2 de codage JSON avec : python -m compiler.cli code[/dim]")
        else:
            console.print(f"\n[bold green]🎉 Félicitations ! Toutes les cartes de ce périmètre ({total_target}) sont déjà compilées ![/bold green]")
    else:
        if reasoned:
            cmd_hint = (
                f"python -m compiler.cli reason --ids {','.join(remaining_ids[:3])}"
                if len(remaining_ids) <= 3
                else ("python -m compiler.cli reason -f <fichier>" if custom_ids else ("python -m compiler.cli reason" if mode == "standard" and not set_name else f"python -m compiler.cli reason --mode {mode}"))
            )
            console.print(f"\n[dim]💡 Pour analyser les cartes restantes en Passe 1 :[/dim] [cyan]{cmd_hint}[/cyan]")
        else:
            cmd_hint = (
                f"python -m compiler.cli run --ids {','.join(remaining_ids[:3])}"
                if len(remaining_ids) <= 3
                else ("python -m compiler.cli run -f <fichier>" if custom_ids else ("python -m compiler.cli run --mode standard" if mode == "standard" and not set_name else f"python -m compiler.cli run --mode {mode}"))
            )
            console.print(f"\n[dim]💡 Pour compiler les cartes restantes :[/dim] [cyan]{cmd_hint}[/cyan]")


@app.command("todo", hidden=True)
def todo_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    reasoned: bool = typer.Option(False, "--reasoned", "--reason", "-r"),
    details: bool = typer.Option(False, "--details", "-d"),
    quiet: bool = typer.Option(False, "--quiet", "-q"),
) -> None:
    """Alias de la commande `remaining`."""
    remaining_command(mode=mode, set_name=set_name, ids=ids, ids_file=ids_file, reasoned=reasoned, details=details, quiet=quiet)


@app.command("left", hidden=True)
def left_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    reasoned: bool = typer.Option(False, "--reasoned", "--reason", "-r"),
    details: bool = typer.Option(False, "--details", "-d"),
    quiet: bool = typer.Option(False, "--quiet", "-q"),
) -> None:
    """Alias de la commande `remaining`."""
    remaining_command(mode=mode, set_name=set_name, ids=ids, ids_file=ids_file, reasoned=reasoned, details=details, quiet=quiet)


@app.command("pending", hidden=True)
def pending_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    reasoned: bool = typer.Option(False, "--reasoned", "--reason", "-r"),
    details: bool = typer.Option(False, "--details", "-d"),
    quiet: bool = typer.Option(False, "--quiet", "-q"),
) -> None:
    """Alias de la commande `remaining`."""
    remaining_command(mode=mode, set_name=set_name, ids=ids, ids_file=ids_file, reasoned=reasoned, details=details, quiet=quiet)


@app.command("a-compiler", hidden=True)
def a_compiler_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    set_name: Optional[str] = typer.Option(None, "--set", "-s"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    reasoned: bool = typer.Option(False, "--reasoned", "--reason", "-r"),
    details: bool = typer.Option(False, "--details", "-d"),
    quiet: bool = typer.Option(False, "--quiet", "-q"),
) -> None:
    """Alias de la commande `remaining`."""
    remaining_command(mode=mode, set_name=set_name, ids=ids, ids_file=ids_file, reasoned=reasoned, details=details, quiet=quiet)


@app.command("fetch-cards")
def fetch_cards_command(
    mode: str = typer.Option(
        "standard",
        "--mode",
        "-m",
        help="Type de cartes à récupérer : 'standard' (défaut, cartes légales format Standard via legal.standard=true) ou 'all' (index global de toutes les cartes historiques).",
    ),
    standard_flag: bool = typer.Option(
        False,
        "--standard",
        help="Raccourci pour forcer la récupération de la liste Standard.",
    ),
    all_flag: bool = typer.Option(
        False,
        "--all",
        help="Raccourci pour récupérer l'index global de toutes les cartes historiques TCGdex.",
    ),
    raw: bool = typer.Option(
        False,
        "--raw",
        "--download-raw",
        "--cache-raw",
        help="Télécharge et enregistre chaque fiche détaillée de carte dans le cache brut 'raw_tcgdex' (data/raw_tcgdex/{card_id}.json).",
    ),
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants précis séparés par des virgules à télécharger dans raw_tcgdex.",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes (un par ligne, déduplication automatique).",
    ),
    limit: Optional[int] = typer.Option(
        None,
        "--limit",
        "-l",
        help="Nombre maximum de cartes à télécharger dans raw_tcgdex.",
    ),
    concurrency: int = typer.Option(
        5,
        "--concurrency",
        "-j",
        help="Nombre de téléchargements simultanés (requêtes réseau parallèles).",
    ),
    provider: FetcherProvider = typer.Option(
        FetcherProvider.sdk,
        "--provider",
        "-p",
        envvar=["TCGDEX_PROVIDER"],
        help="Fournisseur d'accès TCGdex : 'sdk' (SDK Python officiel tcgdex-sdk par défaut) ou 'rest' (API HTTP directe httpx).",
    ),
    force: bool = typer.Option(
        True,
        "--force/--no-force",
        help="Force le re-téléchargement et écrase le fichier cache existant (True par défaut pour l'index).",
    ),
    force_raw: bool = typer.Option(
        False,
        "--force-raw",
        help="Force le re-téléchargement des fiches individuelles même si data/raw_tcgdex/{card_id}.json existe déjà sur le disque.",
    ),
) -> None:
    """Récupère et met à jour depuis l'API TCGdex la liste officielle des cartes (Standard légales ou index global) et télécharge les fiches détaillées dans raw_tcgdex."""
    data_dir = get_data_dir()
    fetcher = TCGdexFetcher(data_dir=data_dir, provider=provider)
    effective_mode = "all" if all_flag else ("standard" if standard_flag else mode.lower().strip())

    headers = {
        "Accept": "application/json",
        "User-Agent": "pokemon-tcg-card-compiler/0.1.0",
    }

    # Si l'utilisateur fournit des IDs spécifiques ou un fichier d'IDs, on active automatiquement le mode raw
    explicit_ids = resolve_card_ids(ids=ids, ids_file=ids_file)
    effective_raw = raw or (explicit_ids is not None and len(explicit_ids) > 0)

    # 1. Récupération / Mise à jour de l'index si nécessaire (mode global ou Standard)
    cards: List[Dict[str, Any]] = []
    distinct_ids: List[str] = []

    if explicit_ids is None:
        if effective_mode == "all":
            with console.status(f"[bold blue]Téléchargement de l'index global TCGdex via {provider.value.upper()}...[/bold blue]"):
                async def _fetch():
                    async with httpx.AsyncClient(timeout=fetcher.timeout_seconds, headers=headers) as client:
                        return await fetcher.fetch_cards_index(client, force=force)
                cards = asyncio.run(_fetch())

            target_file = fetcher.index_path
            title = "[bold cyan]Mise à Jour de l'Index Global TCGdex[/bold cyan]"
            desc = "Total de cartes historiques répertoriées"
        else:
            with console.status(f"[bold blue]Téléchargement des cartes légales Standard (legal.standard=true) via {provider.value.upper()}...[/bold blue]"):
                async def _fetch_std():
                    async with httpx.AsyncClient(timeout=fetcher.timeout_seconds, headers=headers) as client:
                        return await fetcher.fetch_standard_cards_index(client, force=force)
                cards = asyncio.run(_fetch_std())

            target_file = fetcher.standard_index_path
            title = "[bold green]Mise à Jour de la Liste Standard TCGdex (legal.standard=true)[/bold green]"
            desc = "Cartes légales au format Standard"

        total_cards = len(cards)
        distinct_ids = list(dict.fromkeys(str(c.get("id")).strip() for c in cards if isinstance(c, dict) and c.get("id")))

        # Ventilation par set
        by_set: Counter[str] = Counter()
        for cid in distinct_ids:
            prefix = cid.split("-")[0].lower() if "-" in cid else "autres"
            by_set[prefix] += 1

        console.print(
            Panel.fit(
                f"• [bold]{desc}[/bold] : [bold green]{len(distinct_ids)}[/bold green] (fiches brutes : {total_cards})\n"
                f"• [bold]Nombre d'extensions représentées[/bold] : [bold cyan]{len(by_set)}[/bold cyan] sets\n"
                f"• [bold]Fournisseur utilisé[/bold] : [magenta]{provider.value.upper()}[/magenta] ({'SDK officiel tcgdex-sdk' if provider == FetcherProvider.sdk else 'HTTP REST httpx'})\n"
                f"• [bold]Fichier de cache enregistré[/bold] : [cyan]{target_file}[/cyan]",
                title=title,
                border_style="green",
            )
        )

        if by_set and not effective_raw:
            table = Table(
                title=f"Répartition par Extension ({len(by_set)} sets répertoriés)",
                header_style="bold cyan",
                show_lines=False,
            )
            table.add_column("Code Set", style="bold yellow")
            table.add_column("Nom de l'Extension", style="white")
            table.add_column("Nombre de Cartes", justify="right", style="green")

            for s_code, cnt in by_set.most_common(25):
                s_name = SV_SET_NAMES.get(s_code, s_code.upper())
                table.add_row(s_code, s_name, str(cnt))

            if len(by_set) > 25:
                table.add_row("...", f"et {len(by_set) - 25} autre(s) extension(s)", "...")

            console.print(table)
    else:
        distinct_ids = explicit_ids

    # 2. Si option --raw demandée (ou IDs spécifiques), télécharger les fiches individuelles dans data/raw_tcgdex/{id}.json
    if effective_raw:
        target_raw_ids = explicit_ids if explicit_ids is not None else distinct_ids
        if limit is not None and limit > 0:
            target_raw_ids = target_raw_ids[:limit]

        already_cached_initial = sum(1 for cid in target_raw_ids if (fetcher.raw_dir / f"{cid}.json").exists())
        to_download_est = len(target_raw_ids) - already_cached_initial if not force_raw else len(target_raw_ids)

        console.print(
            f"\n[bold cyan]⚡ Téléchargement des fiches détaillées dans [yellow]{fetcher.raw_dir}/[/yellow] "
            f"({len(target_raw_ids)} carte(s) ciblée(s), ~{to_download_est} à télécharger, {already_cached_initial} déjà en cache)...[/bold cyan]"
        )

        with Progress(
            SpinnerColumn(),
            TextColumn("[progress.description]{task.description}"),
            BarColumn(),
            MofNCompleteColumn(),
            TimeElapsedColumn(),
            TimeRemainingColumn(),
            console=console,
        ) as progress:
            task_id = progress.add_task("[cyan]Mise en cache raw_tcgdex...", total=len(target_raw_ids))

            def on_progress(cid: str, cname: str, newly_downloaded: bool, err_msg: Optional[str]) -> None:
                if err_msg:
                    status_lbl = f"[bold red]ÉCHEC ({err_msg})[/bold red]"
                elif newly_downloaded:
                    status_lbl = f"[bold green]Téléchargée ✓[/bold green]"
                else:
                    status_lbl = f"[dim blue]En cache[/dim blue]"
                progress.update(
                    task_id,
                    advance=1,
                    description=f"[cyan]Fiche [bold]{cid}[/bold] ({cname[:20]}) : {status_lbl}",
                )

            async def _do_download():
                return await fetcher.download_raw_cards(
                    card_ids=target_raw_ids,
                    force=force_raw,
                    concurrency=concurrency,
                    progress_callback=on_progress,
                )

            stats = asyncio.run(_do_download())

        speed = stats["downloaded"] / stats["elapsed_seconds"] if stats["elapsed_seconds"] > 0 else 0
        fail_style = "bold red" if stats["failed"] > 0 else "bold green"
        console.print(
            Panel.fit(
                f"• [bold]Cartes ciblées[/bold] : [bold]{stats['total']}[/bold]\n"
                f"• [bold]Nouvelles fiches téléchargées[/bold] : [bold green]{stats['downloaded']}[/bold green]"
                + (f" ({speed:.1f} cartes/s)" if stats["downloaded"] > 0 else "") + "\n"
                f"• [bold]Fiches déjà en cache (réutilisées)[/bold] : [bold blue]{stats['cached']}[/bold blue]\n"
                f"• [bold]Échecs de téléchargement[/bold] : [{fail_style}]{stats['failed']}[/{fail_style}]\n"
                f"• [bold]Temps total d'exécution[/bold] : [cyan]{stats['elapsed_seconds']:.2f}s[/cyan]\n"
                f"• [bold]Répertoire de stockage[/bold] : [cyan]{fetcher.raw_dir}[/cyan]",
                title="[bold green]✓ Mise à Jour du Cache raw_tcgdex Terminée[/bold green]",
                border_style="green",
            )
        )

        if stats["failed_cards"]:
            err_table = Table(title="Détail des Cartes en Échec", style="red")
            err_table.add_column("ID Carte", style="bold yellow")
            err_table.add_column("Détail de l'Erreur", style="white")
            for cid, emsg in list(stats["failed_cards"].items())[:20]:
                err_table.add_row(cid, emsg)
            console.print(err_table)
    else:
        console.print(
            "\n[dim]💡 Astuce : Pour télécharger également les fiches détaillées de chaque carte dans data/raw_tcgdex/{id}.json,\n"
            "   ajoutez l'option [cyan]--raw[/cyan] (ex: [cyan]python -m compiler.cli fetch-cards --raw[/cyan] ou [cyan]-f data/target_ids.txt[/cyan]).[/dim]"
        )


@app.command("update-cards")
def update_cards_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    standard_flag: bool = typer.Option(False, "--standard"),
    all_flag: bool = typer.Option(False, "--all"),
    raw: bool = typer.Option(False, "--raw", "--download-raw", "--cache-raw"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    limit: Optional[int] = typer.Option(None, "--limit", "-l"),
    concurrency: int = typer.Option(5, "--concurrency", "-j"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    force: bool = typer.Option(True, "--force/--no-force"),
    force_raw: bool = typer.Option(False, "--force-raw"),
) -> None:
    """Alias de la commande `fetch-cards` : met à jour la liste officielle des cartes."""
    fetch_cards_command(
        mode=mode,
        standard_flag=standard_flag,
        all_flag=all_flag,
        raw=raw,
        ids=ids,
        ids_file=ids_file,
        limit=limit,
        concurrency=concurrency,
        provider=provider,
        force=force,
        force_raw=force_raw,
    )


@app.command("fetch-raw")
def fetch_raw_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    standard_flag: bool = typer.Option(False, "--standard"),
    all_flag: bool = typer.Option(False, "--all"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    limit: Optional[int] = typer.Option(None, "--limit", "-l"),
    concurrency: int = typer.Option(5, "--concurrency", "-j"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    force: bool = typer.Option(True, "--force/--no-force"),
    force_raw: bool = typer.Option(False, "--force-raw"),
) -> None:
    """Télécharge directement les fiches détaillées dans data/raw_tcgdex/{card_id}.json."""
    fetch_cards_command(
        mode=mode,
        standard_flag=standard_flag,
        all_flag=all_flag,
        raw=True,
        ids=ids,
        ids_file=ids_file,
        limit=limit,
        concurrency=concurrency,
        provider=provider,
        force=force,
        force_raw=force_raw,
    )


@app.command("cache-raw", hidden=True)
def cache_raw_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    standard_flag: bool = typer.Option(False, "--standard"),
    all_flag: bool = typer.Option(False, "--all"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    limit: Optional[int] = typer.Option(None, "--limit", "-l"),
    concurrency: int = typer.Option(5, "--concurrency", "-j"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    force: bool = typer.Option(True, "--force/--no-force"),
    force_raw: bool = typer.Option(False, "--force-raw"),
) -> None:
    """Alias de `fetch-raw`."""
    fetch_cards_command(
        mode=mode,
        standard_flag=standard_flag,
        all_flag=all_flag,
        raw=True,
        ids=ids,
        ids_file=ids_file,
        limit=limit,
        concurrency=concurrency,
        provider=provider,
        force=force,
        force_raw=force_raw,
    )


@app.command("refresh-cards", hidden=True)
def refresh_cards_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    standard_flag: bool = typer.Option(False, "--standard"),
    all_flag: bool = typer.Option(False, "--all"),
    raw: bool = typer.Option(False, "--raw", "--download-raw", "--cache-raw"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    limit: Optional[int] = typer.Option(None, "--limit", "-l"),
    concurrency: int = typer.Option(5, "--concurrency", "-j"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    force: bool = typer.Option(True, "--force/--no-force"),
    force_raw: bool = typer.Option(False, "--force-raw"),
) -> None:
    """Alias de la commande `fetch-cards`."""
    fetch_cards_command(
        mode=mode,
        standard_flag=standard_flag,
        all_flag=all_flag,
        raw=raw,
        ids=ids,
        ids_file=ids_file,
        limit=limit,
        concurrency=concurrency,
        provider=provider,
        force=force,
        force_raw=force_raw,
    )


@app.command("fetch-index", hidden=True)
def fetch_index_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    standard_flag: bool = typer.Option(False, "--standard"),
    all_flag: bool = typer.Option(False, "--all"),
    raw: bool = typer.Option(False, "--raw", "--download-raw", "--cache-raw"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    limit: Optional[int] = typer.Option(None, "--limit", "-l"),
    concurrency: int = typer.Option(5, "--concurrency", "-j"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    force: bool = typer.Option(True, "--force/--no-force"),
    force_raw: bool = typer.Option(False, "--force-raw"),
) -> None:
    """Alias de la commande `fetch-cards`."""
    fetch_cards_command(
        mode=mode,
        standard_flag=standard_flag,
        all_flag=all_flag,
        raw=raw,
        ids=ids,
        ids_file=ids_file,
        limit=limit,
        concurrency=concurrency,
        provider=provider,
        force=force,
        force_raw=force_raw,
    )


@app.command("update-index", hidden=True)
def update_index_alias(
    mode: str = typer.Option("standard", "--mode", "-m"),
    standard_flag: bool = typer.Option(False, "--standard"),
    all_flag: bool = typer.Option(False, "--all"),
    raw: bool = typer.Option(False, "--raw", "--download-raw", "--cache-raw"),
    ids: Optional[str] = typer.Option(None, "--ids"),
    ids_file: Optional[Path] = typer.Option(None, "--ids-file", "-f"),
    limit: Optional[int] = typer.Option(None, "--limit", "-l"),
    concurrency: int = typer.Option(5, "--concurrency", "-j"),
    provider: FetcherProvider = typer.Option(FetcherProvider.sdk, "--provider", "-p"),
    force: bool = typer.Option(True, "--force/--no-force"),
    force_raw: bool = typer.Option(False, "--force-raw"),
) -> None:
    """Alias de la commande `fetch-cards`."""
    fetch_cards_command(
        mode=mode,
        standard_flag=standard_flag,
        all_flag=all_flag,
        raw=raw,
        ids=ids,
        ids_file=ids_file,
        limit=limit,
        concurrency=concurrency,
        provider=provider,
        force=force,
        force_raw=force_raw,
    )


@app.command("repair-compiled")
def repair_compiled_command(
    ids: Optional[str] = typer.Option(
        None,
        "--ids",
        help="Liste d'identifiants séparés par des virgules pour restreindre la réparation.",
    ),
    ids_file: Optional[Path] = typer.Option(
        None,
        "--ids-file",
        "-f",
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        "-n",
        help="Simule la réparation sans modifier les fichiers JSON.",
    ),
) -> None:
    """Répare déterministiquement toutes les cartes compilées (`data/compiled_cards/*.json`), met à jour `cards_database.json` et génère `data/cards_to_recompile_llm.txt`."""
    data_dir = get_data_dir()
    custom_ids = resolve_card_ids(ids=ids, ids_file=ids_file)

    with console.status("[bold cyan]Réparation déterministe du corpus en cours...[/bold cyan]"):
        res = repair_compiled_corpus(
            data_dir=data_dir,
            target_ids=custom_ids,
            dry_run=dry_run,
        )

    sim_note = " (simulation --dry-run)" if dry_run else ""
    console.print(
        Panel.fit(
            f"• [bold]Cartes traitées[/bold] : [bold white]{res['total_processed']}[/bold white]\n"
            f"• [bold]Cartes réparées/validées[/bold] : [bold green]{res['repaired_count']}[/bold green]\n"
            f"• [bold]Fichiers modifiés[/bold] : [bold cyan]{res['modified_count']}[/bold cyan]{sim_note}\n"
            f"• [bold]Anciennes cartes listées pour Passe 2 LLM[/bold] : [bold yellow]{res['legacy_recompile_count']}[/bold yellow] ([cyan]{res['recompile_file']}[/cyan])\n"
            f"• [bold]Base consolidée[/bold] : [cyan]{res['db_path']}[/cyan]\n"
            f"• [bold]Erreurs[/bold] : [{'bold red' if res['errors'] else 'bold green'}]{len(res['errors'])}[/{'bold red' if res['errors'] else 'bold green'}]",
            title="[bold green]Réparation Déterministe du Corpus Standard[/bold green]",
            border_style="green" if not res["errors"] else "red",
        )
    )

    if res["errors"]:
        for cid, msg in res["errors"][:15]:
            console.print(f"[red]✗ {cid} : {msg}[/red]")
        raise typer.Exit(code=1)


if __name__ == "__main__":
    app()
