"""Tests unitaires pour la gestion des listes d'identifiants de cartes via fichier (--ids-file / -f)

et la déduplication automatique à travers toutes les commandes CLI.
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from typer.testing import CliRunner

from compiler.cli import (
    app,
    get_remaining_cards_summary,
    load_ids_from_file,
    resolve_card_ids,
    sync_cards_database,
)


class TestCliIdsFile(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.compiled_dir = self.data_dir / "compiled_cards"
        self.reasoning_dir = self.data_dir / "reasoning_texts"
        self.compiled_dir.mkdir(parents=True, exist_ok=True)
        self.reasoning_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_load_ids_from_file_normal(self) -> None:
        file_path = self.data_dir / "test_input.txt"
        file_path.write_text(
            "# Commentaire d'en-tête\n"
            "sv06-128\n"
            "sv06-129\n"
            "\n"
            "# Autre commentaire\n"
            "sv06-130, sv06-095\n"
            "sv06-128\n",  # Doublon
            encoding="utf-8",
        )
        loaded = load_ids_from_file(file_path)
        self.assertEqual(loaded, ["sv06-128", "sv06-129", "sv06-130", "sv06-095", "sv06-128"])

    def test_load_ids_from_file_not_found(self) -> None:
        with self.assertRaises(FileNotFoundError):
            load_ids_from_file("chemin_totalement_inexistant_xyz_123.txt")

    def test_resolve_card_ids_deduplication(self) -> None:
        # Fichier avec doublons
        file_path = self.data_dir / "dup_input.txt"
        file_path.write_text("sv06-128\nsv06-129\nsv06-128\nsv05-144\n", encoding="utf-8")

        resolved = resolve_card_ids(ids="sv06-129,sv07-133,sv06-128", ids_file=file_path)
        # Ordre d'apparition : fichier (sv06-128, sv06-129, sv05-144) puis ids (sv07-133)
        self.assertEqual(resolved, ["sv06-128", "sv06-129", "sv05-144", "sv07-133"])

    def test_resolve_card_ids_target_ids_txt(self) -> None:
        # Test sur le fichier cible complet fourni par l'utilisateur (74 lignes -> 55 uniques)
        target_path = Path(__file__).resolve().parent.parent / "data" / "target_ids.txt"
        self.assertTrue(target_path.is_file(), f"Le fichier {target_path} doit exister.")
        resolved = resolve_card_ids(ids_file=target_path)
        self.assertIsNotNone(resolved)
        self.assertEqual(len(resolved), 55)
        # Vérifie qu'il n'y a aucun doublon
        self.assertEqual(len(resolved), len(set(resolved)))
        # Vérifie la présence de cartes clés
        self.assertIn("sv06-128", resolved)
        self.assertIn("me03-062", resolved)
        self.assertIn("sv06-166", resolved)

    def test_resolve_card_ids_at_file_syntax(self) -> None:
        file_path = self.data_dir / "at_syntax.txt"
        file_path.write_text("sv06-128\nsv06-129\n", encoding="utf-8")
        resolved = resolve_card_ids(ids=f"@{file_path}")
        self.assertEqual(resolved, ["sv06-128", "sv06-129"])

    def test_resolve_card_ids_direct_file_path_in_ids(self) -> None:
        file_path = self.data_dir / "direct_file.txt"
        file_path.write_text("sv06-128\nsv06-129\n", encoding="utf-8")
        resolved = resolve_card_ids(ids=str(file_path))
        self.assertEqual(resolved, ["sv06-128", "sv06-129"])

    def test_get_remaining_cards_summary_with_custom_ids(self) -> None:
        custom_ids = ["sv06-128", "sv06-129", "sv06-130", "sv06-128"]  # Avec doublon
        # Simuler 1 carte compilée
        (self.compiled_dir / "sv06-128.json").write_text("{}", encoding="utf-8")

        summary = get_remaining_cards_summary(
            data_dir=self.data_dir,
            custom_ids=custom_ids,
            reasoned=False,
        )
        self.assertEqual(summary["total_target"], 3)  # Dédupliqué
        self.assertEqual(summary["total_compiled"], 1)
        self.assertEqual(summary["total_remaining"], 2)
        self.assertEqual(summary["remaining_ids"], ["sv06-129", "sv06-130"])

    def test_cli_remaining_with_ids_file(self) -> None:
        file_path = self.data_dir / "ids.txt"
        file_path.write_text("sv06-128\nsv06-129\nsv06-130\nsv06-128\n", encoding="utf-8")
        (self.compiled_dir / "sv06-128.json").write_text("{}", encoding="utf-8")

        result = self.runner.invoke(
            app,
            ["remaining", "--ids-file", str(file_path), "--quiet"],
        )
        # Doit afficher le nombre restant (ou s'exécuter sans erreur)
        self.assertEqual(result.exit_code, 0)

    def test_cli_count_with_ids_file(self) -> None:
        file_path = self.data_dir / "ids.txt"
        file_path.write_text("sv06-128\nsv06-129\nsv06-130\n", encoding="utf-8")

        # Test quiet mode
        result = self.runner.invoke(
            app,
            ["count", "-f", str(file_path), "-q"],
        )
        self.assertEqual(result.exit_code, 0)

    def test_cli_sync_with_ids_file(self) -> None:
        file_path = self.data_dir / "ids.txt"
        file_path.write_text("sv06-128\nsv06-129\n", encoding="utf-8")
        db_path = self.data_dir / "cards_database.json"

        result = self.runner.invoke(
            app,
            ["sync", "--ids-file", str(file_path), "--db-path", str(db_path), "--dry-run"],
        )
        self.assertEqual(result.exit_code, 0)

    def test_cli_help_options_presence(self) -> None:
        # Vérifie que --ids-file et -f sont documentés dans l'aide de toutes les commandes
        for cmd in ["run", "reason", "code", "remaining", "count", "sync", "stats", "inspect"]:
            res = self.runner.invoke(app, [cmd, "--help"])
            self.assertEqual(res.exit_code, 0, f"Erreur d'aide pour {cmd}")
            self.assertIn("--ids-file", res.output, f"--ids-file manquant dans {cmd} --help")
            self.assertIn("-f", res.output, f"-f manquant dans {cmd} --help")


if __name__ == "__main__":
    unittest.main()
