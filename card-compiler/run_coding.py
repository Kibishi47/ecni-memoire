#!/usr/bin/env python3
"""Script autonome d'exécution de la Passe 2 (Codage JSON Formel) - Two-Pass Pipeline.

Ce script :
1. Charge l'IA de coding (ex: Qwen2.5-Coder 7B ou 14B) en mémoire unifiée (Apple MLX ou llama.cpp).
2. Lit les analyses de règles préalablement générées par la Passe 1 (`data/reasoning_texts/{card_id}.json`).
3. Compile chaque carte en modèle formel JSON déterministe (`data/compiled_cards/{card_id}.json`).
4. Met à jour et synchronise la base de données consolidée `data/cards_database.json`.
5. Décharge intégralement l'IA de coding de la mémoire à la fin.

Exemples d'utilisation :
  python run_coding.py
  python run_coding.py --ids sv08.5-001,sv04-125
  python run_coding.py --standard --limit 50
  python run_coding.py --intensity intense
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path

# Ajout du dossier courant au PYTHONPATH
PROJECT_DIR = Path(__file__).resolve().parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from rich.console import Console

from compiler import load_env_file
from compiler.cli import get_data_dir, rebuild_consolidated_database, resolve_card_ids
from compiler.models_config import IntensityMode, normalize_intensity_mode
from compiler.tcgdex_fetcher import FetcherProvider, TCGdexFetcher
from compiler.two_pass_pipeline import run_coding_phase

console = Console()


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(
        description="Passe 2 : Transformation des analyses textuelles en code JSON formel Pokémon TCG",
        formatter_class=argparse.ArgumentDefaultsHelpFormatter,
    )
    parser.add_argument(
        "--mode",
        choices=["test", "standard"],
        default=os.environ.get("RUN_MODE", "test"),
        help="Mode d'exécution : 'test' (11 cartes de référence) ou 'standard'.",
    )
    parser.add_argument(
        "--test",
        action="store_true",
        help="Raccourci pour forcer le mode test.",
    )
    parser.add_argument(
        "--standard",
        action="store_true",
        help="Raccourci pour forcer le mode standard.",
    )
    parser.add_argument(
        "--ids",
        type=str,
        default=None,
        help="Identifiants spécifiques de cartes séparés par des virgules (ex: sv08.5-001,sv04-125).",
    )
    parser.add_argument(
        "-f",
        "--ids-file",
        type=str,
        default=None,
        help="Chemin vers un fichier texte contenant une liste d'identifiants de cartes ligne par ligne (déduplication automatique).",
    )
    parser.add_argument(
        "--intensity",
        choices=["soft", "intense"],
        default=os.environ.get("INTENSITY_MODE", "soft"),
        help="Niveau de puissance : 'soft' (défaut, 7B 8-bit) ou 'intense' (14B 8-bit).",
    )
    parser.add_argument(
        "--backend",
        choices=["mlx", "llama_cpp"],
        default=os.environ.get("LOCAL_BACKEND", "mlx"),
        help="Backend d'exécution locale ('mlx' natif Apple Silicon ou 'llama_cpp' GGUF Metal).",
    )
    parser.add_argument(
        "--model",
        type=str,
        default=os.environ.get("CODING_MODEL", os.environ.get("LLM_MODEL")),
        help="Modèle de coding personnalisé (écrase la sélection automatique).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force la recompilation même si la carte JSON existe déjà dans data/compiled_cards/.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limite de cartes à traiter en mode standard.",
    )
    parser.add_argument(
        "-k",
        "--continue-on-error",
        action="store_true",
        default=os.environ.get("CONTINUE_ON_ERROR", "false").lower() in {"1", "true", "yes"},
        help="Passe à la carte suivante en cas d'erreur.",
    )
    parser.add_argument(
        "-bs",
        "--batch-size",
        type=int,
        default=None,
        help="Taille de lot MLX pour le parallélisme continu (défaut: MLX_BATCH_SIZE ou 4).",
    )

    args = parser.parse_args()

    effective_mode = "standard" if args.standard else ("test" if args.test else args.mode)
    custom_ids = resolve_card_ids(ids=args.ids, ids_file=args.ids_file)
    data_dir = get_data_dir()

    fetcher = TCGdexFetcher(data_dir=data_dir, provider=FetcherProvider.sdk)
    with console.status("[bold blue]Récupération des données TCGdex...[/bold blue]"):
        bundles = asyncio.run(
            fetcher.fetch_batch(
                mode=effective_mode,
                custom_ids=custom_ids,
                force=args.force,
                standard_limit=args.limit,
            )
        )

    if not bundles:
        console.print("[yellow]Aucune carte à coder.[/yellow]")
        return

    result = run_coding_phase(
        bundles=bundles,
        data_dir=data_dir,
        model=args.model,
        intensity=args.intensity,
        backend=args.backend,
        force=args.force,
        continue_on_error=args.continue_on_error,
        batch_size=args.batch_size,
        console=console,
    )

    db_path = rebuild_consolidated_database(data_dir, active_ids=None)
    console.print(
        f"[bold green]✓ Passe 2 terminée : base de données consolidée mise à jour dans [bold]{db_path}[/bold].[/bold green]"
    )


if __name__ == "__main__":
    main()
