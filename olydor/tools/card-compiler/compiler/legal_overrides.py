"""Overrides de légalité Standard partagés avec `@olydor/types` (`legalOverrides.json`)."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, Optional

DEFAULT_LEGAL_OVERRIDES_PATH = (
    Path(__file__).resolve().parents[3] / "packages" / "types" / "src" / "legalOverrides.json"
)
DEFAULT_ALLOWED_REGULATION_MARKS = frozenset({"G", "H", "I", "J"})


@dataclass(frozen=True)
class LegalOverrides:
    """Configuration partagée des extensions et marques de régulation autorisées en Standard."""

    standard_allowed_set_ids: frozenset[str] = frozenset()
    standard_allowed_regulation_marks: frozenset[str] = DEFAULT_ALLOWED_REGULATION_MARKS


def load_legal_overrides(path: Optional[Path] = None) -> LegalOverrides:
    """Charge `legalOverrides.json` (avec repli sûr si le fichier est absent ou invalide)."""
    target = path or DEFAULT_LEGAL_OVERRIDES_PATH
    if not target.is_file():
        return LegalOverrides()

    try:
        raw = json.loads(target.read_text(encoding="utf-8"))
    except Exception:
        return LegalOverrides()

    if not isinstance(raw, dict):
        return LegalOverrides()

    raw_sets = raw.get("standardAllowedSetIds")
    allowed_sets = frozenset(
        str(item).strip().lower()
        for item in (raw_sets if isinstance(raw_sets, list) else [])
        if str(item).strip()
    )

    raw_marks = raw.get("standardAllowedRegulationMarks")
    allowed_marks = (
        frozenset(
            str(item).strip().upper()
            for item in raw_marks
            if str(item).strip()
        )
        if isinstance(raw_marks, list)
        else DEFAULT_ALLOWED_REGULATION_MARKS
    )

    return LegalOverrides(
        standard_allowed_set_ids=allowed_sets,
        standard_allowed_regulation_marks=allowed_marks,
    )


def is_set_standard_overridden(
    set_id: Optional[str],
    extra_sets: Optional[Iterable[str]] = None,
    overrides: Optional[LegalOverrides] = None,
) -> bool:
    """Indique si l'extension `set_id` est autorisée en Standard par override ou option CLI."""
    if not set_id:
        return False
    normalized = str(set_id).strip().lower()
    if not normalized:
        return False

    cfg = overrides or load_legal_overrides()
    if normalized in cfg.standard_allowed_set_ids:
        return True

    if extra_sets is not None:
        for candidate in extra_sets:
            if str(candidate).strip().lower() == normalized:
                return True

    return False
