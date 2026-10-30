"""Tests unitaires pour le provider LM Studio (local et distant via SSH)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from compiler.cli import LLMProvider, create_compiler_engine
from compiler.llm_engine import ModelTier
from compiler.lm_studio_compiler import LMStudioCardCompiler, find_available_port
from compiler.schemas import CardCategory, CardSubCategory, EngineCardModel


class TestLMStudioCompiler(unittest.TestCase):
    def test_find_available_port(self):
        port = find_available_port(19876)
        self.assertIsInstance(port, int)
        self.assertGreaterEqual(port, 19876)

    def test_init_with_ssh_and_tunnel_config(self):
        compiler = LMStudioCardCompiler(
            ssh_host="gpu-node.internal",
            ssh_port=2222,
            ssh_user="ai-user",
            ssh_key_path="~/.ssh/test_key",
            remote_port=1234,
            local_port=12345,
            use_tunnel=True,
            model_name="qwen3-14b",
        )
        self.assertEqual(compiler.ssh_host, "gpu-node.internal")
        self.assertEqual(compiler.ssh_port, 2222)
        self.assertEqual(compiler.ssh_user, "ai-user")
        self.assertEqual(compiler.ssh_target, "ai-user@gpu-node.internal:2222")
        self.assertEqual(compiler.repo_id, "LM_STUDIO_REMOTE")
        self.assertIn("qwen3-14b", compiler.filename)
        self.assertIn("127.0.0.1", compiler.api_base_url)

        # Vérification des arguments SSH de base
        ssh_cmd = compiler._build_ssh_base_command()
        self.assertEqual(ssh_cmd[0], "ssh")
        self.assertIn("-p", ssh_cmd)
        self.assertIn("2222", ssh_cmd)
        self.assertIn("ai-user@gpu-node.internal", ssh_cmd)

    def test_remote_model_defaults_to_qwen_27b_in_normal_mode(self):
        # En mode normal (--mode standard, tier qwen3), la machine distante doit cibler Qwen3.8-27B par défaut
        with patch.dict("os.environ", {}, clear=True):
            compiler = LMStudioCardCompiler(ssh_host="gpu-node.internal")
            self.assertEqual(compiler.model_name, "Qwen3.8-27B")
            self.assertEqual(compiler.tier, ModelTier.qwen3)

            # Test des autres tiers sur hôte distant
            compiler_fast = LMStudioCardCompiler(ssh_host="gpu-node.internal", tier=ModelTier.fast)
            self.assertEqual(compiler_fast.model_name, "Qwen2.5-Coder-7B-Instruct")

            compiler_max = LMStudioCardCompiler(ssh_host="gpu-node.internal", tier=ModelTier.max)
            self.assertEqual(compiler_max.model_name, "Qwen3-30B-A3B")

            # Override explicite par argument ou variable d'environnement
            compiler_custom = LMStudioCardCompiler(ssh_host="gpu-node.internal", model_name="custom-model-40b")
            self.assertEqual(compiler_custom.model_name, "custom-model-40b")

    def test_init_local_lm_studio_without_ssh(self):
        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="local-qwen",
        )
        self.assertIsNone(compiler.ssh_host)
        self.assertEqual(compiler.ssh_target, "localhost")
        self.assertEqual(compiler.repo_id, "LM_STUDIO_LOCAL")
        self.assertEqual(compiler.api_base_url, "http://127.0.0.1:1234/v1")

    def test_factory_create_compiler_engine(self):
        local_eng = create_compiler_engine(LLMProvider.local)
        self.assertEqual(local_eng.repo_id, "Qwen/Qwen3-14B-GGUF")

        lms_eng = create_compiler_engine(LLMProvider.lm_studio)
        self.assertIsInstance(lms_eng, LMStudioCardCompiler)

    def test_basic_energy_short_circuit(self):
        compiler = LMStudioCardCompiler(ssh_host="dummy-host")
        raw_energy = {
            "requestedId": "sve-002",
            "fr": {
                "id": "sve-002",
                "name": "Énergie Feu",
                "category": "Énergie",
                "energyType": "De base",
                "localId": "002",
                "set": {"id": "sve", "name": "Énergies"},
            },
            "en": {
                "id": "sve-002",
                "name": "Fire Energy",
                "category": "Energy",
                "energyType": "Normal",
            },
        }
        from compiler.static_cards import build_basic_energy_model
        model = compiler.compile_card(raw_energy)
        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(model.category, CardCategory.ENERGY)
        self.assertEqual(model.subCategory, CardSubCategory.BASIC_ENERGY)
        self.assertEqual(model.compilationMetadata.modelRepoId, "STATIC_DETERMINISTIC")

    @patch("httpx.Client")
    def test_mocked_chat_completion(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="qwen3-14b",
            auto_start=False,
        )
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "1) Catégorie TRAINER / ITEM. 2) Coûts : aucun. 3) Filtre : BASIC. 4) Carte morte : Banc plein.",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [
                {
                    "actionId": "play_nest_ball",
                    "label": "Faiblo Ball",
                    "sourceType": "TRAINER_PLAY",
                    "timing": "ONCE_PER_CARD",
                    "canUseTurn1GoingFirst": True,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [
                        {
                            "type": "BENCH_HAS_EMPTY_SLOTS",
                            "zone": "BENCH",
                            "minCount": 1,
                            "targetFilter": None,
                        }
                    ],
                    "costs": [],
                    "effects": [
                        {
                            "primitive": "SEARCH_DECK_TO_BENCH",
                            "sourceZone": "DECK",
                            "targetZone": "BENCH",
                            "count": 1,
                            "upTo": False,
                            "targetFilter": {
                                "category": "POKEMON",
                                "subCategory": "BASIC",
                                "maxHp": None,
                                "energyType": None,
                                "specificCardName": None,
                            },
                            "baseDamage": None,
                            "damageScalingPerOpponentPrizeTaken": None,
                        }
                    ],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "BENCH_DEPLOYER",
                "intrinsicBaseScore": 85,
                "turnPhaseWeights": {
                    "turn1": 1.9,
                    "turn2": 1.4,
                    "turn3": 0.8,
                    "turn4Plus": 0.5,
                },
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [
                    {
                        "reason": "BENCH_ALREADY_FULL",
                        "zonesToCheck": ["BENCH"],
                        "targetFilter": None,
                    }
                ],
                "discardPriorityWhenDead": 75,
                "holdForNextTurnBonus": 10,
            },
        }

        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps(fake_card_json),
                    },
                }
            ]
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        raw_card = {
            "requestedId": "sv01-181",
            "fr": {
                "id": "sv01-181",
                "name": "Faiblo Ball",
                "category": "Dresseur",
                "trainerType": "Objet",
                "localId": "181",
                "set": {"id": "sv01", "name": "Écarlate et Violet"},
            },
            "en": {
                "id": "sv01-181",
                "name": "Nest Ball",
                "category": "Trainer",
                "trainerType": "Item",
            },
        }

        from compiler.tcgdex_fetcher import TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        bundle = fetcher.build_deterministic_bundle(
            raw_card["requestedId"],
            raw_card["fr"],
            raw_card.get("en"),
        ) if hasattr(fetcher, "build_deterministic_bundle") else None

        if bundle is None:
            # Construction manuelle du bundle pour le test
            identity, pstats = fetcher.build_deterministic_models(
                raw_card["requestedId"],
                raw_card["fr"],
                raw_card.get("en"),
            )
            from compiler.tcgdex_fetcher import FetchedCardBundle
            bundle = FetchedCardBundle(
                card_id="sv01-181",
                resolved_tcgdex_id="sv01-181",
                raw_fr=raw_card["fr"],
                raw_en=raw_card.get("en"),
                identity=identity,
                pokemon_stats=pstats,
                raw_cache_path=Path("data/raw_tcgdex/sv01-181.json"),
            )

        model = compiler.compile_card(bundle)
        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(model.cardId, "sv01-181")
        self.assertEqual(model.category, CardCategory.TRAINER)
        self.assertEqual(model.subCategory, CardSubCategory.ITEM)
        self.assertEqual(model.strategicEvaluator.primaryRole.value, "BENCH_DEPLOYER")
        self.assertEqual(model.compilationMetadata.modelRepoId, "LM_STUDIO_LOCAL")


if __name__ == "__main__":
    unittest.main()
