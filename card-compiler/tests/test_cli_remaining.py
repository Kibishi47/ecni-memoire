"""Tests unitaires pour la commande CLI `remaining` et la fonction `get_remaining_cards_summary`."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from typer.testing import CliRunner

from compiler.cli import app, get_remaining_cards_summary

runner = CliRunner()


class TestCliRemainingCommand(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "compiled_cards").mkdir(parents=True, exist_ok=True)
        (self.data_dir / "raw_tcgdex").mkdir(parents=True, exist_ok=True)

        self.mock_std_ids = [
            "sv01-001", "sv01-002", "sv01-003",
            "sv02-001", "sv02-002",
        ]

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_remaining_standard_with_partial_compiled(self):
        # 2 cartes compilées sur 5 cibles
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps({"cardId": "sv01-001"}), encoding="utf-8")
        (compiled_dir / "sv02-001.json").write_text(json.dumps({"cardId": "sv02-001"}), encoding="utf-8")

        with patch("compiler.tcgdex_fetcher.TCGdexFetcher.resolve_standard_card_ids", new=AsyncMock(return_value=self.mock_std_ids)):
            with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
                result = runner.invoke(app, ["remaining"])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("Total de cartes cibles : 5", result.stdout)
                self.assertIn("Cartes déjà compilées : 2", result.stdout)
                self.assertIn("Cartes restant à compiler : 3", result.stdout)
                self.assertIn("40.0%", result.stdout)

                # Test --quiet
                res_quiet = runner.invoke(app, ["remaining", "--quiet"])
                self.assertEqual(res_quiet.exit_code, 0)
                self.assertEqual(res_quiet.stdout.strip(), "3")

    def test_remaining_set_filter(self):
        # Filtrer sur le set 'sv01' (3 cartes cibles au total, 1 compilée)
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps({"cardId": "sv01-001"}), encoding="utf-8")

        with patch("compiler.tcgdex_fetcher.TCGdexFetcher.resolve_standard_card_ids", new=AsyncMock(return_value=self.mock_std_ids)):
            with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
                result = runner.invoke(app, ["remaining", "--set", "sv01"])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("SV01", result.stdout)
                self.assertIn("Total de cartes cibles : 3", result.stdout)
                self.assertIn("Cartes déjà compilées : 1", result.stdout)
                self.assertIn("Cartes restant à compiler : 2", result.stdout)

                # Test avec --details
                res_det = runner.invoke(app, ["remaining", "--set", "sv01", "--details"])
                self.assertEqual(res_det.exit_code, 0)
                self.assertIn("sv01-002", res_det.stdout)
                self.assertIn("sv01-003", res_det.stdout)

    def test_remaining_all_compiled(self):
        # Toutes les cartes cibles sont compilées
        compiled_dir = self.data_dir / "compiled_cards"
        for cid in self.mock_std_ids:
            (compiled_dir / f"{cid}.json").write_text(json.dumps({"cardId": cid}), encoding="utf-8")

        with patch("compiler.tcgdex_fetcher.TCGdexFetcher.resolve_standard_card_ids", new=AsyncMock(return_value=self.mock_std_ids)):
            with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
                result = runner.invoke(app, ["remaining"])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("100.0%", result.stdout)
                self.assertIn("Cartes restant à compiler : 0", result.stdout)
                self.assertIn("Toutes les cartes de ce périmètre (5) sont déjà compilées", result.stdout)

                # --quiet donne '0'
                res_q = runner.invoke(app, ["remaining", "-q"])
                self.assertEqual(res_q.stdout.strip(), "0")

    def test_remaining_test_mode(self):
        from compiler.tcgdex_fetcher import TEST_CARD_IDS
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["remaining", "--mode", "test"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn(f"Total de cartes cibles : {len(TEST_CARD_IDS)}", result.stdout)

    def test_remaining_aliases(self):
        with patch("compiler.tcgdex_fetcher.TCGdexFetcher.resolve_standard_card_ids", new=AsyncMock(return_value=self.mock_std_ids)):
            with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
                for alias in ["todo", "left", "pending", "a-compiler"]:
                    res = runner.invoke(app, [alias, "--quiet"])
                    self.assertEqual(res.exit_code, 0)
                    self.assertEqual(res.stdout.strip(), "5")


if __name__ == "__main__":
    unittest.main()
