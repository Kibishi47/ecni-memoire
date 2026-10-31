"""Tests unitaires pour la commande CLI `count`."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from compiler.cli import app

runner = CliRunner()


class TestCliCountCommand(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "compiled_cards").mkdir(parents=True, exist_ok=True)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_count_empty_directory(self):
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["count"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn("Aucune carte compilée trouvée", result.stdout)

            # Test avec --quiet quand vide
            res_quiet = runner.invoke(app, ["count", "--quiet"])
            self.assertEqual(res_quiet.exit_code, 0)
            self.assertEqual(res_quiet.stdout.strip(), "0")

    def test_count_with_compiled_cards(self):
        # Créer deux fausses cartes compilées
        card1 = {
            "cardId": "sv01-001",
            "identity": {"nameFr": "Bulbizarre", "nameEn": "Bulbasaur"},
            "category": "POKEMON",
            "subCategory": "BASIC",
            "compilationMetadata": {"modelFilename": "Qwen3.8-27B.gguf", "tokensPerSecond": 42.5},
        }
        card2 = {
            "cardId": "sve-001",
            "identity": {"nameFr": "Énergie Plante"},
            "category": "ENERGY",
            "subCategory": "BASIC_ENERGY",
            "compilationMetadata": {"modelRepoId": "STATIC_DETERMINISTIC"},
        }

        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(card1), encoding="utf-8")
        (compiled_dir / "sve-001.json").write_text(json.dumps(card2), encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            # Test affichage standard
            res = runner.invoke(app, ["count"])
            self.assertEqual(res.exit_code, 0)
            self.assertIn("2", res.stdout)
            self.assertIn("POKEMON", res.stdout)
            self.assertIn("ENERGY", res.stdout)

            # Test option --quiet
            res_quiet = runner.invoke(app, ["count", "--quiet"])
            self.assertEqual(res_quiet.exit_code, 0)
            self.assertEqual(res_quiet.stdout.strip(), "2")

            # Test option --details
            res_details = runner.invoke(app, ["count", "--details"])
            self.assertEqual(res_details.exit_code, 0)
            self.assertIn("Bulbizarre", res_details.stdout)
            self.assertIn("Énergie Plante", res_details.stdout)
            self.assertIn("Débit", res_details.stdout)
            self.assertIn("42.5 t/s", res_details.stdout)


if __name__ == "__main__":
    unittest.main()
