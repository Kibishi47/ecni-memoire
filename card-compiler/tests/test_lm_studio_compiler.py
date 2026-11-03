"""Tests unitaires pour le provider LM Studio (API REST locale et distante)."""

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
    find_best_model_candidate,
    parse_lms_ls_output,
)
from compiler.schemas import CardCategory, CardSubCategory, EngineCardModel, LLMCompiledCardPart


class TestLMStudioCompiler(unittest.TestCase):
    def test_init_direct_ip(self):
        compiler = LMStudioCardCompiler(
            remote_host="198.51.100.1",
            remote_port=1234,
        )
        self.assertEqual(compiler.api_base_url, "http://198.51.100.1:1234/v1")
        self.assertEqual(compiler.repo_id, "LM_STUDIO_REMOTE")
        self.assertIn("http://198.51.100.1:1234/v1", compiler.filename)
        compiler.close()

    def test_init_direct_base_url(self):
        compiler = LMStudioCardCompiler(
            api_base_url="http://198.51.100.1:8080",
        )
        self.assertEqual(compiler.api_base_url, "http://198.51.100.1:8080/v1")
        compiler.close()

    def test_remote_model_defaults_to_none_for_auto_detection(self):
        # Sans variable LM_STUDIO_MODEL, le compilateur démarre en auto-détection (model_name=None)
        with patch.dict("os.environ", {}, clear=True):
            compiler = LMStudioCardCompiler(remote_host="gpu-node.internal")
            self.assertIsNone(compiler.model_name)

            # Si LM_STUDIO_MODEL est renseigné dans l'environnement
            with patch.dict("os.environ", {"LM_STUDIO_MODEL": "lmstudio-community/Qwen3.8-27B-GGUF"}):
                compiler_env = LMStudioCardCompiler(remote_host="gpu-node.internal")
                self.assertEqual(compiler_env.model_name, "lmstudio-community/Qwen3.8-27B-GGUF")

            # Override explicite par argument
            compiler_custom = LMStudioCardCompiler(remote_host="gpu-node.internal", model_name="custom-model-40b")
            self.assertEqual(compiler_custom.model_name, "custom-model-40b")

    def test_init_local_lm_studio(self):
        compiler = LMStudioCardCompiler(
            remote_port=1234,
            model_name="local-qwen",
        )
        self.assertEqual(compiler.repo_id, "LM_STUDIO")
        self.assertEqual(compiler.api_base_url, "http://127.0.0.1:1234/v1")

    def test_factory_create_compiler_engine(self):
        with patch.dict("os.environ", {"LOCAL_BACKEND": "llama_cpp"}):
            local_eng = create_compiler_engine(LLMProvider.local)
            self.assertEqual(local_eng.repo_id, "Qwen/Qwen3-14B-GGUF")

        lms_eng = create_compiler_engine(LLMProvider.lm_studio)
        self.assertIsInstance(lms_eng, LMStudioCardCompiler)

    def test_basic_energy_short_circuit(self):
        compiler = LMStudioCardCompiler(remote_host="dummy-host")
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
        self.assertEqual(model.compilationMetadata.modelRepoId, "LM_STUDIO")

    @patch("httpx.Client")
    def test_compile_card_falls_back_when_json_schema_returns_empty_content(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            remote_host="127.0.0.1",
            remote_port=1234,
            model_name="qwen3.8-27b",
        )
        compiler._ready = True
        self.assertTrue(compiler._use_json_schema_format)

        # 1er appel (json_schema) : succès HTTP 200 mais contenu vide (GBNF grammar conflict)
        mock_empty_resp = MagicMock()
        mock_empty_resp.is_success = True
        mock_empty_resp.status_code = 200
        mock_empty_resp.json.return_value = {
            "choices": [{"message": {"content": ""}, "finish_reason": "stop"}]
        }

        # 2e appel (json_object ou none) : succès HTTP 200 avec le JSON complet valide
        fake_card_payload = {
            "reasoningAnalysis": "Statitik est un Pokémon de base rapide.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [],
            "strategicEvaluator": {
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 50,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {
                    "turn1": 1.5,
                    "turn2": 1.0,
                    "turn3": 0.5,
                    "turn4Plus": 0.2,
                },
            },
        }
        mock_valid_resp = MagicMock()
        mock_valid_resp.is_success = True
        mock_valid_resp.status_code = 200
        mock_valid_resp.json.return_value = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps(fake_card_payload)
                    },
                    "finish_reason": "stop",
                }
            ]
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.side_effect = [mock_empty_resp, mock_valid_resp]
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        identity, pstats = fetcher.build_deterministic_models(
            "sv06.5-001",
            {"id": "sv06.5-001", "name": "Statitik", "category": "Pokémon", "stage": "Base", "hp": 40, "types": ["Plante"], "attacks": [{"name": "Esquive", "damage": 10, "cost": ["Plante"]}]},
            None,
        )
        bundle = FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr={"id": "sv06.5-001"},
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

        model = compiler.compile_card(bundle)
        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(model.cardId, "sv06.5-001")
        self.assertFalse(compiler._use_json_schema_format)

    @patch("httpx.Client")
    def test_compile_card_computes_tokens_per_second_from_usage(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            remote_host="127.0.0.1",
            remote_port=1234,
            model_name="qwen3.8-27b",
        )
        compiler._ready = True

        fake_card_payload = {
            "reasoningAnalysis": "Statitik test TPS.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [],
            "strategicEvaluator": {
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 50,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(fake_card_payload)}, "finish_reason": "stop"}],
            "usage": {
                "prompt_tokens": 500,
                "completion_tokens": 200,
                "total_tokens": 700,
            },
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        identity, pstats = fetcher.build_deterministic_models(
            "sv06.5-001",
            {"id": "sv06.5-001", "name": "Statitik", "category": "Pokémon", "stage": "Base", "hp": 40, "types": ["Plante"], "attacks": []},
            None,
        )
        bundle = FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr={"id": "sv06.5-001"},
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

        model = compiler.compile_card(bundle)
        self.assertIsNotNone(model.compilationMetadata)
        self.assertEqual(model.compilationMetadata.completionTokens, 200)
        self.assertIsNotNone(model.compilationMetadata.tokensPerSecond)
        self.assertGreater(model.compilationMetadata.tokensPerSecond, 0.0)

    @patch("httpx.Client")
    def test_compile_card_with_streaming_and_live_token_callback(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            remote_host="127.0.0.1",
            remote_port=1234,
            model_name="qwen3.8-27b",
        )
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Test streaming.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [],
            "strategicEvaluator": {
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 50,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }

        # Découpage du JSON en 3 chunks simulés SSE
        json_str = json.dumps(fake_card_json)
        chunk1 = json_str[:30]
        chunk2 = json_str[30:80]
        chunk3 = json_str[80:]

        sse_lines = [
            f"data: {json.dumps({'choices': [{'delta': {'content': chunk1}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': chunk2}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': chunk3}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}], 'usage': {'completion_tokens': 3}})}",
            "data: [DONE]",
        ]

        mock_stream_resp = MagicMock()
        mock_stream_resp.is_success = True
        mock_stream_resp.status_code = 200
        mock_stream_resp.iter_lines.return_value = sse_lines

        # Configuration du context manager client.stream
        mock_stream_cm = MagicMock()
        mock_stream_cm.__enter__.return_value = mock_stream_resp

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.stream.return_value = mock_stream_cm
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        identity, pstats = fetcher.build_deterministic_models(
            "sv06.5-001",
            {"id": "sv06.5-001", "name": "Statitik", "category": "Pokémon", "stage": "Base", "hp": 40, "types": ["Plante"], "attacks": []},
            None,
        )
        bundle = FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr={"id": "sv06.5-001"},
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

        live_updates: List[Tuple[int, float]] = []
        model = compiler.compile_card(
            bundle,
            on_token=lambda tok, tps: live_updates.append((tok, tps)),
        )

        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(model.cardId, "sv06.5-001")
        self.assertGreater(len(live_updates), 0)
        self.assertEqual(live_updates[-1][0], 3)
        self.assertGreater(live_updates[-1][1], 0.0)
        self.assertEqual(model.compilationMetadata.completionTokens, 3)

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
        # 5. Balises <think> NON FERMÉES (interruption ou troncature)
        self.assertEqual(
            extract_json_payload('<think>Analyse en cours sans fin...\n{"a": 1}'),
            '{"a": 1}',
        )
        # 6. Balises <think> seules sans JSON
        self.assertEqual(
            extract_json_payload('<think>Analyse sans aucun objet'),
            '',
        )
        # 7. Chaîne vide
        self.assertEqual(extract_json_payload(''), '')
        # 8. Texte libre avant et après le JSON
        self.assertEqual(
            extract_json_payload('Voici la carte générée :\n{"a": 1}\nBonne compilation !'),
            '{"a": 1}',
        )
        # 9. Blocs multiples : ignore l'effet isolé et extrait la carte complète
        multi_block = (
            'Effet isolé :\n```json\n{"primitive": "DEAL_DAMAGE_ACTIVE", "baseDamage": 10}\n```\n'
            'Carte complète :\n```json\n{"reasoningAnalysis": "test", "playableActions": []}\n```'
        )
        self.assertEqual(
            extract_json_payload(multi_block),
            '{"reasoningAnalysis": "test", "playableActions": []}',
        )

    @patch("httpx.Client")
    def test_compile_card_recovers_when_llm_outputs_isolated_action_effect(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            remote_host="127.0.0.1",
            remote_port=1234,
            model_name="qwen3.8-27b",
        )
        compiler._ready = True

        isolated_effect_json = {
            "primitive": "DEAL_DAMAGE_ACTIVE",
            "sourceZone": "ACTIVE",
            "targetZone": "ACTIVE",
            "count": 1,
            "upTo": False,
            "targetFilter": None,
            "baseDamage": 10,
            "damageScalingPerOpponentPrizeTaken": None,
        }
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(isolated_effect_json)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 50},
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        identity, pstats = fetcher.build_deterministic_models(
            "sv06.5-001",
            {
                "id": "sv06.5-001",
                "name": "Statitik",
                "category": "Pokémon",
                "stage": "Base",
                "hp": 40,
                "types": ["Plante"],
                "attacks": [{"name": "Esquive Éclaboussante", "damage": 10, "cost": ["Plante"]}],
            },
            None,
        )
        bundle = FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr={"id": "sv06.5-001", "attacks": [{"name": "Esquive Éclaboussante"}]},
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

        model = compiler.compile_card(bundle)
        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(model.cardId, "sv06.5-001")
        self.assertEqual(len(model.playableActions), 1)
        self.assertEqual(model.playableActions[0].effects[0].primitive.value, "DEAL_DAMAGE_ACTIVE")

    @patch("httpx.Client")
    def test_load_model_in_memory_auto_detects_server_model(self, mock_client_cls):
        # En mode auto-détection (model_name=None), adopte le modèle actuellement chargé sur le serveur
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
            remote_port=1234,
            model_name=None,
            auto_start=False,
        )
        compiler.load_model_in_memory()
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
        resp_400_schema.json.return_value = {"error": {"message": "'response_format.type' must be 'json_schema' or 'text'"}}
        resp_400_schema.text = "'response_format.type' must be 'json_schema' or 'text'"

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
        mock_client.post.side_effect = [resp_400_schema, resp_200_raw]
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

    @patch("httpx.Client")
    def test_load_model_in_memory_raises_informative_error_when_no_model(self, mock_client_cls):
        empty_resp = MagicMock()
        empty_resp.is_success = True
        empty_resp.status_code = 200
        empty_resp.json.return_value = {"data": []}

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.get.return_value = empty_resp
        mock_client_cls.return_value = mock_client

        compiler = LMStudioCardCompiler(
            remote_port=1234,
            model_name=None,
            auto_start=False,
        )
        with self.assertRaises(RuntimeError) as ctx:
            compiler.load_model_in_memory()

        self.assertIn("Aucun modèle n'est actuellement chargé sur le serveur LM Studio", str(ctx.exception))
        compiler.close()

    @patch("httpx.Client")
    def test_load_model_in_memory_rejects_mismatched_requested_model(self, mock_client_cls):
        resp = MagicMock()
        resp.is_success = True
        resp.status_code = 200
        resp.json.return_value = {"data": [{"id": "other-model"}]}

        mock_client = MagicMock()
        mock_client.__enter__.return_value = mock_client
        mock_client.get.return_value = resp
        mock_client_cls.return_value = mock_client

        compiler = LMStudioCardCompiler(
            remote_port=1234,
            model_name="qwen3.8-27b",
            auto_start=False,
        )
        with self.assertRaises(RuntimeError) as ctx:
            compiler.load_model_in_memory()

        self.assertIn("Le modèle demandé 'qwen3.8-27b' n'est pas chargé sur le serveur LM Studio", str(ctx.exception))
        self.assertIn("other-model", str(ctx.exception))
        compiler.close()

    def test_close_does_not_unload_server_model(self):
        compiler = LMStudioCardCompiler(
            remote_port=1234,
            model_name=None,
            auto_start=False,
        )
        with patch.object(compiler, "unload_model") as mock_unload:
            compiler.close()
            # La fermeture ne doit pas décharger les modèles du serveur
            mock_unload.assert_not_called()
            self.assertFalse(compiler._ready)

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

    def test_disable_thinking_init_and_env(self):
        # 1. Par défaut : False
        with patch.dict("os.environ", {}, clear=True):
            compiler = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertFalse(compiler.disable_thinking)

            # 2. Argument explicite : True
            compiler_true = LMStudioCardCompiler(remote_host="127.0.0.1", disable_thinking=True)
            self.assertTrue(compiler_true.disable_thinking)

        # 3. Variable d'environnement LM_STUDIO_DISABLE_THINKING
        with patch.dict("os.environ", {"LM_STUDIO_DISABLE_THINKING": "true"}):
            compiler_env = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertTrue(compiler_env.disable_thinking)

        # 4. Variable d'environnement LM_STUDIO_NO_THINK
        with patch.dict("os.environ", {"LM_STUDIO_NO_THINK": "1"}):
            compiler_env2 = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertTrue(compiler_env2.disable_thinking)

        # 5. Variable d'environnement NO_THINK
        with patch.dict("os.environ", {"NO_THINK": "yes"}):
            compiler_env3 = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertTrue(compiler_env3.disable_thinking)

        # 6. Factory create_compiler_engine
        engine = create_compiler_engine(
            provider=LLMProvider.lm_studio,
            disable_thinking=True,
        )
        self.assertTrue(engine.disable_thinking)

    def test_thinking_levels_init_and_env(self):
        # 1. 'null' désactive le thinking
        with patch.dict("os.environ", {}, clear=True):
            compiler_null = LMStudioCardCompiler(remote_host="127.0.0.1", thinking="null")
            self.assertEqual(compiler_null.thinking, "null")
            self.assertTrue(compiler_null.disable_thinking)

            # 2. 'low', 'medium', 'high' activent le thinking
            compiler_low = LMStudioCardCompiler(remote_host="127.0.0.1", thinking="low")
            self.assertEqual(compiler_low.thinking, "low")
            self.assertFalse(compiler_low.disable_thinking)

            compiler_high = LMStudioCardCompiler(remote_host="127.0.0.1", thinking="high")
            self.assertEqual(compiler_high.thinking, "high")
            self.assertFalse(compiler_high.disable_thinking)

        # 3. Via variable d'environnement LM_STUDIO_THINKING
        with patch.dict("os.environ", {"LM_STUDIO_THINKING": "medium"}):
            compiler_env = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertEqual(compiler_env.thinking, "medium")
            self.assertFalse(compiler_env.disable_thinking)

        # 4. Via variable d'environnement LM_STUDIO_THINKING=null
        with patch.dict("os.environ", {"LM_STUDIO_THINKING": "null"}):
            compiler_env_null = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertEqual(compiler_env_null.thinking, "null")
            self.assertTrue(compiler_env_null.disable_thinking)

        # 5. create_compiler_engine transmet thinking
        engine_null = create_compiler_engine(
            provider=LLMProvider.lm_studio,
            thinking="null",
        )
        self.assertEqual(engine_null.thinking, "null")
        self.assertTrue(engine_null.disable_thinking)

        engine_low = create_compiler_engine(
            provider=LLMProvider.lm_studio,
            thinking="low",
        )
        self.assertEqual(engine_low.thinking, "low")
        self.assertFalse(engine_low.disable_thinking)

    @patch("httpx.Client")
    def test_compile_card_with_thinking_levels(self, mock_client_cls):
        """Vérifie la règle : null = false (disable), tout autre niveau = true (enable) + reasoning_effort."""
        fake_card_json = {
            "reasoningAnalysis": "Test thinking levels.",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [
                {
                    "actionId": "play_item",
                    "label": "Test Item",
                    "sourceType": "TRAINER_PLAY",
                    "timing": "ONCE_PER_CARD",
                    "canUseTurn1GoingFirst": True,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [],
                    "costs": [],
                    "effects": [{"primitive": "DRAW_CARDS", "count": 2}],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "CONSISTENCY_TUTOR",
                "intrinsicBaseScore": 70,
                "discardPriorityWhenDead": 50,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }

        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(fake_card_json)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 50},
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {"id": "sv01-181", "name": "Faiblo Ball", "category": "Dresseur", "trainerType": "Objet"}
        identity, pstats = fetcher.build_deterministic_models("sv01-181", raw_card, None)
        bundle = FetchedCardBundle(
            card_id="sv01-181",
            resolved_tcgdex_id="sv01-181",
            raw_fr=raw_card,
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv01-181.json"),
        )

        compiler = LMStudioCardCompiler(remote_host="127.0.0.1")
        compiler._ready = True

        # Cas 1 : thinking='null' -> enable_thinking=False, reasoning_effort='none'
        compiler.compile_card(bundle, thinking="null")
        sent_payload_null = mock_instance.post.call_args[1]["json"]
        self.assertIs(sent_payload_null.get("enable_thinking"), False)
        self.assertEqual(sent_payload_null.get("chat_template_kwargs"), {"enable_thinking": False})
        self.assertEqual(sent_payload_null.get("reasoning_effort"), "none")

        # Cas 2 : thinking='low' -> enable_thinking=True, reasoning_effort='low'
        compiler.compile_card(bundle, thinking="low")
        sent_payload_low = mock_instance.post.call_args[1]["json"]
        self.assertIs(sent_payload_low.get("enable_thinking"), True)
        self.assertEqual(sent_payload_low.get("chat_template_kwargs"), {"enable_thinking": True})
        self.assertEqual(sent_payload_low.get("reasoning_effort"), "low")
        self.assertEqual(sent_payload_low.get("reasoning"), {"effort": "low"})

        # Cas 3 : thinking='high' -> enable_thinking=True, reasoning_effort='high'
        compiler.compile_card(bundle, thinking="high")
        sent_payload_high = mock_instance.post.call_args[1]["json"]
        self.assertIs(sent_payload_high.get("enable_thinking"), True)
        self.assertEqual(sent_payload_high.get("chat_template_kwargs"), {"enable_thinking": True})
        self.assertEqual(sent_payload_high.get("reasoning_effort"), "high")

        # Cas 4 : thinking='4096' (nombre de tokens) -> enable_thinking=True, max_thinking_tokens=4096
        compiler.compile_card(bundle, thinking="4096")
        sent_payload_tokens = mock_instance.post.call_args[1]["json"]
        self.assertIs(sent_payload_tokens.get("enable_thinking"), True)
        self.assertEqual(sent_payload_tokens.get("max_thinking_tokens"), 4096)

    @patch("httpx.Client")
    def test_compile_card_with_disable_thinking_injects_payload_and_prompts(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            remote_host="127.0.0.1",
            disable_thinking=True,
        )
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Analyse sans thinking.",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [
                {
                    "actionId": "play_item",
                    "label": "Test Item",
                    "sourceType": "TRAINER_PLAY",
                    "timing": "ONCE_PER_CARD",
                    "canUseTurn1GoingFirst": True,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [],
                    "costs": [],
                    "effects": [
                        {
                            "primitive": "DRAW_CARDS",
                            "count": 2,
                        }
                    ],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "CONSISTENCY_TUTOR",
                "intrinsicBaseScore": 70,
                "discardPriorityWhenDead": 50,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }

        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(fake_card_json)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 120},
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {
            "id": "sv01-181",
            "name": "Faiblo Ball",
            "category": "Dresseur",
            "trainerType": "Objet",
        }
        identity, pstats = fetcher.build_deterministic_models("sv01-181", raw_card, None)
        bundle = FetchedCardBundle(
            card_id="sv01-181",
            resolved_tcgdex_id="sv01-181",
            raw_fr=raw_card,
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv01-181.json"),
        )

        res = compiler.compile_card(bundle)
        self.assertIsInstance(res, EngineCardModel)

        # Vérifier le payload envoyé à httpx
        mock_instance.post.assert_called_once()
        _, kwargs = mock_instance.post.call_args
        sent_payload = kwargs["json"]

        self.assertEqual(sent_payload.get("chat_template_kwargs"), {"enable_thinking": False})
        self.assertEqual(sent_payload.get("chat_template_args"), {"enable_thinking": False})
        self.assertIs(sent_payload.get("enable_thinking"), False)
        self.assertEqual(sent_payload.get("reasoning_effort"), "none")

        messages = sent_payload.get("messages", [])
        self.assertEqual(len(messages), 2)
        sys_msg = messages[0]["content"]
        user_msg = messages[1]["content"]

        self.assertIn("RÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ", sys_msg)
        self.assertIn("/no_think", user_msg)
        self.assertIn("<|think_off|>", user_msg)

    @patch("httpx.Client")
    def test_compile_card_with_thinking_enabled_does_not_inject_no_think(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            remote_host="127.0.0.1",
            disable_thinking=False,
        )
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Analyse avec thinking actif.",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [
                {
                    "actionId": "play_item",
                    "label": "Test Item",
                    "sourceType": "TRAINER_PLAY",
                    "timing": "ONCE_PER_CARD",
                    "canUseTurn1GoingFirst": True,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [],
                    "costs": [],
                    "effects": [{"primitive": "DRAW_CARDS", "count": 2}],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "CONSISTENCY_TUTOR",
                "intrinsicBaseScore": 70,
                "discardPriorityWhenDead": 50,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }

        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(fake_card_json)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 120},
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {"id": "sv01-181", "name": "Faiblo Ball", "category": "Dresseur", "trainerType": "Objet"}
        identity, pstats = fetcher.build_deterministic_models("sv01-181", raw_card, None)
        bundle = FetchedCardBundle(
            card_id="sv01-181",
            resolved_tcgdex_id="sv01-181",
            raw_fr=raw_card,
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv01-181.json"),
        )

        res = compiler.compile_card(bundle)
        self.assertIsInstance(res, EngineCardModel)

        _, kwargs = mock_instance.post.call_args
        sent_payload = kwargs["json"]

        self.assertNotIn("chat_template_kwargs", sent_payload)
        self.assertNotIn("reasoning_effort", sent_payload)

        messages = sent_payload.get("messages", [])
        sys_msg = messages[0]["content"]
        user_msg = messages[1]["content"]

        self.assertNotIn("RÈGLE CRITIQUE : Le mode réflexion/thinking est expressément DÉSACTIVÉ", sys_msg)
        self.assertNotIn("/no_think", user_msg)
        self.assertNotIn("<|think_off|>", user_msg)

    @patch("httpx.Client")
    def test_compile_card_400_fallback_removes_thinking_params(self, mock_client_cls):
        compiler = LMStudioCardCompiler(
            remote_host="127.0.0.1",
            disable_thinking=True,
        )
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Analyse de secours.",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [
                {
                    "actionId": "play_item",
                    "label": "Test Item",
                    "sourceType": "TRAINER_PLAY",
                    "timing": "ONCE_PER_CARD",
                    "canUseTurn1GoingFirst": True,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [],
                    "costs": [],
                    "effects": [{"primitive": "DRAW_CARDS", "count": 1}],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "CONSISTENCY_TUTOR",
                "intrinsicBaseScore": 70,
                "discardPriorityWhenDead": 50,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }

        # Première réponse HTTP 400 (rejet du paramètre chat_template_kwargs)
        mock_resp_400 = MagicMock()
        mock_resp_400.is_success = False
        mock_resp_400.status_code = 400
        mock_resp_400.json.return_value = {"error": {"message": "Unknown parameter chat_template_kwargs"}}

        # Deuxième réponse HTTP 200 (succès au repli)
        mock_resp_200 = MagicMock()
        mock_resp_200.is_success = True
        mock_resp_200.status_code = 200
        mock_resp_200.json.return_value = {
            "choices": [{"message": {"content": json.dumps(fake_card_json)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 80},
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.side_effect = [mock_resp_400] + [mock_resp_200] * 5
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {"id": "sv01-181", "name": "Faiblo Ball", "category": "Dresseur", "trainerType": "Objet"}
        identity, pstats = fetcher.build_deterministic_models("sv01-181", raw_card, None)
        bundle = FetchedCardBundle(
            card_id="sv01-181",
            resolved_tcgdex_id="sv01-181",
            raw_fr=raw_card,
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv01-181.json"),
        )

        res = compiler.compile_card(bundle)
        self.assertIsInstance(res, EngineCardModel)
        self.assertEqual(mock_instance.post.call_count, 2)

        # La 2e requête ne doit plus contenir les paramètres de thinking qui avaient causé le 400
        second_call_kwargs = mock_instance.post.call_args_list[1][1]
        second_payload = second_call_kwargs["json"]
        self.assertNotIn("chat_template_kwargs", second_payload)
        self.assertNotIn("enable_thinking", second_payload)
        self.assertNotIn("reasoning_effort", second_payload)

    @patch("httpx.Client")
    def test_statitik_enum_normalization_recovers_from_invalid_primitive_and_reason(self, mock_client_cls):
        """Vérifie la robustesse face aux erreurs de validation remontées pour sv06.5-001 (Statitik).

        Cas où le LLM a généré:
        1. Une primitive invalide (ex: 'FLIP_COIN', 'COIN_FLIP', 'PREVENT_DAMAGE' ou 'DEAL_DAMAGE')
        2. Un motif de carte morte 'NONE' ou 'BENCH_FULL' au lieu des enums stricts.
        """
        compiler = LMStudioCardCompiler(remote_host="127.0.0.1")
        compiler._ready = True

        raw_statitik_llm_json = {
            "reasoningAnalysis": "Analyse de Statitik (sv06.5-001) avec attaque Esquive Éclaboussante.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [
                {
                    "actionId": "attack_splashing_dodge",
                    "label": "Esquive Éclaboussante",
                    "sourceType": "ATTACK",
                    "timing": "END_OF_TURN_ATTACK",
                    "canUseTurn1GoingFirst": False,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [],
                    "costs": [],
                    "effects": [
                        {
                            "primitive": "COIN_FLIP",  # Valeur hors enum renvoyée par le LLM pour Esquive Éclaboussante
                            "sourceZone": "ACTIVE",
                            "targetZone": "ACTIVE",
                            "count": 1,
                            "upTo": False,
                            "baseDamage": 10,
                        }
                    ],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 40,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [
                    {
                        "reason": "NONE",  # Valeur hors enum ('NONE') renvoyée pour une carte sans carte morte
                        "zonesToCheck": [],
                    },
                    {
                        "reason": "BENCH_FULL",  # Synonyme informel de BENCH_ALREADY_FULL
                        "zonesToCheck": ["BENCH"],
                    },
                ],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }

        # 1. Vérification directe sur le modèle Pydantic LLMCompiledCardPart
        parsed_part = LLMCompiledCardPart.model_validate_json(json.dumps(raw_statitik_llm_json))
        self.assertIsInstance(parsed_part, LLMCompiledCardPart)
        # La primitive COIN_FLIP / PREVENT_DAMAGE doit être normalisée
        self.assertEqual(parsed_part.playableActions[0].effects[0].primitive.value, "PASSIVE_PREVENT_DAMAGE_OR_EFFECTS")
        # L'entrée 'NONE' doit être filtrée, et 'BENCH_FULL' normalisée vers BENCH_ALREADY_FULL
        self.assertEqual(len(parsed_part.strategicEvaluator.inGameDeadCardConditions), 1)
        self.assertEqual(
            parsed_part.strategicEvaluator.inGameDeadCardConditions[0].reason.value,
            "BENCH_ALREADY_FULL",
        )

        # 2. Vérification de bout en bout via compile_card
        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(raw_statitik_llm_json)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 150},
        }
        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {
            "id": "sv06.5-001",
            "name": "Statitik",
            "category": "Pokémon",
            "stage": "Base",
            "hp": 40,
            "types": ["Plante"],
        }
        identity, pstats = fetcher.build_deterministic_models("sv06.5-001", raw_card, None)
        bundle = FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr=raw_card,
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

        engine_card = compiler.compile_card(bundle)
        self.assertIsInstance(engine_card, EngineCardModel)
        self.assertEqual(engine_card.cardId, "sv06.5-001")

    @patch("httpx.Client")
    def test_tokens_per_second_measured_from_first_token_generation(self, mock_client_cls):
        """Vérifie que le débit (tokens/sec) est mesuré à partir du début effectif de génération (hors TTFT/prompt eval)."""
        compiler = LMStudioCardCompiler(remote_host="127.0.0.1")
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Test mesure tps.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [],
            "strategicEvaluator": {
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 50,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }

        json_str = json.dumps(fake_card_json)
        sse_lines = [
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[:30]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[30:60]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[60:]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}], 'usage': {'completion_tokens': 3}})}",
            "data: [DONE]",
        ]

        mock_stream_resp = MagicMock()
        mock_stream_resp.is_success = True
        mock_stream_resp.status_code = 200
        mock_stream_resp.iter_lines.return_value = sse_lines

        mock_stream_cm = MagicMock()
        mock_stream_cm.__enter__.return_value = mock_stream_resp

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.stream.return_value = mock_stream_cm
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        identity, pstats = fetcher.build_deterministic_models(
            "sv06.5-001",
            {"id": "sv06.5-001", "name": "Statitik", "category": "Pokémon", "stage": "Base", "hp": 40, "types": ["Plante"], "attacks": []},
            None,
        )
        bundle = FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr={"id": "sv06.5-001"},
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

        # Simulation de timestamps :
        # t0 = 100.0 (envoi de la requête)
        # Début de génération au 1er token à t = 105.0 (TTFT = 5.0s de prompt eval / latence réseau)
        # 2e token à t = 106.0
        # 3e token à t = 107.0 (fin de génération à 107.0, durée de génération = 2.0s pour 2 intervalles = 1.0 t/s)
        # Fin de requête à t = 107.1 (temps total = 7.1s)
        time_sequence = [
            100.0,  # t0 dans compile_card
            105.0,  # 1er token (first_token_time)
            106.0,  # 2e token
            107.0,  # 3e token (last_token_time)
            107.0,  # final callback
            107.1,  # fin de compile_card (elapsed)
        ]
        time_idx = 0

        def fake_perf_counter():
            nonlocal time_idx
            if time_idx < len(time_sequence):
                val = time_sequence[time_idx]
                time_idx += 1
                return val
            return 107.1

        live_updates = []
        with patch("time.perf_counter", side_effect=fake_perf_counter):
            model = compiler.compile_card(bundle, on_token=lambda tok, tps: live_updates.append((tok, tps)))

        meta = model.compilationMetadata
        self.assertIsNotNone(meta)
        self.assertEqual(meta.completionTokens, 3)
        # Vérification clé : le débit est mesuré sur la durée de génération (2.0s) et non sur le temps total (7.1s)
        # (3 - 1) / (107.0 - 105.0) = 2 / 2.0 = 1.0 t/s
        self.assertEqual(meta.tokensPerSecond, 1.0)
        self.assertEqual(meta.timeToFirstTokenSeconds, 5.0)
        self.assertAlmostEqual(meta.compilationTimeSeconds, 7.1, places=1)

    @patch("httpx.Client")
    def test_live_tokens_per_second_refreshes_every_second_not_cumulative_average(self, mock_client_cls):
        """Vérifie que le débit live est un rafraîchissement instantané toutes les secondes et non une moyenne cumulative."""
        compiler = LMStudioCardCompiler(remote_host="127.0.0.1")
        compiler._ready = True

        fake_card_json = {
            "reasoningAnalysis": "Test live tps 1-second refresh.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [],
            "strategicEvaluator": {
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 50,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        }
        json_str = json.dumps(fake_card_json)
        # 6 morceaux SSE pour 6 tokens
        sse_lines = [
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[:15]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[15:30]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[30:45]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[45:60]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[60:75]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {'content': json_str[75:]}}]})}",
            f"data: {json.dumps({'choices': [{'delta': {}, 'finish_reason': 'stop'}], 'usage': {'completion_tokens': 6}})}",
            "data: [DONE]",
        ]

        mock_stream_resp = MagicMock()
        mock_stream_resp.is_success = True
        mock_stream_resp.status_code = 200
        mock_stream_resp.iter_lines.return_value = sse_lines

        mock_stream_cm = MagicMock()
        mock_stream_cm.__enter__.return_value = mock_stream_resp

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.stream.return_value = mock_stream_cm
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        identity, pstats = fetcher.build_deterministic_models(
            "sv06.5-001",
            {"id": "sv06.5-001", "name": "Statitik", "category": "Pokémon", "stage": "Base", "hp": 40, "types": ["Plante"], "attacks": []},
            None,
        )
        bundle = FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr={"id": "sv06.5-001"},
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

        # Chronologie simulée :
        # t0 = 100.0 (envoi)
        # tok 1: t = 101.0 (window_start à 101.0, tokens = 1)
        # tok 2: t = 101.4 (0.4s écoulé < 1.0s -> live_tps reste 0.0)
        # tok 3: t = 102.1 (1.1s écoulé >= 1.0s -> delta = 3-1 = 2 tok, 2 / 1.1 = 1.8 t/s)
        # tok 4: t = 102.5 (0.4s écoulé < 1.0s -> live_tps reste 1.8 t/s)
        # tok 5: t = 103.2 (1.1s écoulé >= 1.0s -> delta = 5-3 = 2 tok, 2 / 1.1 = 1.8 t/s)
        # tok 6: t = 104.3 (1.1s écoulé >= 1.0s -> delta = 6-5 = 1 tok, 1 / 1.1 = 0.9 t/s)
        # final callback: t = 104.3
        # fin compile_card: t = 104.4
        time_sequence = [
            100.0,  # t0
            101.0,  # tok 1
            101.4,  # tok 2
            102.1,  # tok 3
            102.5,  # tok 4
            103.2,  # tok 5
            104.3,  # tok 6
            104.3,  # final callback
            104.4,  # fin
        ]
        time_idx = 0

        def fake_perf_counter():
            nonlocal time_idx
            if time_idx < len(time_sequence):
                val = time_sequence[time_idx]
                time_idx += 1
                return val
            return 104.4

        live_updates = []
        with patch("time.perf_counter", side_effect=fake_perf_counter):
            model = compiler.compile_card(bundle, on_token=lambda tok, tps: live_updates.append((tok, tps)))

        # Vérification des mises à jour en direct :
        # Au tok 2 (t=101.4, < 1.0s): live_tps est 0.0 ("calcul...")
        tok2_update = [up for up in live_updates if up[0] == 2]
        self.assertTrue(tok2_update)
        self.assertEqual(tok2_update[0][1], 0.0)

        # Au tok 3 (t=102.1, >= 1.0s): 1er rafraîchissement à 1.8 t/s
        tok3_update = [up for up in live_updates if up[0] == 3]
        self.assertTrue(tok3_update)
        self.assertEqual(tok3_update[0][1], 1.8)

        # Au tok 6 (t=104.3, >= 1.0s après tok 5): ralentissement à 1 tok en 1.1s = 0.9 t/s
        # Si c'était une moyenne cumulative: (6-1)/(104.3-101.0) = 5/3.3 = 1.5 t/s
        # Mais avec le rafraîchissement chaque seconde: live_tps est bien 0.9 t/s !
        tok6_update = [up for up in live_updates if up[0] == 6]
        self.assertTrue(tok6_update)
        self.assertEqual(tok6_update[0][1], 0.9)

    @patch("httpx.Client")
    def test_granivol_sv02_001_compilation_with_json_schema(self, mock_client_cls):
        """Vérifie la compilation de Granivol (sv02-001) avec schéma JSON et évite toute erreur 'response_format.type'."""
        compiler = LMStudioCardCompiler(remote_host="127.0.0.1")
        compiler._ready = True

        fake_granivol_json = {
            "reasoningAnalysis": "Analyse de Granivol (sv02-001) avec Esquive Éclaboussante.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [
                {
                    "actionId": "attack_splash_hide",
                    "label": "Esquive Éclaboussante",
                    "sourceType": "ATTACK",
                    "timing": "END_OF_TURN_ATTACK",
                    "canUseTurn1GoingFirst": False,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [],
                    "costs": [{"energyType": "GRASS", "count": 1}],
                    "effects": [
                        {
                            "primitive": "PASSIVE_PREVENT_DAMAGE_OR_EFFECTS",
                            "baseDamage": 10,
                        }
                    ],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "STALL_WALL",
                "intrinsicBaseScore": 40,
                "discardPriorityWhenDead": 75,
                "holdForNextTurnBonus": 5,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.2, "turn2": 1.0, "turn3": 0.8, "turn4Plus": 0.5},
            },
        }

        mock_resp = MagicMock()
        mock_resp.is_success = True
        mock_resp.status_code = 200
        mock_resp.json.return_value = {
            "choices": [{"message": {"content": json.dumps(fake_granivol_json)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 120},
        }

        mock_instance = MagicMock()
        mock_instance.__enter__.return_value = mock_instance
        mock_instance.post.return_value = mock_resp
        mock_client_cls.return_value = mock_instance

        from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher
        fetcher = TCGdexFetcher(data_dir=Path("data"))
        raw_card = {
            "id": "sv02-001",
            "name": "Granivol",
            "category": "Pokémon",
            "stage": "Base",
            "hp": 50,
            "types": ["Plante"],
            "attacks": [{"name": "Esquive Éclaboussante", "damage": 10, "cost": ["Plante"]}],
        }
        identity, pstats = fetcher.build_deterministic_models("sv02-001", raw_card, None)
        bundle = FetchedCardBundle(
            card_id="sv02-001",
            resolved_tcgdex_id="sv02-001",
            raw_fr=raw_card,
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv02-001.json"),
        )

        engine_card = compiler.compile_card(bundle)
        self.assertIsInstance(engine_card, EngineCardModel)
        self.assertEqual(engine_card.cardId, "sv02-001")
        self.assertEqual(engine_card.identity.nameFr, "Granivol")

        # Vérifier que le format envoyé est bien json_schema et JAMAIS json_object
        mock_instance.post.assert_called_once()
        _, kwargs = mock_instance.post.call_args
        sent_payload = kwargs["json"]
        self.assertIn("response_format", sent_payload)
        self.assertEqual(sent_payload["response_format"]["type"], "json_schema")
        self.assertNotEqual(sent_payload["response_format"]["type"], "json_object")

    def test_cli_parallel_compilation_success(self):
        import typer
        from compiler.cli import _execute_run_pipeline, RunMode, FetcherProvider, LLMProvider
        mock_engine = MagicMock()
        mock_engine.load_model_in_memory.return_value = None
        mock_engine.repo_id = "test-repo"
        mock_engine.filename = "test-file"

        def make_mock_card(cid, name):
            m = MagicMock()
            m.cardId = cid
            m.identity.nameFr = name
            m.identity.nameEn = name
            m.subCategory = None
            m.playableActions = []
            m.strategicEvaluator.primaryRole.value = "MAIN_ATTACKER"
            m.strategicEvaluator.inGameDeadCardConditions = []
            m.compilationMetadata.tokensPerSecond = 25.0
            m.compilationMetadata.completionTokens = 10
            m.compilationMetadata.compilationTimeSeconds = 0.5
            m.compilationMetadata.generationTimeSeconds = 0.4
            m.compilationMetadata.modelRepoId = "test"
            m.model_dump.return_value = {"cardId": cid, "name": name}
            return m

        def fake_compile(bundle, on_token=None):
            if on_token:
                on_token(10, 25.0)
            return make_mock_card(bundle.card_id, bundle.identity.nameFr)

        mock_engine.compile_card.side_effect = fake_compile

        bundles = []
        for i in range(1, 4):
            b = MagicMock()
            b.card_id = f"test-p-{i:03d}"
            b.identity.nameFr = f"Carte {i}"
            b.identity.nameEn = f"Card {i}"
            bundles.append(b)

        with patch("compiler.cli.create_compiler_engine", return_value=mock_engine), \
             patch("compiler.cli.TCGdexFetcher") as mock_fetcher_cls, \
             patch("compiler.cli.is_basic_energy", return_value=False), \
             patch("compiler.cli.rebuild_consolidated_database", return_value=Path("data/cards_database.json")), \
             patch("pathlib.Path.exists", return_value=False), \
             patch("pathlib.Path.write_text", return_value=None):
            mock_fetcher = MagicMock()
            async def _fake_fetch(*args, **kwargs):
                return bundles
            mock_fetcher.fetch_batch = _fake_fetch
            mock_fetcher_cls.return_value = mock_fetcher

            _execute_run_pipeline(
                mode=RunMode.test,
                test_flag=True,
                standard_flag=False,
                ids="test-p-001,test-p-002,test-p-003",
                provider=FetcherProvider.sdk,
                llm_provider=LLMProvider.lm_studio,
                tier=ModelTier.qwen3,
                fast=False,
                force=True,
                limit=None,
                parallel=2,
            )

            self.assertEqual(mock_engine.compile_card.call_count, 3)
            mock_engine.close.assert_called_once()

    def test_cli_parallel_compilation_stops_on_error(self):
        import typer
        from compiler.cli import _execute_run_pipeline, RunMode, FetcherProvider, LLMProvider
        mock_engine = MagicMock()
        mock_engine.load_model_in_memory.return_value = None
        mock_engine.repo_id = "test-repo"
        mock_engine.filename = "test-file"

        def make_mock_card(cid, name):
            m = MagicMock()
            m.cardId = cid
            m.identity.nameFr = name
            m.identity.nameEn = name
            m.subCategory = None
            m.playableActions = []
            m.strategicEvaluator.primaryRole.value = "MAIN_ATTACKER"
            m.strategicEvaluator.inGameDeadCardConditions = []
            m.compilationMetadata.tokensPerSecond = 25.0
            m.compilationMetadata.completionTokens = 10
            m.compilationMetadata.compilationTimeSeconds = 0.5
            m.compilationMetadata.generationTimeSeconds = 0.4
            m.compilationMetadata.modelRepoId = "test"
            m.model_dump.return_value = {"cardId": cid, "name": name}
            return m

        def fail_on_card2(bundle, on_token=None):
            if bundle.card_id == "test-fail-002":
                raise RuntimeError("Parallel worker error")
            return make_mock_card(bundle.card_id, bundle.identity.nameFr)

        mock_engine.compile_card.side_effect = fail_on_card2

        bundles = []
        for i in range(1, 4):
            b = MagicMock()
            b.card_id = f"test-fail-{i:03d}"
            b.identity.nameFr = f"Fail Carte {i}"
            b.identity.nameEn = f"Fail Card {i}"
            bundles.append(b)

        with patch("compiler.cli.create_compiler_engine", return_value=mock_engine), \
             patch("compiler.cli.TCGdexFetcher") as mock_fetcher_cls, \
             patch("compiler.cli.is_basic_energy", return_value=False), \
             patch("pathlib.Path.exists", return_value=False), \
             patch("pathlib.Path.write_text", return_value=None):
            mock_fetcher = MagicMock()
            async def _fake_fetch(*args, **kwargs):
                return bundles
            mock_fetcher.fetch_batch = _fake_fetch
            mock_fetcher_cls.return_value = mock_fetcher

            with self.assertRaises(typer.Exit) as ctx:
                _execute_run_pipeline(
                    mode=RunMode.test,
                    test_flag=True,
                    standard_flag=False,
                    ids="test-fail-001,test-fail-002,test-fail-003",
                    provider=FetcherProvider.sdk,
                    llm_provider=LLMProvider.lm_studio,
                    tier=ModelTier.qwen3,
                    fast=False,
                    force=True,
                    limit=None,
                    parallel=2,
                )
            self.assertEqual(ctx.exception.exit_code, 1)
            mock_engine.close.assert_called_once()

    def test_cli_parallel_warning_with_local_provider(self):
        from compiler.cli import _execute_run_pipeline, RunMode, FetcherProvider, LLMProvider
        mock_engine = MagicMock()
        mock_engine.load_model_in_memory.return_value = None
        mock_engine.repo_id = "local-repo"
        mock_engine.filename = "local-file"

        def make_mock_card(cid, name):
            m = MagicMock()
            m.cardId = cid
            m.identity.nameFr = name
            m.identity.nameEn = name
            m.subCategory = None
            m.playableActions = []
            m.strategicEvaluator.primaryRole.value = "ATTACKER"
            m.strategicEvaluator.inGameDeadCardConditions = []
            m.compilationMetadata.tokensPerSecond = 20.0
            m.compilationMetadata.completionTokens = 8
            m.compilationMetadata.compilationTimeSeconds = 0.4
            m.compilationMetadata.generationTimeSeconds = 0.3
            m.compilationMetadata.modelRepoId = "local"
            m.model_dump.return_value = {"cardId": cid, "name": name}
            return m

        bundles = []
        b = MagicMock()
        b.card_id = "test-loc-001"
        b.identity.nameFr = "Local 1"
        b.identity.nameEn = "Local 1"
        bundles.append(b)

        with patch("compiler.cli.create_compiler_engine", return_value=mock_engine), \
             patch("compiler.cli.TCGdexFetcher") as mock_fetcher_cls, \
             patch("compiler.cli.is_basic_energy", return_value=False), \
             patch("compiler.cli.rebuild_consolidated_database", return_value=Path("data/cards_database.json")), \
             patch("compiler.cli.console.print") as mock_print, \
             patch("pathlib.Path.exists", return_value=False), \
             patch("pathlib.Path.write_text", return_value=None):
            mock_fetcher = MagicMock()
            async def _fake_fetch(*args, **kwargs):
                return bundles
            mock_fetcher.fetch_batch = _fake_fetch
            mock_fetcher_cls.return_value = mock_fetcher

            mock_engine.compile_card.return_value = make_mock_card("test-loc-001", "Local 1")

            _execute_run_pipeline(
                mode=RunMode.test,
                test_flag=True,
                standard_flag=False,
                ids="test-loc-001",
                provider=FetcherProvider.sdk,
                llm_provider=LLMProvider.local,
                tier=ModelTier.qwen3,
                fast=False,
                force=True,
                limit=None,
                parallel=3,
            )

            printed_messages = [str(call_args[0][0]) for call_args in mock_print.call_args_list if call_args[0]]
            has_warning = any("La parallélisation (--parallel > 1) n'est pas supportée avec le moteur 'local'" in m for m in printed_messages)
            self.assertTrue(has_warning)

    def test_cli_continue_on_error_sequential(self):
        from compiler.cli import _execute_run_pipeline, RunMode, FetcherProvider, LLMProvider
        mock_engine = MagicMock()
        mock_engine.load_model_in_memory.return_value = None
        mock_engine.repo_id = "test-repo"
        mock_engine.filename = "test-file"

        def make_mock_card(cid, name):
            m = MagicMock()
            m.cardId = cid
            m.identity.nameFr = name
            m.identity.nameEn = name
            m.subCategory = None
            m.playableActions = []
            m.strategicEvaluator.primaryRole.value = "MAIN_ATTACKER"
            m.strategicEvaluator.inGameDeadCardConditions = []
            m.compilationMetadata.tokensPerSecond = 25.0
            m.compilationMetadata.completionTokens = 10
            m.compilationMetadata.compilationTimeSeconds = 0.5
            m.compilationMetadata.generationTimeSeconds = 0.4
            m.compilationMetadata.modelRepoId = "test"
            m.model_dump.return_value = {"cardId": cid, "name": name}
            return m

        def fail_on_card1(bundle, on_token=None):
            if bundle.card_id == "test-fail-001":
                raise RuntimeError("Failed card 1")
            return make_mock_card(bundle.card_id, bundle.identity.nameFr)

        mock_engine.compile_card.side_effect = fail_on_card1

        bundles = []
        for i in range(1, 3):
            b = MagicMock()
            b.card_id = f"test-fail-{i:03d}" if i == 1 else f"test-ok-{i:03d}"
            b.identity.nameFr = f"Carte {i}"
            b.identity.nameEn = f"Card {i}"
            bundles.append(b)

        with patch("compiler.cli.create_compiler_engine", return_value=mock_engine), \
             patch("compiler.cli.TCGdexFetcher") as mock_fetcher_cls, \
             patch("compiler.cli.is_basic_energy", return_value=False), \
             patch("compiler.cli.rebuild_consolidated_database", return_value=Path("data/cards_database.json")), \
             patch("pathlib.Path.exists", return_value=False), \
             patch("pathlib.Path.write_text", return_value=None):
            mock_fetcher = MagicMock()
            async def _fake_fetch(*args, **kwargs):
                return bundles
            mock_fetcher.fetch_batch = _fake_fetch
            mock_fetcher_cls.return_value = mock_fetcher

            _execute_run_pipeline(
                mode=RunMode.test,
                test_flag=True,
                standard_flag=False,
                ids="test-fail-001,test-ok-002",
                provider=FetcherProvider.sdk,
                llm_provider=LLMProvider.lm_studio,
                tier=ModelTier.qwen3,
                fast=False,
                force=True,
                limit=None,
                parallel=1,
                continue_on_error=True,
            )

            self.assertEqual(mock_engine.compile_card.call_count, 2)
            mock_engine.close.assert_called_once()

    def test_cli_continue_on_error_parallel(self):
        from compiler.cli import _execute_run_pipeline, RunMode, FetcherProvider, LLMProvider
        mock_engine = MagicMock()
        mock_engine.load_model_in_memory.return_value = None
        mock_engine.repo_id = "test-repo"
        mock_engine.filename = "test-file"

        def make_mock_card(cid, name):
            m = MagicMock()
            m.cardId = cid
            m.identity.nameFr = name
            m.identity.nameEn = name
            m.subCategory = None
            m.playableActions = []
            m.strategicEvaluator.primaryRole.value = "MAIN_ATTACKER"
            m.strategicEvaluator.inGameDeadCardConditions = []
            m.compilationMetadata.tokensPerSecond = 25.0
            m.compilationMetadata.completionTokens = 10
            m.compilationMetadata.compilationTimeSeconds = 0.5
            m.compilationMetadata.generationTimeSeconds = 0.4
            m.compilationMetadata.modelRepoId = "test"
            m.model_dump.return_value = {"cardId": cid, "name": name}
            return m

        def fail_on_card1(bundle, on_token=None):
            if bundle.card_id == "test-p-fail-001":
                raise RuntimeError("Parallel fail card 1")
            return make_mock_card(bundle.card_id, bundle.identity.nameFr)

        mock_engine.compile_card.side_effect = fail_on_card1

        bundles = []
        for i in range(1, 4):
            b = MagicMock()
            b.card_id = f"test-p-fail-001" if i == 1 else f"test-p-ok-{i:03d}"
            b.identity.nameFr = f"P Carte {i}"
            b.identity.nameEn = f"P Card {i}"
            bundles.append(b)

        with patch("compiler.cli.create_compiler_engine", return_value=mock_engine), \
             patch("compiler.cli.TCGdexFetcher") as mock_fetcher_cls, \
             patch("compiler.cli.is_basic_energy", return_value=False), \
             patch("compiler.cli.rebuild_consolidated_database", return_value=Path("data/cards_database.json")), \
             patch("pathlib.Path.exists", return_value=False), \
             patch("pathlib.Path.write_text", return_value=None):
            mock_fetcher = MagicMock()
            async def _fake_fetch(*args, **kwargs):
                return bundles
            mock_fetcher.fetch_batch = _fake_fetch
            mock_fetcher_cls.return_value = mock_fetcher

            _execute_run_pipeline(
                mode=RunMode.test,
                test_flag=True,
                standard_flag=False,
                ids="test-p-fail-001,test-p-ok-002,test-p-ok-003",
                provider=FetcherProvider.sdk,
                llm_provider=LLMProvider.lm_studio,
                tier=ModelTier.qwen3,
                fast=False,
                force=True,
                limit=None,
                parallel=2,
                continue_on_error=True,
            )

            self.assertEqual(mock_engine.compile_card.call_count, 3)
            mock_engine.close.assert_called_once()

    def test_env_and_cli_model_and_thinking_compatibility(self):
        """Vérifie la compatibilité des variables d'environnement et options CLI pour le modèle unifié et le mode thinking."""
        import tempfile
        from compiler.llm_engine import LocalLLMCardCompiler

        # 1. create_compiler_engine avec model explicite (CLI --model) pour LM Studio
        engine_lms = create_compiler_engine(
            provider=LLMProvider.lm_studio,
            model="qwen-cli-32b",
        )
        self.assertEqual(engine_lms.model_name, "qwen-cli-32b")
        engine_lms.close()

        # 2. create_compiler_engine avec model complet repo/fichier pour le mode local
        engine_local = create_compiler_engine(
            provider=LLMProvider.local,
            model="Qwen/Qwen3-14B-GGUF/Qwen3-14B-Q6_K.gguf",
        )
        self.assertEqual(engine_local.repo_id, "Qwen/Qwen3-14B-GGUF")
        self.assertEqual(engine_local.filename, "Qwen3-14B-Q6_K.gguf")

        # 3. Résolution de LLM_MODEL unifié pour le mode local (repo:fichier)
        with patch.dict("os.environ", {"LLM_MODEL": "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF:qwen2.5-coder-32b-instruct-q4_k_m.gguf"}):
            local_from_env = LocalLLMCardCompiler()
            self.assertEqual(local_from_env.repo_id, "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF")
            self.assertEqual(local_from_env.filename, "qwen2.5-coder-32b-instruct-q4_k_m.gguf")

        # 4. Résolution du même LLM_MODEL unifié pour LM Studio
        with patch.dict("os.environ", {"LLM_MODEL": "qwen2.5-coder-from-env"}):
            lms_from_env = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertEqual(lms_from_env.model_name, "qwen2.5-coder-from-env")
            lms_from_env.close()

        # 5. LocalLLMCardCompiler avec fichier local .gguf direct
        with tempfile.NamedTemporaryFile(suffix=".gguf") as tmp_gguf:
            local_file_eng = LocalLLMCardCompiler(model=tmp_gguf.name)
            self.assertEqual(local_file_eng.model_path, Path(tmp_gguf.name).resolve())
            self.assertEqual(local_file_eng.filename, Path(tmp_gguf.name).name)

        # 6. Résolution de THINKING=low depuis l'environnement
        with patch.dict("os.environ", {"THINKING": "low", "LM_STUDIO_DISABLE_THINKING": "false"}):
            lms_thinking = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertEqual(lms_thinking.thinking, "low")
            self.assertFalse(lms_thinking.disable_thinking)
            lms_thinking.close()

        # 7. Résolution de DISABLE_THINKING=true depuis l'environnement
        with patch.dict("os.environ", {"DISABLE_THINKING": "true"}):
            lms_disabled = LMStudioCardCompiler(remote_host="127.0.0.1")
            self.assertEqual(lms_disabled.thinking, "null")
            self.assertTrue(lms_disabled.disable_thinking)
            lms_disabled.close()


if __name__ == "__main__":
    unittest.main()
