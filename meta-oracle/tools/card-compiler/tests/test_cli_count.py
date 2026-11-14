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

    def test_count_reasoned_empty(self):
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            res = runner.invoke(app, ["count", "--reasoned"])
            self.assertEqual(res.exit_code, 0)
            self.assertIn("Aucune analyse de raisonnement trouvée", res.stdout)

            res_q = runner.invoke(app, ["count", "-r", "-q"])
            self.assertEqual(res_q.exit_code, 0)
            self.assertEqual(res_q.stdout.strip(), "0")

    def test_count_reasoned_with_records(self):
        reason_dir = self.data_dir / "reasoning_texts"
        reason_dir.mkdir(parents=True, exist_ok=True)
        rec1 = {
            "cardId": "sv01-001",
            "nameFr": "Bulbizarre",
            "nameEn": "Bulbasaur",
            "modelRepoId": "DeepSeek-R1-Distill-Qwen-14B",
            "modelBackend": "mlx",
            "reasoningText": "Analyse de Bulbizarre",
            "createdAtIso": "2026-11-04T00:00:00Z",
            "completionTokens": 350,
            "tokensPerSecond": 45.2,
        }
        rec2 = {
            "cardId": "sv01-002",
            "nameFr": "Herbizarre",
            "nameEn": "Ivysaur",
            "modelRepoId": "DeepSeek-R1-Distill-Qwen-14B",
            "modelBackend": "mlx",
            "reasoningText": "Analyse de Herbizarre",
            "createdAtIso": "2026-11-04T00:00:00Z",
            "completionTokens": 410,
            "tokensPerSecond": 43.8,
        }
        (reason_dir / "sv01-001.json").write_text(json.dumps(rec1), encoding="utf-8")
        (reason_dir / "sv01-002.json").write_text(json.dumps(rec2), encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            # Test affichage standard --reasoned
            res = runner.invoke(app, ["count", "--reasoned"])
            self.assertEqual(res.exit_code, 0)
            self.assertIn("2", res.stdout)
            self.assertIn("Corpus de Cartes Raisonnées (Passe 1)", res.stdout)
            self.assertIn("DeepSeek-R1-Distill-Qwen-14B", res.stdout)

            # Test option -r -q
            res_q = runner.invoke(app, ["count", "-r", "-q"])
            self.assertEqual(res_q.exit_code, 0)
            self.assertEqual(res_q.stdout.strip(), "2")

            # Test option -r -d
            res_d = runner.invoke(app, ["count", "-r", "-d"])
            self.assertEqual(res_d.exit_code, 0)
            self.assertIn("Bulbizarre", res_d.stdout)
            self.assertIn("Herbizarre", res_d.stdout)
            self.assertIn("45.2 t/s", res_d.stdout)
            self.assertIn("350", res_d.stdout)


if __name__ == "__main__":
    unittest.main()
