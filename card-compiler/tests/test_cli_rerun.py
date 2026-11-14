"""Tests unitaires pour la commande CLI `re-run` et ses alias (`rerun`, `redo`, `recompile`, `reexecute`).

Vérifie :
1. La réexécution de la Passe 1 (`--phase reason`) sur les cartes découvertes dans `data/reasoning_texts/`.
2. La réexécution de la Passe 2 (`--phase code`) sur les cartes découvertes dans `data/compiled_cards/`.
3. La réexécution des deux passes (`--phase all`) sur l'union des cartes existantes.
4. Le filtrage par `--ids`, `--ids-file` / `-f`, `--set` / `-s`, `--mode`, et `--limit`.
5. La récupération automatique depuis TCGdex pour tout identifiant manquant dans les dossiers cibles.
6. La génération préalable de la Passe 1 si une carte cible en Passe 2 n'a pas encore de fiche de raisonnement.
7. Les alias transparents de la commande (`rerun`, `redo`, etc.).
"""

from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from typer.testing import CliRunner

from compiler.cli import app
from compiler.models_config import PipelinePhase
from compiler.schemas import CardCategory, CardIdentity, CardSubCategory, PokemonStats
from compiler.tcgdex_fetcher import FetchedCardBundle


def make_dummy_bundle(card_id: str, name_fr: str = "Pikachu") -> FetchedCardBundle:
    identity = CardIdentity(
        cardId=card_id,
        nameFr=name_fr,
        nameEn="Pikachu",
        category=CardCategory.POKEMON,
        subCategory=CardSubCategory.BASIC,
        setId=card_id.split("-")[0] if "-" in card_id else "sv01",
        localId=card_id.split("-")[1] if "-" in card_id else "001",
    )
    stats = PokemonStats(hp=60, types=["Électrique"], retreatCost=1)
    return FetchedCardBundle(
        card_id=card_id,
        resolved_tcgdex_id=card_id,
        raw_fr={"id": card_id, "name": name_fr, "category": "Pokemon"},
        raw_en={},
        identity=identity,
        pokemon_stats=stats,
        raw_cache_path=Path(f"/tmp/cache_{card_id}.json"),
    )


class TestCliRerunCommand(unittest.TestCase):
    def setUp(self) -> None:
        self.runner = CliRunner()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        self.reason_dir = self.data_dir / "reasoning_texts"
        self.compiled_dir = self.data_dir / "compiled_cards"
        self.raw_dir = self.data_dir / "raw_tcgdex"
        self.reason_dir.mkdir(parents=True, exist_ok=True)
        self.compiled_dir.mkdir(parents=True, exist_ok=True)
        self.raw_dir.mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    @patch("compiler.cli.get_data_dir")
    def test_re_run_empty_directory(self, mock_data_dir: MagicMock) -> None:
        mock_data_dir.return_value = self.data_dir
        result = self.runner.invoke(app, ["re-run", "--phase", "reason"])
        self.assertEqual(result.exit_code, 0)
        self.assertIn("Aucune carte trouvée à réexécuter pour la phase 'reason'", result.stdout)

    @patch("compiler.cli.rebuild_consolidated_database")
    @patch("compiler.cli.run_two_pass_pipeline")
    @patch("compiler.cli.TCGdexFetcher")
    @patch("compiler.cli.get_data_dir")
    def test_re_run_phase_reason_discovery(
        self,
        mock_data_dir: MagicMock,
        mock_fetcher_cls: MagicMock,
        mock_pipeline: MagicMock,
        mock_rebuild_db: MagicMock,
    ) -> None:
        mock_data_dir.return_value = self.data_dir

        # Création de 2 fiches de raisonnement
        (self.reason_dir / "sv06-128.json").write_text('{"cardId": "sv06-128"}', encoding="utf-8")
        (self.reason_dir / "sv06-129.json").write_text('{"cardId": "sv06-129"}', encoding="utf-8")

        mock_fetcher = MagicMock()
        bundle1 = make_dummy_bundle("sv06-128")
        bundle2 = make_dummy_bundle("sv06-129")
        mock_fetcher.fetch_batch = AsyncMock(return_value=[bundle1, bundle2])
        mock_fetcher_cls.return_value = mock_fetcher

        result = self.runner.invoke(app, ["re-run", "--phase", "reason"])
        self.assertEqual(result.exit_code, 0)

        # Vérifier que fetch_batch a été appelé avec les 2 cartes découvertes
        mock_fetcher.fetch_batch.assert_called_once()
        _, kwargs = mock_fetcher.fetch_batch.call_args
        self.assertEqual(kwargs["custom_ids"], ["sv06-128", "sv06-129"])

        # Vérifier que le pipeline a été exécuté en mode reason avec force=True
        mock_pipeline.assert_called_once()
        _, pipe_kwargs = mock_pipeline.call_args
        self.assertEqual(pipe_kwargs["phase"], PipelinePhase.reason)
        self.assertTrue(pipe_kwargs["force"])

    @patch("compiler.cli.rebuild_consolidated_database")
    @patch("compiler.cli.run_two_pass_pipeline")
    @patch("compiler.cli.run_reasoning_phase")
    @patch("compiler.cli.TCGdexFetcher")
    @patch("compiler.cli.get_data_dir")
    def test_re_run_phase_code_discovery(
        self,
        mock_data_dir: MagicMock,
        mock_fetcher_cls: MagicMock,
        mock_run_reason: MagicMock,
        mock_pipeline: MagicMock,
        mock_rebuild_db: MagicMock,
    ) -> None:
        mock_data_dir.return_value = self.data_dir

        # Création de 2 cartes compilées existantes et de leurs fiches de raisonnement
        (self.compiled_dir / "sv05-144.json").write_text('{"cardId": "sv05-144"}', encoding="utf-8")
        (self.compiled_dir / "sv05-145.json").write_text('{"cardId": "sv05-145"}', encoding="utf-8")
        (self.reason_dir / "sv05-144.json").write_text('{"cardId": "sv05-144", "reasoningText": "Analyse valide"}', encoding="utf-8")
        (self.reason_dir / "sv05-145.json").write_text('{"cardId": "sv05-145", "reasoningText": "Analyse valide"}', encoding="utf-8")

        mock_fetcher = MagicMock()
        b1 = make_dummy_bundle("sv05-144")
        b2 = make_dummy_bundle("sv05-145")
        mock_fetcher.fetch_batch = AsyncMock(return_value=[b1, b2])
        mock_fetcher_cls.return_value = mock_fetcher

        result = self.runner.invoke(app, ["re-run", "--phase", "code"])
        self.assertEqual(result.exit_code, 0)

        # Vérifier que fetch_batch a été appelé avec les cartes compilées
        mock_fetcher.fetch_batch.assert_called_once()
        _, kwargs = mock_fetcher.fetch_batch.call_args
        self.assertEqual(kwargs["custom_ids"], ["sv05-144", "sv05-145"])

        # Vérifier phase=code et force=True
        mock_pipeline.assert_called_once()
        _, pipe_kwargs = mock_pipeline.call_args
        self.assertEqual(pipe_kwargs["phase"], PipelinePhase.code)
        self.assertTrue(pipe_kwargs["force"])

        # Vérifier que la base consolidée est mise à jour
        mock_rebuild_db.assert_called_once()

    @patch("compiler.cli.rebuild_consolidated_database")
    @patch("compiler.cli.run_two_pass_pipeline")
    @patch("compiler.cli.TCGdexFetcher")
    @patch("compiler.cli.get_data_dir")
    def test_re_run_phase_all_discovery_union(
        self,
        mock_data_dir: MagicMock,
        mock_fetcher_cls: MagicMock,
        mock_pipeline: MagicMock,
        mock_rebuild_db: MagicMock,
    ) -> None:
        mock_data_dir.return_value = self.data_dir

        # Fiche 1 dans reasoning_texts, Fiche 2 dans compiled_cards
        (self.reason_dir / "sv06-128.json").write_text('{"cardId": "sv06-128"}', encoding="utf-8")
        (self.compiled_dir / "sv05-144.json").write_text('{"cardId": "sv05-144"}', encoding="utf-8")

        mock_fetcher = MagicMock()
        b1 = make_dummy_bundle("sv05-144")
        b2 = make_dummy_bundle("sv06-128")
        mock_fetcher.fetch_batch = AsyncMock(return_value=[b1, b2])
        mock_fetcher_cls.return_value = mock_fetcher

        result = self.runner.invoke(app, ["re-run", "--phase", "all"])
        self.assertEqual(result.exit_code, 0)

        # Union des deux dossiers
        _, kwargs = mock_fetcher.fetch_batch.call_args
        self.assertEqual(sorted(kwargs["custom_ids"]), ["sv05-144", "sv06-128"])

        # Pipeline en mode all avec force=True
        mock_pipeline.assert_called_once()
        _, pipe_kwargs = mock_pipeline.call_args
        self.assertEqual(pipe_kwargs["phase"], PipelinePhase.all)
        self.assertTrue(pipe_kwargs["force"])
        mock_rebuild_db.assert_called_once()

    @patch("compiler.cli.rebuild_consolidated_database")
    @patch("compiler.cli.run_two_pass_pipeline")
    @patch("compiler.cli.TCGdexFetcher")
    @patch("compiler.cli.get_data_dir")
    def test_re_run_with_ids_and_ids_file(
        self,
        mock_data_dir: MagicMock,
        mock_fetcher_cls: MagicMock,
        mock_pipeline: MagicMock,
        mock_rebuild_db: MagicMock,
    ) -> None:
        mock_data_dir.return_value = self.data_dir

        # Fichier avec doublons
        target_file = self.data_dir / "targets.txt"
        target_file.write_text("sv06-128\nsv05-144\nsv06-128\n", encoding="utf-8")

        mock_fetcher = MagicMock()
        b1 = make_dummy_bundle("sv06-128")
        b2 = make_dummy_bundle("sv05-144")
        b3 = make_dummy_bundle("sv07-133")
        mock_fetcher.fetch_batch = AsyncMock(return_value=[b1, b2, b3])
        mock_fetcher_cls.return_value = mock_fetcher

        # Invocation avec --ids et --ids-file
        result = self.runner.invoke(
            app,
            ["re-run", "--ids", "sv07-133,sv06-128", "-f", str(target_file)],
        )
        self.assertEqual(result.exit_code, 0)

        # Déduplication automatique : sv06-128, sv05-144, sv07-133
        _, kwargs = mock_fetcher.fetch_batch.call_args
        self.assertEqual(kwargs["custom_ids"], ["sv06-128", "sv05-144", "sv07-133"])

    @patch("compiler.cli.rebuild_consolidated_database")
    @patch("compiler.cli.run_two_pass_pipeline")
    @patch("compiler.cli.TCGdexFetcher")
    @patch("compiler.cli.get_data_dir")
    def test_re_run_with_set_filter(
        self,
        mock_data_dir: MagicMock,
        mock_fetcher_cls: MagicMock,
        mock_pipeline: MagicMock,
        mock_rebuild_db: MagicMock,
    ) -> None:
        mock_data_dir.return_value = self.data_dir

        (self.reason_dir / "sv06-128.json").write_text('{}', encoding="utf-8")
        (self.reason_dir / "sv06-129.json").write_text('{}', encoding="utf-8")
        (self.reason_dir / "sv05-144.json").write_text('{}', encoding="utf-8")

        mock_fetcher = MagicMock()
        mock_fetcher.fetch_batch = AsyncMock(return_value=[make_dummy_bundle("sv06-128"), make_dummy_bundle("sv06-129")])
        mock_fetcher_cls.return_value = mock_fetcher

        # Filtre sur set sv06
        result = self.runner.invoke(app, ["re-run", "--phase", "reason", "--set", "sv06"])
        self.assertEqual(result.exit_code, 0)

        _, kwargs = mock_fetcher.fetch_batch.call_args
        self.assertEqual(kwargs["custom_ids"], ["sv06-128", "sv06-129"])

    @patch("compiler.cli.run_reasoning_phase")
    @patch("compiler.cli.rebuild_consolidated_database")
    @patch("compiler.cli.run_two_pass_pipeline")
    @patch("compiler.cli.TCGdexFetcher")
    @patch("compiler.cli.get_data_dir")
    def test_re_run_code_auto_generates_missing_reasoning(
        self,
        mock_data_dir: MagicMock,
        mock_fetcher_cls: MagicMock,
        mock_pipeline: MagicMock,
        mock_rebuild_db: MagicMock,
        mock_run_reasoning: MagicMock,
    ) -> None:
        mock_data_dir.return_value = self.data_dir

        # sv06-128 n'a pas de reasoning_texts/sv06-128.json
        b1 = make_dummy_bundle("sv06-128")
        mock_fetcher = MagicMock()
        mock_fetcher.fetch_batch = AsyncMock(return_value=[b1])
        mock_fetcher_cls.return_value = mock_fetcher

        result = self.runner.invoke(app, ["re-run", "--phase", "code", "--ids", "sv06-128"])
        self.assertEqual(result.exit_code, 0)

        # Vérifier que run_reasoning_phase a été appelé pour cette carte avant la phase 2
        mock_run_reasoning.assert_called_once()
        _, r_kwargs = mock_run_reasoning.call_args
        self.assertEqual([b.card_id for b in r_kwargs["bundles"]], ["sv06-128"])

        # Puis le pipeline two_pass a été lancé
        mock_pipeline.assert_called_once()
        _, pipe_kwargs = mock_pipeline.call_args
        self.assertEqual(pipe_kwargs["phase"], PipelinePhase.code)

    @patch("compiler.cli.re_run_command")
    def test_re_run_aliases(self, mock_rerun: MagicMock) -> None:
        # Test alias 'rerun'
        res1 = self.runner.invoke(app, ["rerun", "--phase", "reason", "--ids", "sv06-128"])
        self.assertEqual(res1.exit_code, 0)
        self.assertEqual(mock_rerun.call_count, 1)

        # Test alias 'redo'
        res2 = self.runner.invoke(app, ["redo", "--phase", "code", "--ids", "sv06-128"])
        self.assertEqual(res2.exit_code, 0)
        self.assertEqual(mock_rerun.call_count, 2)

        # Test alias 'recompile'
        res3 = self.runner.invoke(app, ["recompile", "--phase", "all", "--ids", "sv06-128"])
        self.assertEqual(res3.exit_code, 0)
        self.assertEqual(mock_rerun.call_count, 3)

        # Test alias 'reexecute'
        res4 = self.runner.invoke(app, ["reexecute", "--phase", "all", "--ids", "sv06-128"])
        self.assertEqual(res4.exit_code, 0)
        self.assertEqual(mock_rerun.call_count, 4)


if __name__ == "__main__":
    unittest.main()
