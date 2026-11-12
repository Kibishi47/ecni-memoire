"""Tests unitaires pour le pipeline Two-Pass, la matrice des modèles et les moteurs de raisonnement/coding.

Vérifie :
1. La matrice officielle des modèles (Single-Pass vs Two-Pass, Soft vs Intense, MLX vs GGUF).
2. La normalisation des modes, intensités et phases.
3. La sérialisation et persistance des fiches d'analyse de raisonnement (`ReasoningRecord`).
4. L'exécution de la Passe 1 (Raisonnement) et la libération stricte de la mémoire de l'IA 1.
5. L'exécution de la Passe 2 (Codage JSON) exploitant les textes d'analyse de la Passe 1.
6. Les commandes CLI Typer (`run --pipeline two_pass`, `reason`, `code`).
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from typer.testing import CliRunner

from compiler.cli import app
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
    normalize_intensity_mode,
    normalize_pipeline_mode,
    normalize_pipeline_phase,
    resolve_gguf_filename_for_repo,
    resolve_model_for_configuration,
)
from compiler.reasoning_engine import (
    ReasoningEngine,
    ReasoningRecord,
    build_reasoning_prompt,
    has_reasoning_record,
    load_reasoning_record,
    save_reasoning_record,
)
from compiler.schemas import (
    CardCategory,
    CardIdentity,
    CardSubCategory,
    EngineCardModel,
    PokemonStats,
)
from compiler.tcgdex_fetcher import FetchedCardBundle
from compiler.two_pass_pipeline import run_coding_phase, run_reasoning_phase, run_two_pass_pipeline


def make_test_bundle(
    card_id: str = "sv08.5-001",
    name_fr: str = "Noeunoeuf",
    category: CardCategory = CardCategory.POKEMON,
    sub_category: CardSubCategory = CardSubCategory.BASIC,
) -> FetchedCardBundle:
    identity = CardIdentity(
        cardId=card_id,
        nameFr=name_fr,
        nameEn="Exeggcute",
        category=category,
        subCategory=sub_category,
        setId="sv08.5",
        localId="001",
    )
    stats = PokemonStats(
        hp=50,
        types=["Plante"],
        retreatCost=1,
    )
    raw_fr = {
        "id": card_id,
        "name": name_fr,
        "category": "Pokemon",
        "attacks": [{"name": "Roulade", "cost": ["Incolore"], "damage": "10", "effect": "Lancez une pièce."}],
    }
    return FetchedCardBundle(
        card_id=card_id,
        resolved_tcgdex_id=card_id,
        raw_fr=raw_fr,
        raw_en={},
        identity=identity,
        pokemon_stats=stats,
        raw_cache_path=Path("/tmp/fake_cache.json"),
    )


class TestModelsConfig(unittest.TestCase):
    """Vérifie la résolution rigoureuse de la matrice de modèles spécifiée."""

    def test_normalize_modes(self) -> None:
        self.assertEqual(normalize_pipeline_mode("single"), PipelineMode.single)
        self.assertEqual(normalize_pipeline_mode("two_pass"), PipelineMode.two_pass)
        self.assertEqual(normalize_pipeline_mode("two-pass"), PipelineMode.two_pass)
        self.assertEqual(normalize_pipeline_mode("double"), PipelineMode.two_pass)
        self.assertEqual(normalize_pipeline_mode(None), PipelineMode.single)

        self.assertEqual(normalize_intensity_mode("soft"), IntensityMode.soft)
        self.assertEqual(normalize_intensity_mode("intense"), IntensityMode.intense)
        self.assertEqual(normalize_intensity_mode("afk"), IntensityMode.intense)
        self.assertEqual(normalize_intensity_mode(None), IntensityMode.soft)

        self.assertEqual(normalize_pipeline_phase("all"), PipelinePhase.all)
        self.assertEqual(normalize_pipeline_phase("reason"), PipelinePhase.reason)
        self.assertEqual(normalize_pipeline_phase("code"), PipelinePhase.code)
        self.assertEqual(normalize_pipeline_phase(None), PipelinePhase.all)

    def test_mode_1_single_pass_matrix(self) -> None:
        """Vérifie les modèles du Mode 1 (IA direct / single-pass)."""
        with patch.dict(os.environ, {}, clear=True):
            # MLX Soft
            m = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.single,
                intensity=IntensityMode.soft,
                backend="mlx",
            )
            self.assertEqual(m, "mlx-community/gemma-4-26b-a4b-it-4bit")

            # MLX Intense
            m = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.single,
                intensity=IntensityMode.intense,
                backend="mlx",
            )
            self.assertEqual(m, "mlx-community/gemma-4-26b-a4b-it-4bit")

            # GGUF Soft
            m = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.single,
                intensity=IntensityMode.soft,
                backend="llama_cpp",
            )
            self.assertEqual(m, "bartowski/Qwen2.5-Coder-14B-Instruct-GGUF")

            # GGUF Intense
            m = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.single,
                intensity=IntensityMode.intense,
                backend="llama_cpp",
            )
            self.assertEqual(m, "bartowski/Qwen2.5-Coder-32B-Instruct-GGUF")

    def test_mode_2_two_pass_matrix(self) -> None:
        """Vérifie les modèles du Mode 2 (Passe 1 Raisonnement & Passe 2 Coding)."""
        with patch.dict(os.environ, {}, clear=True):
            # Passe 1 (Raisonnement)
            r_mlx_soft = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.soft,
                phase=PipelinePhase.reason,
                backend="mlx",
            )
            self.assertEqual(r_mlx_soft, "mlx-community/gemma-4-26b-a4b-it-4bit")

            r_mlx_intense = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.intense,
                phase=PipelinePhase.reason,
                backend="mlx",
            )
            self.assertEqual(r_mlx_intense, "mlx-community/gemma-4-26b-a4b-it-4bit")

            r_gguf_soft = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.soft,
                phase=PipelinePhase.reason,
                backend="llama_cpp",
            )
            self.assertEqual(r_gguf_soft, "bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF")

            # Passe 2 (Coding)
            c_mlx_soft = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.soft,
                phase=PipelinePhase.code,
                backend="mlx",
            )
            self.assertEqual(c_mlx_soft, "mlx-community/gemma-4-26b-a4b-it-4bit")

            c_mlx_intense = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.intense,
                phase=PipelinePhase.code,
                backend="mlx",
            )
            self.assertEqual(c_mlx_intense, "mlx-community/gemma-4-26b-a4b-it-4bit")

            c_gguf_soft = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.soft,
                phase=PipelinePhase.code,
                backend="llama_cpp",
            )
            self.assertEqual(c_gguf_soft, "bartowski/Qwen2.5-Coder-7B-Instruct-GGUF")

            c_gguf_intense = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.intense,
                phase=PipelinePhase.code,
                backend="llama_cpp",
            )
            self.assertEqual(c_gguf_intense, "bartowski/Qwen2.5-Coder-14B-Instruct-GGUF")

    def test_gguf_filename_resolution(self) -> None:
        fn_soft = resolve_gguf_filename_for_repo("bartowski/Qwen2.5-Coder-14B-Instruct-GGUF", IntensityMode.soft)
        self.assertEqual(fn_soft, "Qwen2.5-Coder-14B-Instruct-Q4_K_M.gguf")

        fn_intense = resolve_gguf_filename_for_repo("bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF", IntensityMode.intense)
        self.assertEqual(fn_intense, "DeepSeek-R1-Distill-Qwen-14B-Q8_0.gguf")


class TestReasoningEngineAndRecords(unittest.TestCase):
    """Tests pour le stockage et l'exécution du moteur de raisonnement."""

    def setUp(self) -> None:
        self.test_dir = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_reasoning_record_io(self) -> None:
        rec = ReasoningRecord(
            cardId="sv08.5-001",
            nameFr="Noeunoeuf",
            nameEn="Exeggcute",
            modelRepoId="mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit",
            modelBackend="mlx",
            reasoningText="Analyse des règles détaillée pour Noeunoeuf.",
            createdAtIso="2026-11-03T16:00:00Z",
            completionTokens=150,
            tokensPerSecond=45.2,
            generationDurationSeconds=3.32,
        )
        saved_path = save_reasoning_record(rec, self.test_dir)
        self.assertTrue(saved_path.exists())
        self.assertTrue(has_reasoning_record("sv08.5-001", self.test_dir))

        loaded = load_reasoning_record("sv08.5-001", self.test_dir)
        self.assertIsNotNone(loaded)
        self.assertEqual(loaded.cardId, "sv08.5-001")
        self.assertEqual(loaded.reasoningText, "Analyse des règles détaillée pour Noeunoeuf.")
        self.assertEqual(loaded.tokensPerSecond, 45.2)

    def test_build_reasoning_prompt(self) -> None:
        bundle = make_test_bundle()
        prompt = build_reasoning_prompt(bundle)
        self.assertIn("Noeunoeuf", prompt)
        self.assertIn("sv08.5-001", prompt)
        self.assertIn("Roulade", prompt)

    @patch("compiler.reasoning_engine.ReasoningEngine.load_model_in_memory")
    def test_reasoning_engine_mocked_generation(self, mock_load: MagicMock) -> None:
        engine = ReasoningEngine(intensity="soft", backend="mlx")
        self.assertEqual(engine.repo_id, "mlx-community/gemma-4-26b-a4b-it-4bit")
        self.assertTrue(engine.enable_thinking)

        # Mock tokenizer and model
        fake_tok = MagicMock()
        fake_tok.apply_chat_template.return_value = "Formatted Prompt"
        engine._tokenizer = fake_tok
        engine._model = MagicMock()

        chunk_mock = MagicMock()
        chunk_mock.text = "<|channel>thought\nAnalyse interne Gemma 4.<channel|>\nExplication de la carte Noeunoeuf."
        chunk_mock.generation_tokens = 5

        with patch("mlx_lm.stream_generate", return_value=[chunk_mock]):
            bundle = make_test_bundle()
            rec = engine.generate_reasoning(bundle)
            self.assertEqual(rec.cardId, "sv08.5-001")
            self.assertEqual(rec.rawThinkingProcess, "Analyse interne Gemma 4.")
            self.assertEqual(rec.reasoningText, "Explication de la carte Noeunoeuf.")
            self.assertEqual(rec.completionTokens, 5)
            _, tpl_kwargs = fake_tok.apply_chat_template.call_args
            self.assertIs(tpl_kwargs.get("enable_thinking"), True)

        engine.close()
        self.assertIsNone(engine._model)
        self.assertIsNone(engine._tokenizer)

    def test_split_gemma4_orphan_channel_closing_tag(self) -> None:
        from compiler.reasoning_engine import _split_thinking_and_explanation

        think, expl = _split_thinking_and_explanation("Réflexion débutée dans le prompt.<channel|>\nSortie structurée finale.")
        self.assertEqual(think, "Réflexion débutée dans le prompt.")
        self.assertEqual(expl, "Sortie structurée finale.")

    @patch("compiler.reasoning_engine.ReasoningEngine.load_model_in_memory")
    def test_official_gemma4_sampling_and_max_tokens_defaults(self, mock_load: MagicMock) -> None:
        with patch.dict(os.environ, {}, clear=True):
            engine = ReasoningEngine(intensity="soft", backend="mlx")
            self.assertEqual(engine.max_tokens, 8192)
            self.assertEqual(engine.temperature, 1.0)
            self.assertEqual(engine.top_p, 0.95)
            self.assertEqual(engine.top_k, 64)
            self.assertAlmostEqual(engine.repetition_penalty, 1.08)
            self.assertEqual(engine.repetition_context_size, 128)
            self.assertTrue(engine.enable_thinking)

            fake_tok = MagicMock()
            fake_tok.apply_chat_template.return_value = "<bos>prompt"
            engine._tokenizer = fake_tok
            engine._model = MagicMock()

            chunk_mock = MagicMock()
            chunk_mock.text = "<|channel>thought\nPensée complète.<channel|>\nRéponse."
            chunk_mock.generation_tokens = 12
            chunk_mock.finish_reason = "stop"

            fake_proc = MagicMock()
            with patch("mlx_lm.sample_utils.make_sampler", return_value=MagicMock()) as mock_sampler, patch(
                "mlx_lm.sample_utils.make_logits_processors", return_value=[fake_proc]
            ) as mock_lp, patch(
                "mlx_lm.stream_generate", return_value=[chunk_mock]
            ) as mock_stream:
                rec = engine.generate_reasoning(make_test_bundle())
                mock_sampler.assert_called_once_with(temp=1.0, top_p=0.95, top_k=64)
                mock_lp.assert_called_once_with(repetition_penalty=1.08, repetition_context_size=128)
                _, stream_kwargs = mock_stream.call_args
                self.assertEqual(stream_kwargs["max_tokens"], 8192)
                self.assertEqual(stream_kwargs["logits_processors"], [fake_proc])
                self.assertEqual(rec.finishReason, "stop")
                self.assertFalse(rec.wasTruncated)

    def test_mlx_logits_processors_and_reasoning_prompt_anti_loop(self) -> None:
        from compiler.mlx_utils import build_mlx_logits_processors
        from compiler.reasoning_engine import REASONING_SYSTEM_PROMPT

        self.assertIsNone(build_mlx_logits_processors(None))
        self.assertIsNone(build_mlx_logits_processors(1.0))
        procs = build_mlx_logits_processors(1.08, 128)
        self.assertIsNotNone(procs)
        self.assertEqual(len(procs), 1)

        for needle in (
            "RÈGLE DE CLÔTURE",
            "SHUFFLE_DECK",
            "canUseTurn1GoingFirst",
            "DECK_NOT_EMPTY",
            "HAND_NOT_EMPTY",
            "IS_POKEMON_EX",
        ):
            self.assertIn(needle, REASONING_SYSTEM_PROMPT)

    def test_truncation_detection(self) -> None:
        from compiler.reasoning_engine import detect_reasoning_truncation

        self.assertTrue(detect_reasoning_truncation("Texte normal", finish_reason="length"))
        self.assertTrue(detect_reasoning_truncation("<|channel>thought\nRéflexion sans fin", finish_reason="stop"))
        self.assertTrue(detect_reasoning_truncation("<think>Pas fermé", finish_reason=None))
        self.assertFalse(detect_reasoning_truncation("<|channel>thought\nOK<channel|>\nFini.", finish_reason="stop"))

    @patch("compiler.reasoning_engine.ReasoningEngine.load_model_in_memory")
    def test_generate_reasoning_batch_continuous_mlx(self, mock_load: MagicMock) -> None:
        engine = ReasoningEngine(intensity="soft", backend="mlx", max_tokens=8192)
        fake_tok = MagicMock()
        fake_tok.bos_token = "<bos>"
        fake_tok.eos_token_ids = {1, 106}
        fake_tok.apply_chat_template.return_value = "<bos><|turn>user\nhi<turn|>\n<|turn>model\n"
        fake_tok.encode.return_value = [2, 105, 999]
        fake_tok.decode.side_effect = [
            "<|channel>thought\nPensée A<channel|>\nExplication A",
            "<|channel>thought\nPensée B non fermée",
        ]
        engine._tokenizer = fake_tok
        engine._model = MagicMock()

        b1 = make_test_bundle("sv08.5-001", "Noeunoeuf")
        b2 = make_test_bundle("sv08.5-002", "Noeunoeuf")
        b2.raw_fr["attacks"][0]["damage"] = "30"

        class FakeBatchGen:
            def __init__(self, *args, **kwargs) -> None:
                self.closed = False
                self._step = 0

            def insert(self, prompts, max_tokens=None):
                return [10, 11]

            def stats(self):
                class _Ctx:
                    def __init__(self):
                        self.prompt_tokens = 200
                        self.prompt_tps = 1000.0
                        self.generation_tokens = 4
                        self.generation_tps = 160.0
                        self.peak_memory = 15.2

                    def __enter__(self):
                        return self

                    def __exit__(self, *args):
                        return False

                return _Ctx()

            def next(self):
                from types import SimpleNamespace

                if self._step == 0:
                    self._step += 1
                    return [], [
                        SimpleNamespace(uid=10, token=111, finish_reason=None),
                        SimpleNamespace(uid=11, token=222, finish_reason=None),
                    ]
                if self._step == 1:
                    self._step += 1
                    return [], [
                        SimpleNamespace(uid=10, token=106, finish_reason="stop"),
                        SimpleNamespace(uid=11, token=333, finish_reason="length"),
                    ]
                return [], []

            def close(self):
                self.closed = True

        fake_gen = FakeBatchGen()
        fake_proc = MagicMock()
        with patch("mlx_lm.sample_utils.make_sampler", return_value=MagicMock()), patch(
            "mlx_lm.sample_utils.make_logits_processors", return_value=[fake_proc]
        ) as mock_lp, patch(
            "mlx_lm.generate.BatchGenerator", return_value=fake_gen
        ) as mock_bg_cls:
            records, stats = engine.generate_reasoning_batch([b1, b2], batch_size=2)
            mock_bg_cls.assert_called_once()
            mock_lp.assert_called_once_with(repetition_penalty=1.08, repetition_context_size=128)
            _, bg_kwargs = mock_bg_cls.call_args
            self.assertEqual(bg_kwargs["completion_batch_size"], 2)
            self.assertEqual(bg_kwargs["max_tokens"], 8192)
            self.assertEqual(bg_kwargs["logits_processors"], [fake_proc])
            # Vérifie que add_special_tokens=False est utilisé quand le template commence par <bos>
            for _, enc_kwargs in fake_tok.encode.call_args_list:
                self.assertIs(enc_kwargs.get("add_special_tokens"), False)

            self.assertTrue(fake_gen.closed)
            self.assertEqual(len(records), 2)
            self.assertEqual(records[0].reasoningText, "Explication A")
            self.assertEqual(records[0].finishReason, "stop")
            self.assertFalse(records[0].wasTruncated)
            self.assertEqual(records[0].completionTokens, 1)
            self.assertEqual(records[1].finishReason, "length")
            self.assertTrue(records[1].wasTruncated)
            self.assertEqual(records[1].completionTokens, 2)
            self.assertEqual(stats["batch_tps"], 160.0)


class TestTwoPassPipelineExecution(unittest.TestCase):
    """Tests d'intégration du flux Two-Pass sans fuite de mémoire."""

    def setUp(self) -> None:
        self.test_dir = Path(tempfile.mkdtemp())

    def tearDown(self) -> None:
        shutil.rmtree(self.test_dir, ignore_errors=True)

    @patch.object(ReasoningEngine, "generate_reasoning")
    @patch.object(ReasoningEngine, "load_model_in_memory")
    def test_run_reasoning_phase(self, mock_load: MagicMock, mock_gen: MagicMock) -> None:
        bundle = make_test_bundle("sv08.5-001", "Noeunoeuf")
        mock_gen.return_value = ReasoningRecord(
            cardId="sv08.5-001",
            nameFr="Noeunoeuf",
            modelRepoId="mock-reason",
            modelBackend="mlx",
            reasoningText="Explication de test.",
            createdAtIso="2026-11-03T16:00:00Z",
        )

        res = run_reasoning_phase(
            bundles=[bundle],
            data_dir=self.test_dir,
            intensity="soft",
            backend="mlx",
        )
        self.assertEqual(res["generated"], 1)
        self.assertTrue(has_reasoning_record("sv08.5-001", self.test_dir))

        # Reprise sur cache
        res2 = run_reasoning_phase(
            bundles=[bundle],
            data_dir=self.test_dir,
            intensity="soft",
            backend="mlx",
            force=False,
        )
        self.assertEqual(res2["cached"], 1)
        self.assertEqual(res2["generated"], 0)

    @patch("compiler.mlx_engine.MLXCardCompiler.compile_card")
    @patch("compiler.mlx_engine.MLXCardCompiler.load_model_in_memory")
    def test_run_coding_phase_with_reasoning(self, mock_load: MagicMock, mock_compile: MagicMock) -> None:
        bundle = make_test_bundle("sv08.5-001", "Noeunoeuf")

        # Pré-enregistre le raisonnement
        save_reasoning_record(
            ReasoningRecord(
                cardId="sv08.5-001",
                nameFr="Noeunoeuf",
                modelRepoId="mock-reason",
                modelBackend="mlx",
                reasoningText="Explication préalable.",
                createdAtIso="2026-11-03T16:00:00Z",
            ),
            self.test_dir,
        )

        fake_model = EngineCardModel(
            cardId="sv08.5-001",
            identity=bundle.identity,
            pokemonStats=bundle.pokemon_stats,
            category=CardCategory.POKEMON,
            subCategory=CardSubCategory.BASIC,
            playableActions=[],
            strategicEvaluator={
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 50,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        )
        mock_compile.return_value = fake_model

        from compiler.mlx_engine import MLXCardCompiler
        orig_init = MLXCardCompiler.__init__

        def spy_init(self_obj, *args, **kwargs):
            orig_init(self_obj, *args, **kwargs)

        with patch("compiler.mlx_engine.MLXCardCompiler.__init__", autospec=True, side_effect=spy_init) as spy:
            res = run_coding_phase(
                bundles=[bundle],
                data_dir=self.test_dir,
                intensity="soft",
                backend="mlx",
            )
            self.assertEqual(res["compiled"], 1)
            _, init_kwargs = spy.call_args
            self.assertEqual(init_kwargs.get("model"), "mlx-community/gemma-4-26b-a4b-it-4bit")
            self.assertIs(init_kwargs.get("disable_thinking"), True)

        out_file = self.test_dir / "compiled_cards" / "sv08.5-001.json"
        self.assertTrue(out_file.exists())

    @patch("compiler.mlx_engine.MLXCardCompiler.compile_card")
    @patch("compiler.mlx_engine.MLXCardCompiler.load_model_in_memory")
    @patch.object(ReasoningEngine, "generate_reasoning")
    @patch.object(ReasoningEngine, "load_model_in_memory")
    def test_deduplication_identical_cards_pass1_and_pass2(
        self,
        mock_r_load: MagicMock,
        mock_r_gen: MagicMock,
        mock_c_load: MagicMock,
        mock_c_compile: MagicMock,
    ) -> None:
        from compiler.deterministic_builder import compute_card_rule_signature

        b1 = make_test_bundle("sv08-187", "Noeunoeuf")
        b2 = make_test_bundle("me02.5-200", "Noeunoeuf")
        b2.identity = b2.identity.model_copy(update={"setId": "me02.5", "localId": "200"})
        b3_diff = make_test_bundle("sv09-010", "Noeunoeuf")
        b3_diff.raw_fr["hp"] = 70
        b3_diff.pokemon_stats = b3_diff.pokemon_stats.model_copy(update={"hp": 70})

        self.assertEqual(compute_card_rule_signature(b1), compute_card_rule_signature(b2))
        self.assertNotEqual(compute_card_rule_signature(b1), compute_card_rule_signature(b3_diff))

        # Écrire les raw caches pour tester aussi l'indexation disque ultérieure
        raw_dir = self.test_dir / "raw_tcgdex"
        raw_dir.mkdir(parents=True, exist_ok=True)
        for bx in (b1, b2):
            bx.raw_cache_path = raw_dir / f"{bx.card_id}.json"
            bx.raw_cache_path.write_text(json.dumps(bx.raw_fr), encoding="utf-8")

        mock_r_gen.return_value = ReasoningRecord(
            cardId="sv08-187",
            nameFr="Noeunoeuf",
            modelRepoId="mock-reason",
            modelBackend="mlx",
            reasoningText="Analyse dédupliquée.",
            createdAtIso="2026-11-11T10:00:00Z",
            completionTokens=42,
            tokensPerSecond=60.0,
            generationDurationSeconds=0.7,
        )

        # Passe 1 intra-lot : b1 et b2 sont identiques -> 1 seul appel IA, 2 fiches créées
        res_p1 = run_reasoning_phase(bundles=[b1, b2], data_dir=self.test_dir, backend="mlx")
        self.assertEqual(mock_r_gen.call_count, 1)
        self.assertEqual(res_p1["generated"], 1)
        self.assertEqual(res_p1["deduplicated"], 1)
        rec_b2 = load_reasoning_record("me02.5-200", self.test_dir)
        self.assertIsNotNone(rec_b2)
        self.assertEqual(rec_b2.dedupSourceCardId, "sv08-187")
        self.assertEqual(rec_b2.reasoningText, "Analyse dédupliquée.")

        # Passe 1 réutilisation depuis disque pour une nouvelle réimpression non présente lors du 1er lot
        b4_disk_dup = make_test_bundle("sv08-235", "Noeunoeuf")
        b4_disk_dup.identity = b4_disk_dup.identity.model_copy(update={"setId": "sv08", "localId": "235"})
        res_p1_disk = run_reasoning_phase(bundles=[b4_disk_dup], data_dir=self.test_dir, backend="mlx")
        self.assertEqual(mock_r_gen.call_count, 1)
        self.assertEqual(res_p1_disk["generated"], 0)
        self.assertEqual(res_p1_disk["deduplicated"], 1)
        self.assertEqual(load_reasoning_record("sv08-235", self.test_dir).dedupSourceCardId, "sv08-187")

        # Passe 2 intra-lot : 1 seule compilation IA pour b1 + clonage pour b2 et b4
        mock_c_compile.return_value = EngineCardModel(
            cardId="sv08-187",
            identity=b1.identity,
            pokemonStats=b1.pokemon_stats,
            category=CardCategory.POKEMON,
            subCategory=CardSubCategory.BASIC,
            playableActions=[],
            strategicEvaluator={
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 50,
                "discardPriorityWhenDead": 70,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            },
        )
        res_p2 = run_coding_phase(bundles=[b1, b2, b4_disk_dup], data_dir=self.test_dir, backend="mlx")
        self.assertEqual(mock_c_compile.call_count, 1)
        self.assertEqual(res_p2["compiled"], 3)
        self.assertEqual(res_p2["deduplicated"], 2)
        c_b2 = EngineCardModel.model_validate_json((self.test_dir / "compiled_cards" / "me02.5-200.json").read_text())
        self.assertEqual(c_b2.cardId, "me02.5-200")
        self.assertEqual(c_b2.identity.setId, "me02.5")

    def test_run_coding_phase_batch_and_deduplication(self) -> None:
        """Vérifie de bout en bout le batching continu et la déduplication de la Passe 2."""
        from types import SimpleNamespace

        b1 = make_test_bundle("sv08-187", "Noeunoeuf")
        b1.raw_fr["hp"] = 50
        b2_no_reason_dup = make_test_bundle("me02.5-200", "Noeunoeuf")
        b2_no_reason_dup.raw_fr["hp"] = 50
        b2_no_reason_dup.identity = b2_no_reason_dup.identity.model_copy(
            update={"setId": "me02.5", "localId": "200"}
        )
        b3 = make_test_bundle("sv09-010", "Noeunoeuf")
        b3.identity = b3.identity.model_copy(update={"setId": "sv09", "localId": "010"})
        b3.raw_fr["hp"] = 70
        b4_dup = make_test_bundle("sv09-011", "Noeunoeuf")
        b4_dup.identity = b4_dup.identity.model_copy(update={"setId": "sv09", "localId": "011"})
        b4_dup.raw_fr["hp"] = 70
        b5_missing = make_test_bundle("sv06.5-054", "Noeunoeuf")
        b5_missing.raw_fr["hp"] = 90

        raw_dir = self.test_dir / "raw_tcgdex"
        raw_dir.mkdir(parents=True, exist_ok=True)
        for bx in (b1, b2_no_reason_dup, b3, b4_dup, b5_missing):
            bx.raw_cache_path = raw_dir / f"{bx.card_id}.json"
            bx.raw_cache_path.write_text(json.dumps(bx.raw_fr), encoding="utf-8")

        # Enregistre la Passe 1 uniquement pour b1, b3 et b4 (b2 et b5 n'ont pas de fiche)
        for bx in (b1, b3, b4_dup):
            save_reasoning_record(
                ReasoningRecord(
                    cardId=bx.card_id,
                    nameFr=bx.identity.nameFr,
                    modelRepoId="mock-reason",
                    modelBackend="mlx",
                    reasoningText=f"Analyse pour {bx.card_id}",
                    createdAtIso="2026-11-11T10:00:00Z",
                ),
                self.test_dir,
            )

        valid_json = json.dumps(
            {
                "translatedSlots": [
                    {
                        "slotId": "attack_0",
                        "preconditions": [],
                        "effects": [
                            {"primitive": "DAMAGE_ACTIVE", "target": "OPPONENT_ACTIVE", "amount": 10}
                        ],
                        "deadCardCondition": None,
                    }
                ],
                "aiRole": "MAIN_ATTACKER",
                "turnPhaseWeights": {"turn1": 0.6, "turn2": 0.9, "turn3": 0.9, "turn4Plus": 0.8},
                "additionalSynergyTags": [],
            }
        )

        observed_batches = []

        class FakeCodingBatchGen:
            def __init__(self, *args, **kwargs) -> None:
                self.kwargs = kwargs
                self.closed = False
                self._step = 0

            def insert(self, prompts, max_tokens=None):
                observed_batches.append((prompts, self.kwargs))
                return [100 + i for i in range(len(prompts))]

            def stats(self):
                class _Ctx:
                    def __init__(self):
                        self.prompt_tokens = 400
                        self.prompt_tps = 1200.0
                        self.generation_tokens = 2
                        self.generation_tps = 145.0
                        self.peak_memory = 15.1

                    def __enter__(self):
                        return self

                    def __exit__(self, *args):
                        return False

                return _Ctx()

            def next(self):
                if self._step == 0:
                    self._step += 1
                    return [], [
                        SimpleNamespace(uid=100, token=11, finish_reason=None),
                        SimpleNamespace(uid=101, token=12, finish_reason=None),
                    ]
                if self._step == 1:
                    self._step += 1
                    return [], [
                        SimpleNamespace(uid=100, token=106, finish_reason="stop"),
                        SimpleNamespace(uid=101, token=106, finish_reason="stop"),
                    ]
                return [], []

            def close(self):
                self.closed = True

        fake_tok = MagicMock()
        fake_tok.bos_token = "<bos>"
        fake_tok.eos_token_ids = {1, 106}
        fake_tok.apply_chat_template.return_value = "<bos><|turn>user\nhi<turn|>\n<|turn>model\n"
        fake_tok.encode.return_value = [2, 105, 10]
        fake_tok.decode.side_effect = [valid_json, valid_json]

        from compiler.mlx_engine import MLXCardCompiler

        def load_patched(self_obj):
            self_obj._tokenizer = fake_tok
            self_obj._model = MagicMock()

        with patch.object(MLXCardCompiler, "load_model_in_memory", autospec=True, side_effect=load_patched), patch(
            "mlx_lm.sample_utils.make_sampler", return_value=MagicMock()
        ), patch("mlx_lm.generate.BatchGenerator", side_effect=FakeCodingBatchGen) as mock_bg_cls:
            res = run_coding_phase(
                bundles=[b1, b2_no_reason_dup, b3, b4_dup, b5_missing],
                data_dir=self.test_dir,
                backend="mlx",
                batch_size=2,
            )

            # Uniquement 2 cartes uniques (b1 et b3) doivent être soumises à BatchGenerator
            mock_bg_cls.assert_called_once()
            self.assertEqual(len(observed_batches), 1)
            submitted_prompts, bg_kwargs = observed_batches[0]
            self.assertEqual(len(submitted_prompts), 2)
            self.assertEqual(bg_kwargs["completion_batch_size"], 2)
            # enable_thinking=False obligatoire en Passe 2
            self.assertTrue(all(call_kw.get("enable_thinking") is False for _, call_kw in fake_tok.apply_chat_template.call_args_list))

            self.assertEqual(res["compiled"], 4)
            self.assertEqual(res["deduplicated"], 2)
            self.assertEqual(res["missing_reasoning"], [("sv06.5-054", "Noeunoeuf")])
            self.assertEqual(res["batch_stats"]["batch_tps"], 145.0)

            c_b1 = EngineCardModel.model_validate_json((self.test_dir / "compiled_cards" / "sv08-187.json").read_text())
            c_b2 = EngineCardModel.model_validate_json((self.test_dir / "compiled_cards" / "me02.5-200.json").read_text())
            c_b3 = EngineCardModel.model_validate_json((self.test_dir / "compiled_cards" / "sv09-010.json").read_text())
            c_b4 = EngineCardModel.model_validate_json((self.test_dir / "compiled_cards" / "sv09-011.json").read_text())

            self.assertEqual(c_b1.pokemonStats.hp, 50)
            self.assertEqual(c_b2.cardId, "me02.5-200")
            self.assertEqual(c_b2.identity.setId, "me02.5")
            self.assertEqual(c_b2.compilationMetadata.completionTokens, 0)
            self.assertIn("dedup:sv08-187", c_b2.compilationMetadata.modelFilename)
            self.assertEqual(c_b3.pokemonStats.hp, 70)
            self.assertEqual(c_b4.cardId, "sv09-011")
            self.assertIn("dedup:sv09-010", c_b4.compilationMetadata.modelFilename)
            self.assertFalse((self.test_dir / "compiled_cards" / "sv06.5-054.json").exists())

            # Deuxième appel Passe 2 avec une nouvelle réimpression identique à sv08-187 (sans fiche Passe 1) -> 0 appel IA
            b6_disk_dup = make_test_bundle("sv08-235", "Noeunoeuf")
            b6_disk_dup.raw_fr["hp"] = 50
            b6_disk_dup.identity = b6_disk_dup.identity.model_copy(update={"setId": "sv08", "localId": "235"})
            b6_disk_dup.raw_cache_path = raw_dir / "sv08-235.json"
            b6_disk_dup.raw_cache_path.write_text(json.dumps(b6_disk_dup.raw_fr), encoding="utf-8")

            res2 = run_coding_phase(bundles=[b6_disk_dup], data_dir=self.test_dir, backend="mlx", batch_size=2)
            mock_bg_cls.assert_called_once()
            self.assertEqual(res2["compiled"], 1)
            self.assertEqual(res2["deduplicated"], 1)
            c_b6 = EngineCardModel.model_validate_json((self.test_dir / "compiled_cards" / "sv08-235.json").read_text())
            self.assertEqual(c_b6.cardId, "sv08-235")
            self.assertEqual(c_b6.identity.setId, "sv08")


class TestCliTwoPassCommands(unittest.TestCase):
    """Tests pour les commandes Typer CLI Two-Pass."""

    def setUp(self) -> None:
        self.runner = CliRunner()

    @patch("compiler.cli._execute_run_pipeline")
    def test_cli_reason_command(self, mock_exec: MagicMock) -> None:
        result = self.runner.invoke(app, ["reason", "--ids", "sv08.5-001", "--intensity", "soft"])
        self.assertEqual(result.exit_code, 0)
        mock_exec.assert_called_once()
        _, kwargs = mock_exec.call_args
        self.assertEqual(kwargs["pipeline"], "two_pass")
        self.assertEqual(kwargs["phase"], "reason")
        self.assertEqual(kwargs["intensity"], "soft")

    @patch("compiler.cli._execute_run_pipeline")
    def test_cli_code_command(self, mock_exec: MagicMock) -> None:
        result = self.runner.invoke(app, ["code", "--ids", "sv08.5-001", "--intensity", "intense"])
        self.assertEqual(result.exit_code, 0)
        mock_exec.assert_called_once()
        _, kwargs = mock_exec.call_args
        self.assertEqual(kwargs["pipeline"], "two_pass")
        self.assertEqual(kwargs["phase"], "code")
        self.assertEqual(kwargs["intensity"], "intense")

    @patch("compiler.cli._execute_run_pipeline")
    def test_cli_run_with_two_pass_flag(self, mock_exec: MagicMock) -> None:
        result = self.runner.invoke(app, ["run", "--pipeline", "two_pass", "--phase", "all", "--ids", "sv08.5-001"])
        self.assertEqual(result.exit_code, 0)
        mock_exec.assert_called_once()
        _, kwargs = mock_exec.call_args
        self.assertEqual(kwargs["pipeline"], "two_pass")
        self.assertEqual(kwargs["phase"], "all")

    def test_coding_output_auto_healing_resilience(self) -> None:
        """Vérifie que les variations de format générées par l'IA de coding (ex: Rare Candy sv04-125) sont auto-corrigées."""
        from compiler.schemas import AIRole, EffectPrimitive, LLMCompiledPayload

        raw_llm_dict = {
            "reasoningAnalysis": "Super Bonbon permet d'évoluer directement un Pokémon de base en Niveau 2.",
            "category": "TRAINER",
            "subCategory": "ITEM",
            "playableActions": [
                {
                    "actionId": "trainer_0",
                    "preconditions": [
                        "NOT_FIRST_TURN",
                        "BASIC_POKEMON_IN_PLAY",
                        "STAGE_2_CARD_IN_HAND",
                    ],
                    "primitives": ["EVOLVE_POKEMON"],
                    "deadCardCondition": "NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY",
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "EVOLUTION_ACCELERATOR",
                "turnPhaseWeights": {
                    "PREPARATION": 0.0,
                    "MAIN_PHASE_1": 0.0,
                    "MAIN_PHASE_2": 0.8,
                    "END_PHASE": 1.5,
                },
                "decklistSynergyRequirements": [
                    "BASIC_POKEMON",
                    "STAGE_2_EVOLUTION",
                ],
                "inGameDeadCardConditions": [
                    "NO_STAGE_2_EVOLUTION_IN_HAND",
                ],
            },
        }

        payload = LLMCompiledPayload.model_validate(raw_llm_dict)
        self.assertEqual(len(payload.translatedSlots), 1)
        slot = payload.translatedSlots[0]
        self.assertEqual(slot.slotId, "trainer_0")
        self.assertEqual(len(slot.effects), 1)
        self.assertEqual(slot.effects[0].primitive, EffectPrimitive.EVOLVE_POKEMON)
        self.assertEqual(len(slot.preconditions), 3)
        self.assertEqual(slot.deadCardCondition, "NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY")
        self.assertEqual(payload.aiRole, AIRole.CONSISTENCY_BOOSTER)
        self.assertEqual(payload.turnPhaseWeights.turn1, 0.0)
        self.assertEqual(payload.turnPhaseWeights.turn4Plus, 1.0)
        self.assertEqual(len(payload.additionalSynergyTags), 2)


if __name__ == "__main__":
    unittest.main()
