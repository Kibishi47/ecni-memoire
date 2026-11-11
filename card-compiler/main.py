#!/usr/bin/env python3
"""Point d'entrée CLI unifié pour le compilateur Pokémon TCG (`python3 main.py <commande>`)."""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_DIR = Path(__file__).resolve().parent
if str(PROJECT_DIR) not in sys.path:
    sys.path.insert(0, str(PROJECT_DIR))

from compiler.cli import app


if __name__ == "__main__":
    app()
