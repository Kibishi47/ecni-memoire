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
            self.assertEqual(m, "mlx-community/gemma-4-26b-a4b-4bit")

            # MLX Intense
            m = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.single,
                intensity=IntensityMode.intense,
                backend="mlx",
            )
            self.assertEqual(m, "mlx-community/gemma-4-26b-a4b-4bit")

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
            self.assertEqual(r_mlx_soft, "mlx-community/gemma-4-26b-a4b-4bit")

            r_mlx_intense = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.intense,
                phase=PipelinePhase.reason,
                backend="mlx",
            )
            self.assertEqual(r_mlx_intense, "mlx-community/gemma-4-26b-a4b-4bit")

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
            self.assertEqual(c_mlx_soft, "mlx-community/gemma-4-26b-a4b-4bit")

            c_mlx_intense = resolve_model_for_configuration(
                pipeline_mode=PipelineMode.two_pass,
                intensity=IntensityMode.intense,
                phase=PipelinePhase.code,
                backend="mlx",
            )
            self.assertEqual(c_mlx_intense, "mlx-community/gemma-4-26b-a4b-4bit")

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
        self.assertEqual(engine.repo_id, "mlx-community/gemma-4-26b-a4b-4bit")
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
            self.assertEqual(init_kwargs.get("model"), "mlx-community/gemma-4-26b-a4b-4bit")
            self.assertIs(init_kwargs.get("disable_thinking"), True)

        out_file = self.test_dir / "compiled_cards" / "sv08.5-001.json"
        self.assertTrue(out_file.exists())


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
