#!/usr/bin/env python3
"""Script autonome d'exécution de la Passe 1 (Raisonnement Approfondi) - Two-Pass Pipeline.

Ce script :
1. Charge l'IA de raisonnement (ex: DeepSeek-R1 Distill Qwen 14B) en mémoire unifiée (Apple MLX ou llama.cpp).
2. Génère toutes les fiches d'analyse textuelle pour toutes les cartes sélectionnées.
3. Enregistre chaque texte dans `data/reasoning_texts/{card_id}.json`.
4. Décharge 100% de la mémoire dès la fin du lot avant que vous ne lanciez la Passe 2 (`run_coding.py`).

Exemples d'utilisation :
  python run_reasoning.py
  python run_reasoning.py --ids sv08.5-001,sv04-125
  python run_reasoning.py --standard --limit 50
  python run_reasoning.py --intensity intense
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
from compiler.cli import get_data_dir
from compiler.models_config import IntensityMode, normalize_intensity_mode
from compiler.tcgdex_fetcher import FetcherProvider, TCGdexFetcher
from compiler.two_pass_pipeline import run_reasoning_phase

console = Console()


def main() -> None:
    load_env_file()
    parser = argparse.ArgumentParser(
        description="Passe 1 : Génération de l'analyse de raisonnement textuelle pour Pokémon TCG",
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
        "--intensity",
        choices=["soft", "intense"],
        default=os.environ.get("INTENSITY_MODE", "soft"),
        help="Niveau de puissance : 'soft' (défaut, 14B 4-bit) ou 'intense' (14B 8-bit).",
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
        default=os.environ.get("REASONING_MODEL", os.environ.get("LLM_MODEL")),
        help="Modèle de raisonnement personnalisé (écrase la sélection automatique).",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force la régénération même si l'analyse existe déjà dans data/reasoning_texts/.",
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

    args = parser.parse_args()

    effective_mode = "standard" if args.standard else ("test" if args.test else args.mode)
    custom_ids = [cid.strip() for cid in args.ids.split(",") if cid.strip()] if args.ids else None
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
        console.print("[yellow]Aucune carte à analyser.[/yellow]")
        return

    run_reasoning_phase(
        bundles=bundles,
        data_dir=data_dir,
        model=args.model,
        intensity=args.intensity,
        backend=args.backend,
        force=args.force,
        continue_on_error=args.continue_on_error,
        console=console,
    )


if __name__ == "__main__":
    main()
