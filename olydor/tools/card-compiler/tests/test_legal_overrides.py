"""Tests unitaires pour `legalOverrides.json`, les extensions forcées et `--force-standard`."""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from typer.testing import CliRunner

from compiler.cli import app
from compiler.deterministic_builder import build_identity_and_stats_from_raw
from compiler.legal_overrides import (
    DEFAULT_LEGAL_OVERRIDES_PATH,
    LegalOverrides,
    is_set_standard_overridden,
    load_legal_overrides,
)
from compiler.tcgdex_fetcher import FetcherProvider, TCGdexFetcher

runner = CliRunner()


class TestLegalOverrides(unittest.TestCase):
    def test_load_shared_legal_overrides_file(self) -> None:
        self.assertTrue(DEFAULT_LEGAL_OVERRIDES_PATH.is_file())
        cfg = load_legal_overrides()
        self.assertIn("G", cfg.standard_allowed_regulation_marks)
        self.assertIn("J", cfg.standard_allowed_regulation_marks)

    def test_load_custom_overrides_normalizes_case(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            cfg_path = Path(tmpdir) / "legalOverrides.json"
            cfg_path.write_text(
                json.dumps({
                    "standardAllowedSetIds": [" ME05 ", "30th"],
                    "standardAllowedRegulationMarks": ["g", "h", "i", "j"],
                }),
                encoding="utf-8",
            )
            cfg = load_legal_overrides(cfg_path)
            self.assertEqual(cfg.standard_allowed_set_ids, frozenset({"me05", "30th"}))
            self.assertEqual(cfg.standard_allowed_regulation_marks, frozenset({"G", "H", "I", "J"}))
            self.assertTrue(is_set_standard_overridden("ME05", overrides=cfg))
            self.assertFalse(is_set_standard_overridden("sv01", overrides=cfg))
            self.assertTrue(is_set_standard_overridden("sv01", extra_sets=["SV01"], overrides=cfg))

    def test_build_identity_respects_set_override_and_force_standard(self) -> None:
        raw_fr = {
            "id": "me05-001",
            "localId": "001",
            "name": "Carte Test",
            "category": "Pokémon",
            "hp": 70,
            "types": ["Plante"],
            "stage": "De base",
            "set": {"id": "me05", "name": "Nuit Noire"},
            "legal": {"standard": False, "expanded": True},
        }

        identity_default, _ = build_identity_and_stats_from_raw("me05-001", raw_fr)
        self.assertFalse(identity_default.legalStandard)

        identity_forced, _ = build_identity_and_stats_from_raw(
            "me05-001",
            raw_fr,
            force_standard=True,
        )
        self.assertTrue(identity_forced.legalStandard)

        overridden_cfg = LegalOverrides(
            standard_allowed_set_ids=frozenset({"me05"}),
            standard_allowed_regulation_marks=frozenset({"G", "H", "I", "J"}),
        )
        with patch("compiler.deterministic_builder.load_legal_overrides", return_value=overridden_cfg):
            identity_override, _ = build_identity_and_stats_from_raw("me05-001", raw_fr)
            self.assertTrue(identity_override.legalStandard)

    def test_resolve_standard_card_ids_merges_overridden_sets(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            fetcher = TCGdexFetcher(data_dir=Path(tmpdir), provider=FetcherProvider.rest)
            overridden_cfg = LegalOverrides(
                standard_allowed_set_ids=frozenset({"me05"}),
                standard_allowed_regulation_marks=frozenset({"G", "H", "I", "J"}),
            )
            client = AsyncMock(spec=httpx.AsyncClient)

            with patch("compiler.tcgdex_fetcher.load_legal_overrides", return_value=overridden_cfg), \
                 patch.object(fetcher, "fetch_standard_cards_index", new=AsyncMock(return_value=[{"id": "sv01-001"}])), \
                 patch.object(fetcher, "resolve_set_card_ids", new=AsyncMock(return_value=["me05-001", "me05-002"])) as mock_sets:
                ids = asyncio.run(fetcher.resolve_standard_card_ids(client))
                self.assertEqual(ids, ["sv01-001", "me05-001", "me05-002"])
                mock_sets.assert_called_once_with(client, set_ids=["me05"], force=False)

    def test_cli_force_standard_option_forwarded(self) -> None:
        with patch("compiler.cli._execute_run_pipeline") as mock_exec:
            res = runner.invoke(app, ["compile-sets", "me05", "--force-standard"])
            self.assertEqual(res.exit_code, 0, res.output)
            self.assertTrue(mock_exec.call_args[1]["force_standard"])


if __name__ == "__main__":
    unittest.main()
