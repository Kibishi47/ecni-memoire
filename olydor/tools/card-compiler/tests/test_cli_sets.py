"""Tests unitaires pour la sélection d'un ou plusieurs sets TCGdex en ignorant `legal.standard`."""

from __future__ import annotations

import asyncio
import json
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from typing import List, Optional
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from typer.testing import CliRunner

from compiler.cli import app
from compiler.tcgdex_fetcher import FetcherProvider, TCGdexFetcher, parse_set_codes

runner = CliRunner()


@dataclass
class MockSetCardResume:
    id: str
    localId: str
    name: str


@dataclass
class MockSetLegal:
    standard: bool
    expanded: bool


@dataclass
class MockSetModel:
    id: str
    name: str
    legal: MockSetLegal
    cards: List[MockSetCardResume]
    tcgOnline: Optional[str] = None


class TestCliSetSelectionIgnoringStandard(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "raw_tcgdex").mkdir(parents=True, exist_ok=True)
        (self.data_dir / "compiled_cards").mkdir(parents=True, exist_ok=True)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_parse_set_codes_splits_and_deduplicates(self) -> None:
        self.assertEqual(parse_set_codes("me05, me06  me05"), ["me05", "me06"])
        self.assertEqual(parse_set_codes(["me05,me06", "DLR", "me05"]), ["me05", "me06", "DLR"])
        self.assertEqual(parse_set_codes(None), [])

    def test_resolve_set_card_ids_ignores_legal_standard_false(self) -> None:
        fetcher = TCGdexFetcher(data_dir=self.data_dir, provider=FetcherProvider.sdk)

        set_me05 = MockSetModel(
            id="me05",
            name="Nuit Noire",
            legal=MockSetLegal(standard=False, expanded=False),
            cards=[
                MockSetCardResume(id="me05-001", localId="001", name="Poltchageist"),
                MockSetCardResume(id="me05-034", localId="034", name="Branette"),
            ],
            tcgOnline="PBL",
        )
        set_me06 = MockSetModel(
            id="me06",
            name="Nouvelle Extension",
            legal=MockSetLegal(standard=False, expanded=False),
            cards=[
                MockSetCardResume(id="me06-124", localId="124", name="Flambusard-ex"),
            ],
            tcgOnline="DLR",
        )

        mock_sdk = MagicMock()
        mock_sdk.set.getSync.side_effect = lambda sid: {"me05": set_me05, "me06": set_me06}.get(sid)
        mock_sdk.set.listSync.return_value = [set_me05, set_me06]
        fetcher._sdk_fr = mock_sdk

        mock_404 = MagicMock()
        mock_404.status_code = 404
        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = mock_404
        ids = asyncio.run(fetcher.resolve_set_card_ids(client, set_ids=["me05", "DLR"]))
        self.assertEqual(ids, ["me05-001", "me05-034", "me06-124"])

    def test_fetch_batch_with_set_ids_keeps_non_standard_cards(self) -> None:
        fetcher = TCGdexFetcher(data_dir=self.data_dir, provider=FetcherProvider.sdk)
        mock_bundle = MagicMock()
        mock_bundle.card_id = "me06-124"
        mock_bundle.identity.legalStandard = False

        with patch.object(fetcher, "fetch_cards_index", new=AsyncMock(return_value=[])), \
             patch.object(fetcher, "resolve_set_card_ids", new=AsyncMock(return_value=["me06-124"])), \
             patch.object(fetcher, "fetch_card_by_id", new=AsyncMock(return_value=mock_bundle)):
            bundles = asyncio.run(fetcher.fetch_batch(mode="standard", set_ids=["me06"]))
            self.assertEqual(len(bundles), 1)
            self.assertEqual(bundles[0].card_id, "me06-124")

    def test_fetch_sets_cli_command_with_out_file_and_raw(self) -> None:
        out_file = self.data_dir / "resolved_sets.txt"
        mock_stats = {
            "total": 2,
            "cached": 0,
            "downloaded": 2,
            "failed": 0,
            "failed_cards": {},
            "elapsed_seconds": 0.1,
        }
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir), \
             patch("compiler.tcgdex_fetcher.TCGdexFetcher.resolve_set_card_ids", new=AsyncMock(return_value=["me05-034", "me06-124"])), \
             patch("compiler.tcgdex_fetcher.TCGdexFetcher.download_raw_cards", new=AsyncMock(return_value=mock_stats)) as mock_dl:
            res = runner.invoke(app, ["fetch-sets", "me05", "me06", "-o", str(out_file)])
            self.assertEqual(res.exit_code, 0, res.output)
            self.assertIn("legal.standard ignoré", res.output)
            self.assertTrue(out_file.exists())
            self.assertEqual(out_file.read_text(encoding="utf-8").splitlines(), ["me05-034", "me06-124"])
            mock_dl.assert_called_once()
            self.assertEqual(mock_dl.call_args[1]["card_ids"], ["me05-034", "me06-124"])

    def test_compile_sets_and_run_sets_cli_commands(self) -> None:
        with patch("compiler.cli._execute_run_pipeline") as mock_exec:
            res1 = runner.invoke(app, ["compile-sets", "me05", "me06", "--llm-provider", "lm_studio", "-j", "4"])
            self.assertEqual(res1.exit_code, 0, res1.output)
            mock_exec.assert_called_once()
            self.assertEqual(mock_exec.call_args[1]["sets"], ["me05", "me06"])
            self.assertEqual(mock_exec.call_args[1]["parallel"], 4)

        with patch("compiler.cli._execute_run_pipeline") as mock_exec2:
            res2 = runner.invoke(app, ["run", "--sets", "me05,me06"])
            self.assertEqual(res2.exit_code, 0, res2.output)
            mock_exec2.assert_called_once()
            self.assertEqual(mock_exec2.call_args[1]["sets"], "me05,me06")

    def test_remaining_with_sets_ignores_standard(self) -> None:
        (self.data_dir / "compiled_cards" / "me05-001.json").write_text(
            json.dumps({"cardId": "me05-001"}),
            encoding="utf-8",
        )
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir), \
             patch("compiler.tcgdex_fetcher.TCGdexFetcher.resolve_set_card_ids", new=AsyncMock(return_value=["me05-001", "me05-034", "me06-124"])):
            res = runner.invoke(app, ["remaining", "--sets", "me05,me06", "-q"])
            self.assertEqual(res.exit_code, 0, res.output)
            self.assertEqual(res.stdout.strip(), "2")


if __name__ == "__main__":
    unittest.main()
