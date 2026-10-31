"""Tests unitaires pour la commande CLI `sync` et la fonction `sync_cards_database`."""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from typer.testing import CliRunner

from compiler.cli import app, sync_cards_database

runner = CliRunner()


class TestCliSyncCommand(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "compiled_cards").mkdir(parents=True, exist_ok=True)

        self.card1 = {
            "cardId": "sv01-001",
            "identity": {
                "cardId": "sv01-001",
                "nameFr": "Bulbizarre",
                "nameEn": "Bulbasaur",
            },
            "category": "POKEMON",
            "subCategory": "BASIC",
            "compilationMetadata": {"modelFilename": "Qwen3.8-27B.gguf"},
        }
        self.card2 = {
            "cardId": "sv01-002",
            "identity": {
                "cardId": "sv01-002",
                "nameFr": "Herbizarre",
                "nameEn": "Ivysaur",
            },
            "category": "POKEMON",
            "subCategory": "STAGE_1",
            "compilationMetadata": {"modelFilename": "Qwen3.8-27B.gguf"},
        }
        self.card3 = {
            "cardId": "sve-001",
            "identity": {
                "cardId": "sve-001",
                "nameFr": "Énergie Plante",
            },
            "category": "ENERGY",
            "subCategory": "BASIC_ENERGY",
            "compilationMetadata": {"modelRepoId": "STATIC_DETERMINISTIC"},
        }

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_sync_all_already_present(self):
        # Les 2 cartes sont déjà sur le disque et dans la base (format liste)
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(self.card1), encoding="utf-8")
        (compiled_dir / "sv01-002.json").write_text(json.dumps(self.card2), encoding="utf-8")

        db_path = self.data_dir / "cards_database.json"
        db_path.write_text(json.dumps([self.card1, self.card2]), encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["sync"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn("Toutes les cartes compilées (2) sont déjà présentes", result.stdout)
            self.assertIn("Cartes manquantes détectées : 0", result.stdout)

    def test_sync_missing_card_added_to_list_database(self):
        # 3 cartes sur disque, seulement 1 dans la base
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(self.card1), encoding="utf-8")
        (compiled_dir / "sv01-002.json").write_text(json.dumps(self.card2), encoding="utf-8")
        (compiled_dir / "sve-001.json").write_text(json.dumps(self.card3), encoding="utf-8")

        db_path = self.data_dir / "cards_database.json"
        db_path.write_text(json.dumps([self.card1]), encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["sync"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn("2 carte(s) manquante(s) ont été automatiquement ajoutées", result.stdout)
            self.assertIn("Herbizarre", result.stdout)
            self.assertIn("Énergie Plante", result.stdout)

        # Vérifier que le fichier JSON a bien été mis à jour avec les 3 cartes
        updated_db = json.loads(db_path.read_text(encoding="utf-8"))
        self.assertIsInstance(updated_db, list)
        self.assertEqual(len(updated_db), 3)
        self.assertEqual([c["cardId"] for c in updated_db], ["sv01-001", "sv01-002", "sve-001"])

    def test_sync_missing_card_added_to_dict_database(self):
        # Base au format dict avec clé 'cards'
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(self.card1), encoding="utf-8")
        (compiled_dir / "sv01-002.json").write_text(json.dumps(self.card2), encoding="utf-8")

        db_path = self.data_dir / "cards_database.json"
        initial_dict = {
            "schemaVersion": "1.0.0",
            "totalCards": 1,
            "cards": {"sv01-001": self.card1},
        }
        db_path.write_text(json.dumps(initial_dict), encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["sync"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn("1 carte(s) manquante(s) ont été automatiquement ajoutées", result.stdout)

        updated_dict = json.loads(db_path.read_text(encoding="utf-8"))
        self.assertIsInstance(updated_dict, dict)
        self.assertEqual(updated_dict["totalCards"], 2)
        self.assertIn("sv01-001", updated_dict["cards"])
        self.assertIn("sv01-002", updated_dict["cards"])

    def test_sync_creates_database_if_not_exists(self):
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(self.card1), encoding="utf-8")

        db_path = self.data_dir / "cards_database.json"
        self.assertFalse(db_path.exists())

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["sync"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn("1 carte(s) manquante(s) ont été automatiquement ajoutées", result.stdout)

        self.assertTrue(db_path.exists())
        data = json.loads(db_path.read_text(encoding="utf-8"))
        self.assertIsInstance(data, list)
        self.assertEqual(len(data), 1)
        self.assertEqual(data[0]["cardId"], "sv01-001")

    def test_sync_dry_run_does_not_modify_file(self):
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(self.card1), encoding="utf-8")
        (compiled_dir / "sv01-002.json").write_text(json.dumps(self.card2), encoding="utf-8")

        db_path = self.data_dir / "cards_database.json"
        db_path.write_text(json.dumps([self.card1]), encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["sync", "--dry-run"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn("Mode simulation (--dry-run)", result.stdout)
            self.assertIn("1 carte(s) seraient ajoutées", result.stdout)

        # Vérifier que le fichier n'a pas bougé
        data = json.loads(db_path.read_text(encoding="utf-8"))
        self.assertEqual(len(data), 1)

    def test_sync_corrupted_file_skipped(self):
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(self.card1), encoding="utf-8")
        (compiled_dir / "bad-card.json").write_text("{ unclosed json: invalid ...", encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            result = runner.invoke(app, ["sync"])
            self.assertEqual(result.exit_code, 0)
            self.assertIn("fichier(s) JSON invalide(s) ignoré(s)", result.stdout)
            self.assertIn("bad-card.json", result.stdout)

    def test_sync_aliases(self):
        compiled_dir = self.data_dir / "compiled_cards"
        (compiled_dir / "sv01-001.json").write_text(json.dumps(self.card1), encoding="utf-8")

        for alias in ["sync-database", "check-database", "sync-db"]:
            with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
                result = runner.invoke(app, [alias, "--dry-run"])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("Vérification & Synchronisation de la Base de Cartes", result.stdout)


if __name__ == "__main__":
    unittest.main()
