"""Tests unitaires pour le moteur local Apple MLX (`compiler/mlx_engine.py`).

Vérifie l'instanciation, la normalisation des modèles, la gestion du thinking,
le streaming temps-réel avec rafraîchissement à 1 seconde, la conformité Pydantic
et l'intégration CLI via `--local-backend mlx` / `LOCAL_BACKEND=mlx`.
"""

from __future__ import annotations

import json
import os
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from compiler.cli import LLMProvider, create_compiler_engine
from compiler.mlx_engine import (
    DEFAULT_MLX_MODEL_REPO_ID,
    MLXCardCompiler,
    normalize_mlx_model_id,
)
from compiler.schemas import (
    CardCategory,
    CardIdentity,
    CardSubCategory,
    EngineCardModel,
    PokemonStats,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


def create_fake_card_bundle(
    card_id: str = "sv01-001",
    name_fr: str = "Pikachu",
    category: CardCategory = CardCategory.POKEMON,
    sub_category: CardSubCategory = CardSubCategory.BASIC,
) -> FetchedCardBundle:
    from pathlib import Path
    identity = CardIdentity(
        cardId=card_id,
        nameFr=name_fr,
        nameEn="Pikachu",
        category=category,
        subCategory=sub_category,
        setId="sv01",
        localId="001",
    )
    stats = PokemonStats(
        hp=60,
        types=["Électrique"],
        retreatCost=1,
    )
    raw_fr = {
        "id": card_id,
        "name": name_fr,
        "category": "Pokemon",
        "attacks": [{"name": "Éclair", "cost": ["Électrique"], "damage": "20", "effect": "Lancez une pièce."}],
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


class TestMLXCompiler(unittest.TestCase):
    """Tests unitaires pour MLXCardCompiler."""

    def test_normalize_mlx_model_id(self) -> None:
        """Vérifie la normalisation du modèle par défaut et la correction du typo RC0 -> RCO."""
        self.assertEqual(normalize_mlx_model_id(None), DEFAULT_MLX_MODEL_REPO_ID)
        self.assertEqual(normalize_mlx_model_id(""), DEFAULT_MLX_MODEL_REPO_ID)
        self.assertEqual(
            normalize_mlx_model_id("uqer1244/Qwen3.8-27B-GSQ-RC0-MLX"),
            "uqer1244/Qwen3.8-27B-GSQ-RCO-MLX",
        )
        self.assertEqual(
            normalize_mlx_model_id("mlx-community/Qwen2.5-7B-Instruct-4bit"),
            "mlx-community/Qwen2.5-7B-Instruct-4bit",
        )

    def test_mlx_compiler_init_defaults(self) -> None:
        """Vérifie l'initialisation par défaut sans variables d'environnement."""
        with patch.dict(os.environ, {}, clear=True):
            compiler = MLXCardCompiler()
            self.assertEqual(compiler.repo_id, DEFAULT_MLX_MODEL_REPO_ID)
            self.assertIsNone(compiler.thinking)
            self.assertFalse(compiler.disable_thinking)

    def test_mlx_compiler_init_thinking_options(self) -> None:
        """Vérifie la gestion des options thinking (low, high, null, disable_thinking)."""
        with patch.dict(os.environ, {"LM_STUDIO_THINKING": "low"}):
            c1 = MLXCardCompiler()
            self.assertEqual(c1.thinking, "low")
            self.assertFalse(c1.disable_thinking)

        with patch.dict(os.environ, {"LM_STUDIO_DISABLE_THINKING": "true"}):
            c2 = MLXCardCompiler()
            self.assertEqual(c2.thinking, "null")
            self.assertTrue(c2.disable_thinking)

        c3 = MLXCardCompiler(disable_thinking=True)
        self.assertEqual(c3.thinking, "null")
        self.assertTrue(c3.disable_thinking)

        c4 = MLXCardCompiler(thinking="medium")
        self.assertEqual(c4.thinking, "medium")
        self.assertFalse(c4.disable_thinking)

    def test_basic_energy_bypass(self) -> None:
        """Vérifie le court-circuit immédiat pour les cartes énergies de base."""
        from pathlib import Path
        energy_bundle = FetchedCardBundle(
            card_id="sve-001",
            resolved_tcgdex_id="sve-001",
            identity=CardIdentity(
                cardId="sve-001",
                nameFr="Énergie Plante",
                nameEn="Grass Energy",
                category=CardCategory.ENERGY,
                subCategory=CardSubCategory.BASIC_ENERGY,
                setId="sve",
                localId="001",
            ),
            pokemon_stats=None,
            raw_fr={"id": "sve-001", "name": "Énergie Plante"},
            raw_en={},
            raw_cache_path=Path("/tmp/sve_001.json"),
        )
        compiler = MLXCardCompiler()
        card = compiler.compile_card(energy_bundle)
        self.assertIsInstance(card, EngineCardModel)
        self.assertEqual(card.cardId, "sve-001")
        self.assertEqual(card.category, CardCategory.ENERGY)
        self.assertEqual(card.subCategory, CardSubCategory.BASIC_ENERGY)
        self.assertIsNotNone(card.compilationMetadata)
        self.assertEqual(card.compilationMetadata.modelRepoId, "STATIC_DETERMINISTIC")

    @patch("mlx_lm.load")
    @patch("mlx_lm.stream_generate")
    def test_compile_card_streaming_and_live_tps(
        self,
        mock_stream_generate: MagicMock,
        mock_load: MagicMock,
    ) -> None:
        """Vérifie la compilation d'une carte avec streaming, rafraîchissement 1s et parsing JSON."""
        mock_model = MagicMock()
        mock_tokenizer = MagicMock()
        mock_tokenizer.apply_chat_template.return_value = "<|im_start|>system...<|im_start|>user..."
        mock_load.return_value = (mock_model, mock_tokenizer)

        valid_json_payload = {
            "reasoningAnalysis": "Analyse de la carte Pikachu avec MLX.",
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": [
                {
                    "actionId": "attack_eclair",
                    "label": "Éclair",
                    "sourceType": "ATTACK",
                    "timing": "END_OF_TURN_ATTACK",
                    "canUseTurn1GoingFirst": False,
                    "canUseTurn1GoingSecond": True,
                    "preconditions": [],
                    "costs": [],
                    "effects": [
                        {
                            "primitive": "DEAL_DAMAGE_ACTIVE",
                            "sourceZone": "ACTIVE",
                            "targetZone": "ACTIVE",
                            "count": 1,
                            "upTo": False,
                            "targetFilter": None,
                            "baseDamage": 20,
                            "damageScalingPerOpponentPrizeTaken": None,
                        }
                    ],
                }
            ],
            "strategicEvaluator": {
                "primaryRole": "MAIN_ATTACKER",
                "intrinsicBaseScore": 60,
                "discardPriorityWhenDead": 50,
                "holdForNextTurnBonus": 10,
                "decklistSynergyRequirements": [],
                "inGameDeadCardConditions": [],
                "turnPhaseWeights": {
                    "turn1": 1.0,
                    "turn2": 1.0,
                    "turn3": 1.0,
                    "turn4Plus": 1.0,
                },
            },
        }

        # Simuler un retour avec balise <think>
        full_text = f"<think>Je réfléchis à la carte...</think>\n```json\n{json.dumps(valid_json_payload)}\n```"
        chunks = [
            SimpleNamespace(text="<think>Je réfléchis", generation_tokens=5, finish_reason=None),
            SimpleNamespace(text=" à la carte...</think>\n```json\n", generation_tokens=15, finish_reason=None),
            SimpleNamespace(text=json.dumps(valid_json_payload), generation_tokens=85, finish_reason=None),
            SimpleNamespace(text="\n```", generation_tokens=90, finish_reason="stop"),
        ]
        mock_stream_generate.return_value = iter(chunks)

        token_updates = []

        def on_token(count: int, tps: float) -> None:
            token_updates.append((count, tps))

        compiler = MLXCardCompiler(model="uqer1244/Qwen3.8-27B-GSQ-RC0-MLX")
        bundle = create_fake_card_bundle()

        card = compiler.compile_card(bundle, on_token=on_token)

        self.assertIsInstance(card, EngineCardModel)
        self.assertEqual(card.cardId, "sv01-001")
        self.assertEqual(len(card.playableActions), 3)
        attack_actions = [a for a in card.playableActions if a.actionId.startswith("attack_")]
        self.assertEqual(len(attack_actions), 1)
        self.assertEqual(attack_actions[0].label, "Éclair")
        self.assertIsNotNone(card.compilationMetadata)
        self.assertEqual(card.compilationMetadata.completionTokens, 90)
        self.assertIn("uqer1244/Qwen3.8-27B-GSQ-RCO-MLX", card.compilationMetadata.modelRepoId)
        self.assertTrue(len(token_updates) > 0)

    def test_cli_create_compiler_engine_backend_selection(self) -> None:
        """Vérifie que la factory `create_compiler_engine` sélectionne correctement MLX ou llama_cpp."""
        with patch.dict(os.environ, {"LOCAL_BACKEND": "mlx"}, clear=True):
            engine = create_compiler_engine(
                provider=LLMProvider.local,
                model="uqer1244/Qwen3.8-27B-GSQ-RC0-MLX",
            )
            self.assertIsInstance(engine, MLXCardCompiler)
            self.assertEqual(engine.repo_id, "uqer1244/Qwen3.8-27B-GSQ-RCO-MLX")

        with patch.dict(os.environ, {"LOCAL_BACKEND": "llama_cpp"}, clear=True):
            engine_gguf = create_compiler_engine(
                provider=LLMProvider.local,
                model="Qwen/Qwen3-14B-GGUF",
            )
            from compiler.llm_engine import LocalLLMCardCompiler
            self.assertIsInstance(engine_gguf, LocalLLMCardCompiler)

        # Sélection explicite via paramètre local_backend
        engine_param_mlx = create_compiler_engine(
            provider=LLMProvider.local,
            local_backend="mlx",
        )
        self.assertIsInstance(engine_param_mlx, MLXCardCompiler)

    @patch("mlx_lm.load", side_effect=IndexError("[moveaxis] Invalid axis 2 for array with 1 dimensions."))
    def test_load_model_non_standard_packed_error(self, mock_load: MagicMock) -> None:
        """Vérifie le message d'erreur explicite et pédagogique en cas de modèle non standard (ex: GSQ-RCO packed)."""
        compiler = MLXCardCompiler(model="uqer1244/Qwen3.8-27B-GSQ-RCO-MLX")
        with self.assertRaises(RuntimeError) as ctx:
            compiler.load_model_in_memory()
        self.assertIn("mlx-community/Qwen3.8-27B-4bit", str(ctx.exception))
        self.assertIn("GSQ-RCO", str(ctx.exception))

    def test_gemma4_default_model_and_thinking_toggle_for_pass2(self) -> None:
        """Vérifie le modèle par défaut gemma-4-26b-a4b-4bit, le flag enable_thinking et le nettoyage JSON."""
        from compiler.llm_engine import extract_json_payload

        self.assertEqual(DEFAULT_MLX_MODEL_REPO_ID, "mlx-community/gemma-4-26b-a4b-4bit")

        tok = MagicMock()
        tok.apply_chat_template.return_value = "FORMATTED"

        # Passe 2 : disable_thinking=True -> enable_thinking=False obligatoire
        c_pass2 = MLXCardCompiler(disable_thinking=True)
        c_pass2._tokenizer = tok
        c_pass2._build_formatted_prompt([{"role": "user", "content": "hi"}])
        _, kwargs_off = tok.apply_chat_template.call_args
        self.assertIs(kwargs_off.get("enable_thinking"), False)

        # Mode actif : disable_thinking=False -> enable_thinking=True
        c_on = MLXCardCompiler(disable_thinking=False)
        c_on._tokenizer = tok
        c_on._build_formatted_prompt([{"role": "user", "content": "hi"}])
        _, kwargs_on = tok.apply_chat_template.call_args
        self.assertIs(kwargs_on.get("enable_thinking"), True)

        # Extraction JSON même en cas de canal thought Gemma 4 résiduel
        raw = '<|channel>thought\nblabla<channel|>\n```json\n{"aiRole": "DRAW_ENGINE"}\n```'
        self.assertEqual(extract_json_payload(raw), '{"aiRole": "DRAW_ENGINE"}')


if __name__ == "__main__":
    unittest.main()
