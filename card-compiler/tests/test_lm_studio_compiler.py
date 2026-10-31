"""Tests unitaires pour le provider LM Studio (local et distant via SSH)."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from compiler.cli import LLMProvider, create_compiler_engine
from compiler.llm_engine import ModelTier
from compiler.lm_studio_compiler import (
    LMStudioCardCompiler,
    extract_json_payload,
    find_available_port,
)
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

    def test_ssh_with_password_using_sshpass(self):
        with patch("compiler.lm_studio_compiler._find_sshpass", return_value="/usr/bin/sshpass"):
            compiler = LMStudioCardCompiler(
                ssh_host="gpu-node.internal",
                ssh_user="remoteuser",
                ssh_password="mypassword123",
            )
            self.assertEqual(compiler.ssh_password, "mypassword123")

            cmd = compiler._build_ssh_base_command()
            self.assertEqual(cmd[0], "/usr/bin/sshpass")
            self.assertEqual(cmd[1], "-e")
            self.assertEqual(cmd[2], "ssh")
            self.assertIn("BatchMode=no", " ".join(cmd))
            self.assertIn("PreferredAuthentications=password,keyboard-interactive,publickey", " ".join(cmd))
            self.assertIn("PubkeyAuthentication=no", " ".join(cmd))

            env = compiler._get_ssh_env()
            self.assertEqual(env["SSHPASS"], "mypassword123")
            compiler.close()

    def test_ssh_with_password_fallback_askpass(self):
        with patch("compiler.lm_studio_compiler._find_sshpass", return_value=None):
            compiler = LMStudioCardCompiler(
                ssh_host="gpu-node.internal",
                ssh_user="remoteuser",
                ssh_password="askpass_secret",
            )
            self.assertEqual(compiler.ssh_password, "askpass_secret")

            cmd = compiler._build_ssh_base_command()
            self.assertEqual(cmd[0], "ssh")
            self.assertIn("BatchMode=no", " ".join(cmd))

            env = compiler._get_ssh_env()
            self.assertEqual(env["SSHPASS"], "askpass_secret")
            self.assertEqual(env.get("SSH_ASKPASS_REQUIRE"), "force")
            askpass_path = env.get("SSH_ASKPASS")
            self.assertIsNotNone(askpass_path)
            self.assertTrue(Path(askpass_path).exists())

            # Le nettoyage à la fermeture doit supprimer le script temporaire
            compiler.close()
            self.assertFalse(Path(askpass_path).exists())

    def test_create_compiler_engine_with_ssh_password(self):
        engine = create_compiler_engine(
            provider=LLMProvider.lm_studio,
            ssh_password="cli_passed_password",
        )
        self.assertIsInstance(engine, LMStudioCardCompiler)
        self.assertEqual(engine.ssh_password, "cli_passed_password")
        engine.close()

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

    def test_extract_json_payload(self):
        # 1. JSON pur
        self.assertEqual(extract_json_payload('{"a": 1}'), '{"a": 1}')
        # 2. Markdown fence ```json
        self.assertEqual(extract_json_payload('```json\n{"a": 1}\n```'), '{"a": 1}')
        # 3. Markdown fence sans langage ```
        self.assertEqual(extract_json_payload('```\n{"a": 1}\n```'), '{"a": 1}')
        # 4. Balises <think> (modèles raisonnants type DeepSeek R1 / Qwen QwQ)
        self.assertEqual(
            extract_json_payload('<think>Analyse interne...</think>\n```json\n{"a": 1}\n```'),
            '{"a": 1}',
        )
        # 5. Texte libre avant et après le JSON
        self.assertEqual(
            extract_json_payload('Voici la carte générée :\n{"a": 1}\nBonne compilation !'),
            '{"a": 1}',
        )

    @patch("httpx.Client")
    def test_load_model_in_memory_model_fallback(self, mock_client_cls):
        # Si le modèle cible ("Qwen3.8-27B") n'est pas chargé, mais qu'un autre modèle actif existe
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [{"id": "meta-llama-3-8b-instruct"}]
        }
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="Qwen3.8-27B",
            auto_start=False,
        )
        compiler.load_model_in_memory()
        # Doit impérativement adopter le modèle actuellement chargé dans LM Studio
        self.assertEqual(compiler.model_name, "meta-llama-3-8b-instruct")
        compiler.close()

    @patch("httpx.Client")
    def test_load_model_in_memory_smart_matching(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "data": [
                {"id": "qwen2.5-coder-7b-instruct"},
                {"id": "qwen3.8-27b-chat@q6_k"},
            ]
        }
        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.get.return_value = mock_resp
        mock_client_cls.return_value = mock_client

        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="Qwen3.8-27B",
            auto_start=False,
        )
        compiler.load_model_in_memory()
        self.assertEqual(compiler.model_name, "qwen3.8-27b-chat@q6_k")
        compiler.close()

    @patch("httpx.Client")
    def test_compile_card_400_fallback_cascade(self, mock_client_cls):
        # Simule le cas où json_schema retourne 400, json_object retourne 400,
        # puis le format brut sans response_format retourne 200 avec Markdown JSON.
        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="test-model",
            auto_start=False,
        )
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Test fallback",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [],
            "strategicEvaluator": {
                "primaryRole": "TECH_UTILITY",
                "intrinsicBaseScore": 50,
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "discardPriorityWhenDead": 50,
                "holdForNextTurnBonus": 0,
            },
        }

        resp_400_schema = MagicMock()
        resp_400_schema.is_success = False
        resp_400_schema.status_code = 400
        resp_400_schema.json.return_value = {"error": {"message": "Invalid response_format: json_schema not supported"}}
        resp_400_schema.text = "json_schema not supported"

        resp_400_obj = MagicMock()
        resp_400_obj.is_success = False
        resp_400_obj.status_code = 400
        resp_400_obj.json.return_value = {"error": {"message": "Invalid response_format: json_object not supported"}}
        resp_400_obj.text = "json_object not supported"

        resp_200_raw = MagicMock()
        resp_200_raw.is_success = True
        resp_200_raw.status_code = 200
        resp_200_raw.json.return_value = {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": f"<think>thinking...</think>\n```json\n{json.dumps(fake_card_json)}\n```",
                    },
                }
            ]
        }

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.side_effect = [resp_400_schema, resp_400_obj, resp_200_raw]
        mock_client_cls.return_value = mock_client

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {
            "requestedId": "test-001",
            "fr": {
                "id": "test-001",
                "name": "Test",
                "category": "Dresseur",
                "trainerType": "Objet",
                "localId": "001",
                "set": {"id": "test", "name": "Test Set"},
            },
        }
        identity, pstats = fetcher.build_deterministic_models(
            raw_card["requestedId"],
            raw_card["fr"],
            None,
        )
        bundle = FetchedCardBundle(
            card_id="test-001",
            resolved_tcgdex_id="test-001",
            raw_fr=raw_card["fr"],
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("dummy"),
        )

        model = compiler.compile_card(bundle)
        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(model.cardId, "test-001")
        self.assertEqual(model.category, CardCategory.TRAINER)
        # Vérifie que _use_json_schema_format a été désactivé pour les appels ultérieurs
        self.assertFalse(compiler._use_json_schema_format)
        compiler.close()

    @patch("httpx.Client")
    def test_compile_card_400_model_hot_update(self, mock_client_cls):
        # Simule le cas où LM Studio renvoie 400 'model not loaded',
        # puis le compilateur ré-interroge /models, trouve le modèle actif et réussit l'appel
        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="unloaded-model",
            auto_start=False,
        )
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Test model hot update",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [],
            "strategicEvaluator": {
                "primaryRole": "TECH_UTILITY",
                "intrinsicBaseScore": 50,
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "discardPriorityWhenDead": 50,
                "holdForNextTurnBonus": 0,
            },
        }

        resp_400_model = MagicMock()
        resp_400_model.is_success = False
        resp_400_model.status_code = 400
        resp_400_model.json.return_value = {"error": {"message": "Model 'unloaded-model' not found or not loaded"}}
        resp_400_model.text = "Model not found"

        resp_200_ok = MagicMock()
        resp_200_ok.is_success = True
        resp_200_ok.status_code = 200
        resp_200_ok.json.return_value = {
            "choices": [
                {
                    "finish_reason": "stop",
                    "message": {
                        "content": json.dumps(fake_card_json),
                    },
                }
            ]
        }

        models_resp = MagicMock()
        models_resp.is_success = True
        models_resp.json.return_value = {"data": [{"id": "active-live-model"}]}

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.side_effect = [resp_400_model, resp_200_ok]
        mock_client.get.return_value = models_resp
        mock_client_cls.return_value = mock_client

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {
            "requestedId": "test-002",
            "fr": {
                "id": "test-002",
                "name": "Test 2",
                "category": "Dresseur",
                "trainerType": "Objet",
                "localId": "002",
                "set": {"id": "test", "name": "Test Set"},
            },
        }
        identity, pstats = fetcher.build_deterministic_models(
            raw_card["requestedId"],
            raw_card["fr"],
            None,
        )
        bundle = FetchedCardBundle(
            card_id="test-002",
            resolved_tcgdex_id="test-002",
            raw_fr=raw_card["fr"],
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("dummy"),
        )

        model = compiler.compile_card(bundle)
        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(compiler.model_name, "active-live-model")
        compiler.close()

    @patch("httpx.Client")
    def test_compile_card_400_error_detail_transparency(self, mock_client_cls):
        # Vérifie que l'exception RuntimeError finale contient bien le détail exact de l'erreur LM Studio
        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="test-model",
            auto_start=False,
        )
        compiler._ready = True

        resp_400 = MagicMock()
        resp_400.is_success = False
        resp_400.status_code = 400
        resp_400.json.return_value = {
            "error": {"message": "Model 'test-model' is not loaded in memory and no server is serving it"}
        }
        resp_400.text = "Model not loaded"

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.post.return_value = resp_400
        # models endpoint retourne vide
        models_resp = MagicMock()
        models_resp.is_success = True
        models_resp.json.return_value = {"data": []}
        mock_client.get.return_value = models_resp
        mock_client_cls.return_value = mock_client

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {
            "requestedId": "test-001",
            "fr": {
                "id": "test-001",
                "name": "Test",
                "category": "Dresseur",
                "trainerType": "Objet",
                "localId": "001",
                "set": {"id": "test", "name": "Test Set"},
            },
        }
        identity, pstats = fetcher.build_deterministic_models(
            raw_card["requestedId"],
            raw_card["fr"],
            None,
        )
        bundle = FetchedCardBundle(
            card_id="test-001",
            resolved_tcgdex_id="test-001",
            raw_fr=raw_card["fr"],
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("dummy"),
        )

        with self.assertRaises(RuntimeError) as ctx:
            compiler.compile_card(bundle, max_retries=0)

        self.assertIn("Model 'test-model' is not loaded", str(ctx.exception))
        compiler.close()


if __name__ == "__main__":
    unittest.main()
