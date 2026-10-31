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
    find_best_model_candidate,
    parse_lms_ls_output,
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

    def test_remote_model_defaults_to_qwen38_27b_in_normal_mode(self):
        # En mode normal (--mode standard, tier qwen3), la machine distante doit cibler lmstudio-community/Qwen3.8-27B-GGUF par défaut
        with patch.dict("os.environ", {}, clear=True):
            compiler = LMStudioCardCompiler(ssh_host="gpu-node.internal")
            self.assertEqual(compiler.model_name, "lmstudio-community/Qwen3.8-27B-GGUF")
            self.assertEqual(compiler.tier, ModelTier.qwen3)

            # Test des autres tiers sur hôte distant
            compiler_fast = LMStudioCardCompiler(ssh_host="gpu-node.internal", tier=ModelTier.fast)
            self.assertEqual(compiler_fast.model_name, "qwen2.5-coder-7b-instruct")

            compiler_max = LMStudioCardCompiler(ssh_host="gpu-node.internal", tier=ModelTier.max)
            self.assertEqual(compiler_max.model_name, "lmstudio-community/Qwen3.8-27B-GGUF")

            # Normalisation automatique de Qwen3.8-27B vers lmstudio-community/Qwen3.8-27B-GGUF
            compiler_qwen38 = LMStudioCardCompiler(ssh_host="gpu-node.internal", model_name="Qwen3.8-27B")
            self.assertEqual(compiler_qwen38.model_name, "lmstudio-community/Qwen3.8-27B-GGUF")

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

    def test_parse_lms_ls_output(self):
        table_output = """
┌──────────────────────────────────────────────┬─────────────┬───────────┐
│ Model                                        │ Size        │ Format    │
├──────────────────────────────────────────────┼─────────────┼───────────┤
│ qwen2.5-coder-7b-instruct                    │ 4.68 GB     │ GGUF      │
│ bartowski/qwen2.5-coder-32b-instruct-gguf    │ 19.8 GB     │ GGUF      │
└──────────────────────────────────────────────┴─────────────┴───────────┘
"""
        parsed = parse_lms_ls_output(table_output)
        self.assertEqual(parsed, ["qwen2.5-coder-7b-instruct", "bartowski/qwen2.5-coder-32b-instruct-gguf"])

        json_out = json.dumps([{"id": "model-1"}, {"name": "model-2"}])
        self.assertEqual(parse_lms_ls_output(json_out), ["model-1", "model-2"])

        # Test des séquences d'échappement ANSI et des puces
        ansi_bullet_output = "\x1b[1mLLMs\x1b[0m\n  \x1b[36m•\x1b[0m \x1b[32mqwen2.5-coder-32b-instruct\x1b[0m (32.5B, 4-bit)\n"
        self.assertEqual(parse_lms_ls_output(ansi_bullet_output), ["qwen2.5-coder-32b-instruct"])

        # Test des lignes de résumé
        summary_output = "You have 1 model available:\n- lmstudio-community/Qwen2.5-Coder-32B-Instruct-GGUF"
        self.assertEqual(parse_lms_ls_output(summary_output), ["lmstudio-community/Qwen2.5-Coder-32B-Instruct-GGUF"])

    def test_find_best_model_candidate(self):
        cands = [
            "qwen2.5-coder-7b-instruct",
            "lmstudio-community/Qwen3.8-27B-GGUF",
            "mistral-7b-instruct",
        ]
        # Recherche d'un modèle Qwen3.8 27B
        self.assertEqual(
            find_best_model_candidate(cands, "Qwen3.8-27B"),
            "lmstudio-community/Qwen3.8-27B-GGUF",
        )
        self.assertEqual(
            find_best_model_candidate(cands, "qwen3.8-27b"),
            "lmstudio-community/Qwen3.8-27B-GGUF",
        )
        self.assertEqual(
            find_best_model_candidate(cands, "lmstudio-community/Qwen3.8-27B-GGUF"),
            "lmstudio-community/Qwen3.8-27B-GGUF",
        )
        # Recherche exacte
        self.assertEqual(
            find_best_model_candidate(cands, "qwen2.5-coder-7b-instruct"),
            "qwen2.5-coder-7b-instruct",
        )
        # Si aucun match, retourne None pour signaler un modèle non désiré
        self.assertIsNone(find_best_model_candidate(cands, "unknown-model"))
        # Si aucun target n'est fourni, retourne le premier candidat
        self.assertEqual(find_best_model_candidate(cands, None), "qwen2.5-coder-7b-instruct")

    def test_remote_available_models_discovery_with_find_fallback(self):
        compiler = LMStudioCardCompiler(ssh_host="gpu-node.internal", auto_start=False)
        # Simule lms ls échouant, mais find ~/.cache/lm-studio/models retournant des fichiers .gguf
        def fake_run_ssh(cmd: str):
            if "ls --json" in cmd or "lms ls" in cmd:
                return (1, "", "command not supported")
            if "find ~/.cache" in cmd:
                return (0, "/home/eth/.cache/lm-studio/models/lmstudio-community/Qwen3.8-27B-GGUF/model.gguf\n", "")
            return (0, "OK", "")

        with patch.object(compiler, "_run_ssh_command", side_effect=fake_run_ssh):
            models = compiler._get_remote_available_models()
            self.assertIn("lmstudio-community/Qwen3.8-27B-GGUF", models)
        compiler.close()

    def test_load_remote_model_loads_canonical_qwen38_27b(self):
        compiler = LMStudioCardCompiler(
            ssh_host="gpu-node.internal",
            model_name="Qwen3.8-27B",
            auto_start=False,
        )
        with patch.object(compiler, "_get_remote_available_models", return_value=[]), \
             patch.object(compiler, "_run_ssh_command", return_value=(0, "Success", "")) as mock_ssh:
            compiler._load_remote_model_via_cli()
            # Doit tenter le chargement avec le nom de dépôt officiel LM Studio
            self.assertEqual(compiler.model_name, "lmstudio-community/Qwen3.8-27B-GGUF")
            mock_ssh.assert_called_with("lms load lmstudio-community/Qwen3.8-27B-GGUF --gpu max -y")
        compiler.close()

    def test_load_remote_model_prefers_downloaded_over_unverified_target(self):
        compiler = LMStudioCardCompiler(
            ssh_host="gpu-node.internal",
            model_name="non-existent-arbitrary-model",
            auto_start=False,
        )
        with patch.object(compiler, "_get_remote_available_models", return_value=["lmstudio-community/Qwen3.8-27B-GGUF"]), \
             patch.object(compiler, "_run_ssh_command", return_value=(0, "Success", "")) as mock_ssh:
            compiler._load_remote_model_via_cli()
            # Doit charger le modèle existant téléchargé et non la chaîne arbitraire
            self.assertEqual(compiler.model_name, "lmstudio-community/Qwen3.8-27B-GGUF")
            mock_ssh.assert_called_with("lms load lmstudio-community/Qwen3.8-27B-GGUF --gpu max -y")
        compiler.close()

    @patch("time.sleep", return_value=None)
    @patch("httpx.Client")
    def test_load_model_in_memory_auto_loads_via_rest_when_no_active_model(self, mock_client_cls, mock_sleep):
        # 1. /v1/models retourne vide au début
        empty_models_resp = MagicMock()
        empty_models_resp.is_success = True
        empty_models_resp.status_code = 200
        empty_models_resp.json.return_value = {"data": []}

        # 2. /api/v1/models retourne la liste des modèles téléchargés
        downloaded_resp = MagicMock()
        downloaded_resp.is_success = True
        downloaded_resp.status_code = 200
        downloaded_resp.json.return_value = {
            "data": [{"id": "qwen2.5-coder-32b-instruct"}]
        }

        # 3. /api/v1/models/load réussit
        load_resp = MagicMock()
        load_resp.is_success = True
        load_resp.status_code = 200
        load_resp.json.return_value = {"status": "loaded"}

        # 4. Le polling /v1/models retourne maintenant le modèle chargé
        loaded_models_resp = MagicMock()
        loaded_models_resp.is_success = True
        loaded_models_resp.status_code = 200
        loaded_models_resp.json.return_value = {
            "data": [{"id": "qwen2.5-coder-32b-instruct"}]
        }

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.get.side_effect = [
            empty_models_resp,    # GET /v1/models initial
            downloaded_resp,      # GET /api/v1/models
            loaded_models_resp,   # Polling GET /v1/models
        ]
        mock_client.post.return_value = load_resp  # POST /api/v1/models/load
        mock_client_cls.return_value = mock_client

        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="Qwen3.8-27B",
            auto_start=False,
        )
        compiler.load_model_in_memory()
        self.assertTrue(compiler._ready)
        self.assertEqual(compiler.model_name, "qwen2.5-coder-32b-instruct")
        compiler.close()

    @patch("time.sleep", return_value=None)
    @patch("httpx.Client")
    def test_load_model_in_memory_raises_informative_error_when_no_model(self, mock_client_cls, mock_sleep):
        empty_resp = MagicMock()
        empty_resp.is_success = True
        empty_resp.status_code = 200
        empty_resp.json.return_value = {"data": []}

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.get.return_value = empty_resp
        mock_client.post.return_value = MagicMock(is_success=False, status_code=404)
        mock_client_cls.return_value = mock_client

        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="Qwen3.8-27B",
            auto_start=False,
        )
        with self.assertRaises(RuntimeError) as ctx:
            compiler.load_model_in_memory()

        self.assertIn("Aucun modèle n'est chargé dans LM Studio", str(ctx.exception))
        self.assertIn("lms load", str(ctx.exception))
        compiler.close()

    @patch("subprocess.run")
    def test_unload_model_calls_unload_all(self, mock_subproc):
        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="test-model",
            auto_start=False,
        )
        compiler.unload_model()
        mock_subproc.assert_called_with(
            [compiler.cli_path, "unload", "--all"],
            capture_output=True,
            text=True,
            check=False,
        )

    def test_close_unloads_model_first(self):
        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="test-model",
            auto_start=False,
        )
        with patch.object(compiler, "unload_model") as mock_unload:
            compiler.close()
            mock_unload.assert_called_once()
            self.assertFalse(compiler._ready)

    @patch("time.sleep", return_value=None)
    @patch("httpx.Client")
    def test_startup_deloads_unneeded_models_and_loads_needed(self, mock_client_cls, mock_sleep):
        # 1. Au départ, un modèle non requis 'other-unneeded-model' est actif
        unneeded_resp = MagicMock()
        unneeded_resp.is_success = True
        unneeded_resp.status_code = 200
        unneeded_resp.json.return_value = {"data": [{"id": "other-unneeded-model"}]}

        # 2. Après déchargement et chargement, le modèle requis 'qwen3.8-27b' apparaît actif
        needed_resp = MagicMock()
        needed_resp.is_success = True
        needed_resp.status_code = 200
        needed_resp.json.return_value = {"data": [{"id": "qwen3.8-27b"}]}

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.get.side_effect = [unneeded_resp, needed_resp]
        mock_client.post.return_value = MagicMock(is_success=True, status_code=200)
        mock_client_cls.return_value = mock_client

        compiler = LMStudioCardCompiler(
            ssh_host=None,
            remote_port=1234,
            model_name="Qwen3.8-27B",
            auto_start=False,
        )
        with patch.object(compiler, "unload_model") as mock_unload:
            compiler.load_model_in_memory()
            # Doit avoir déchargé le modèle non requis
            mock_unload.assert_called()
            self.assertEqual(compiler.model_name, "qwen3.8-27b")
            self.assertTrue(compiler._ready)
        compiler.close()

    def test_cli_stops_immediately_on_compilation_error(self):
        import typer
        from compiler.cli import _execute_run_pipeline, RunMode, FetcherProvider, LLMProvider
        mock_engine = MagicMock()
        mock_engine.load_model_in_memory.return_value = None
        mock_engine.compile_card.side_effect = RuntimeError("Fatal LLM crash")

        with patch("compiler.cli.create_compiler_engine", return_value=mock_engine), \
             patch("compiler.cli.TCGdexFetcher") as mock_fetcher_cls:
            mock_fetcher = MagicMock()
            mock_bundle = MagicMock()
            mock_bundle.card_id = "test-fail-001"
            mock_bundle.identity.nameFr = "Test Carte"
            async def _fake_fetch(*args, **kwargs):
                return [mock_bundle]
            mock_fetcher.fetch_batch = _fake_fetch
            mock_fetcher_cls.return_value = mock_fetcher

            with patch("compiler.cli.is_basic_energy", return_value=False), \
                 patch("pathlib.Path.exists", return_value=False):
                with self.assertRaises(typer.Exit) as ctx:
                    _execute_run_pipeline(
                        mode=RunMode.test,
                        test_flag=True,
                        standard_flag=False,
                        ids="test-fail-001",
                        provider=FetcherProvider.sdk,
                        llm_provider=LLMProvider.lm_studio,
                        tier=ModelTier.qwen3,
                        fast=False,
                        force=True,
                        limit=None,
                    )
                self.assertEqual(ctx.exception.exit_code, 1)
                mock_engine.close.assert_called_once()


if __name__ == "__main__":
    unittest.main()
