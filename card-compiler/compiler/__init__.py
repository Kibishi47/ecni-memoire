"""Pokémon TCG Card Compiler — Extraction TCGdex & Compilation IA Locale (llama.cpp + GBNF)."""

from __future__ import annotations

import os
from pathlib import Path

__version__ = "0.1.0"


def load_env_file() -> None:
    """Charge automatiquement les variables de `card-compiler/.env` dans `os.environ` si présent."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        try:
            for raw_line in env_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                k = k.strip()
                v = v.strip().strip("'\"")
                if k and k not in os.environ and v != "":
                    os.environ[k] = v
        except Exception:
            pass


load_env_file()
