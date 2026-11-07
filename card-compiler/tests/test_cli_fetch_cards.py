"""Tests unitaires pour la commande CLI `fetch-cards` (et `update-cards`) et la récupération Standard via TCGdex."""

from __future__ import annotations

import json
import tempfile
import unittest
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
from typer.testing import CliRunner

from compiler.cli import app
from compiler.tcgdex_fetcher import FetcherProvider, TCGdexFetcher

runner = CliRunner()


@dataclass
class MockSDKCard:
    id: str
    localId: str
    name: str


class TestTCGdexFetchCards(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.data_dir = Path(self.temp_dir.name)
        (self.data_dir / "raw_tcgdex").mkdir(parents=True, exist_ok=True)

        self.mock_standard_cards = [
            {"id": "sv01-001", "localId": "001", "name": "Pikachu"},
            {"id": "sv01-002", "localId": "002", "name": "Raichu"},
            {"id": "me01-010", "localId": "010", "name": "Mega Rayquaza"},
            {"id": "sve-001", "localId": "001", "name": "Énergie Plante"},
        ]

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_fetch_standard_cards_index_via_sdk(self):
        fetcher = TCGdexFetcher(data_dir=self.data_dir, provider=FetcherProvider.sdk)
        mock_sdk_results = [
            MockSDKCard(id=c["id"], localId=c["localId"], name=c["name"])
            for c in self.mock_standard_cards
        ]

        mock_sdk = MagicMock()
        mock_sdk.card.listSync.return_value = mock_sdk_results
        fetcher._sdk_fr = mock_sdk

        client = AsyncMock(spec=httpx.AsyncClient)

        import asyncio
        cards = asyncio.run(fetcher.fetch_standard_cards_index(client, force=True))

        self.assertEqual(len(cards), 4)
        self.assertEqual(cards[0]["id"], "sv01-001")
        self.assertTrue(fetcher.standard_index_path.exists())

        saved = json.loads(fetcher.standard_index_path.read_text(encoding="utf-8"))
        self.assertEqual(len(saved), 4)

    def test_fetch_standard_cards_index_via_rest(self):
        fetcher = TCGdexFetcher(data_dir=self.data_dir, provider=FetcherProvider.rest)

        mock_resp = MagicMock()
        mock_resp.json.return_value = self.mock_standard_cards
        mock_resp.raise_for_status.return_value = None

        client = AsyncMock(spec=httpx.AsyncClient)
        client.get.return_value = mock_resp

        import asyncio
        cards = asyncio.run(fetcher.fetch_standard_cards_index(client, force=True))

        self.assertEqual(len(cards), 4)
        self.assertEqual(cards[2]["id"], "me01-010")
        self.assertTrue(fetcher.standard_index_path.exists())

    def test_resolve_standard_card_ids_uses_cache(self):
        fetcher = TCGdexFetcher(data_dir=self.data_dir, provider=FetcherProvider.sdk)
        # Écrire directement dans le cache
        fetcher.standard_index_path.write_text(
            json.dumps(self.mock_standard_cards, ensure_ascii=False),
            encoding="utf-8",
        )

        client = AsyncMock(spec=httpx.AsyncClient)
        import asyncio
        ids = asyncio.run(fetcher.resolve_standard_card_ids(client, limit=2, force=False))

        self.assertEqual(len(ids), 2)
        self.assertEqual(ids, ["sv01-001", "sv01-002"])

    def test_fetch_cards_cli_command(self):
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            with patch("compiler.tcgdex_fetcher.TCGdexFetcher.fetch_standard_cards_index", new=AsyncMock(return_value=self.mock_standard_cards)):
                result = runner.invoke(app, ["fetch-cards"])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("Mise à Jour de la Liste Standard", result.stdout)
                self.assertIn("Cartes légales au format Standard", result.stdout)
                self.assertIn("4", result.stdout)
                self.assertIn("sv01", result.stdout)

    def test_update_cards_alias(self):
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            with patch("compiler.tcgdex_fetcher.TCGdexFetcher.fetch_standard_cards_index", new=AsyncMock(return_value=self.mock_standard_cards)):
                result = runner.invoke(app, ["update-cards"])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("Mise à Jour de la Liste Standard", result.stdout)

    def test_download_raw_cards_method(self):
        fetcher = TCGdexFetcher(data_dir=self.data_dir, provider=FetcherProvider.sdk)

        mock_bundle = MagicMock()
        mock_bundle.identity.nameFr = "Pikachu"
        mock_bundle.card_id = "sv01-001"

        with patch.object(fetcher, "fetch_card_by_id", new=AsyncMock(return_value=mock_bundle)):
            client = AsyncMock(spec=httpx.AsyncClient)
            progress_events = []

            def on_prog(cid, cname, newly, err):
                progress_events.append((cid, cname, newly, err))

            import asyncio
            stats = asyncio.run(fetcher.download_raw_cards(
                card_ids=["sv01-001", "sv01-002"],
                client=client,
                force=False,
                progress_callback=on_prog,
            ))

            self.assertEqual(stats["total"], 2)
            self.assertEqual(stats["downloaded"], 2)
            self.assertEqual(stats["failed"], 0)
            self.assertEqual(len(progress_events), 2)

    def test_fetch_cards_cli_with_raw_option(self):
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            with patch("compiler.tcgdex_fetcher.TCGdexFetcher.fetch_standard_cards_index", new=AsyncMock(return_value=self.mock_standard_cards)):
                mock_stats = {
                    "total": 2,
                    "cached": 0,
                    "downloaded": 2,
                    "failed": 0,
                    "failed_cards": {},
                    "elapsed_seconds": 0.5,
                }
                with patch("compiler.tcgdex_fetcher.TCGdexFetcher.download_raw_cards", new=AsyncMock(return_value=mock_stats)):
                    result = runner.invoke(app, ["fetch-cards", "--raw", "--limit", "2"])
                    self.assertEqual(result.exit_code, 0)
                    self.assertIn("Mise à Jour du Cache raw_tcgdex Terminée", result.stdout)
                    self.assertIn("Nouvelles fiches téléchargées : 2", result.stdout)

    def test_fetch_cards_cli_with_ids_file(self):
        # Créer un fichier temporaire avec 3 IDs dont un doublon
        test_file = self.data_dir / "test_ids.txt"
        test_file.write_text("sv01-001\nsv01-002\nsv01-001\n", encoding="utf-8")

        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            mock_stats = {
                "total": 2,
                "cached": 1,
                "downloaded": 1,
                "failed": 0,
                "failed_cards": {},
                "elapsed_seconds": 0.2,
            }
            with patch("compiler.tcgdex_fetcher.TCGdexFetcher.download_raw_cards", new=AsyncMock(return_value=mock_stats)) as mock_dl:
                result = runner.invoke(app, ["fetch-cards", "-f", str(test_file)])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("Mise à Jour du Cache raw_tcgdex Terminée", result.stdout)
                # Vérifier que download_raw_cards a bien reçu les IDs dédupliqués
                mock_dl.assert_called_once()
                call_args = mock_dl.call_args[1]
                self.assertEqual(call_args["card_ids"], ["sv01-001", "sv01-002"])

    def test_fetch_raw_alias_command(self):
        with patch("compiler.cli.get_data_dir", return_value=self.data_dir):
            mock_stats = {
                "total": 1,
                "cached": 0,
                "downloaded": 1,
                "failed": 0,
                "failed_cards": {},
                "elapsed_seconds": 0.1,
            }
            with patch("compiler.tcgdex_fetcher.TCGdexFetcher.download_raw_cards", new=AsyncMock(return_value=mock_stats)):
                result = runner.invoke(app, ["fetch-raw", "--ids", "sv01-001"])
                self.assertEqual(result.exit_code, 0)
                self.assertIn("Mise à Jour du Cache raw_tcgdex Terminée", result.stdout)


if __name__ == "__main__":
    unittest.main()
