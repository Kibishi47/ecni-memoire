"""Tests unitaires pour le constructeur déterministe (`compiler/deterministic_builder.py`), le schéma `EngineCardModel` et `LocalLLMCardCompiler`."""

from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from compiler.deterministic_builder import (
    build_deterministic_skeleton,
    build_fallback_llm_payload,
    merge_llm_payload_into_skeleton,
)
from compiler.llm_engine import LocalLLMCardCompiler
from compiler.schemas import (
    ActionType,
    AIRole,
    CardCategory,
    CardSubCategory,
    CompilationMetadata,
    EffectPrimitive,
    EngineCardModel,
    TimingPhase,
)
from compiler.tcgdex_fetcher import FetchedCardBundle, TCGdexFetcher


class TestSchemaExtensionsAndDeterministicBuilder(unittest.TestCase):
    def setUp(self) -> None:
        self.data_dir = Path(__file__).resolve().parent.parent / "data"
        self.fetcher = TCGdexFetcher(data_dir=self.data_dir)

    def test_mega_kangaskhan_ex_me01_104_skeleton_and_merge(self):
        raw_path = self.data_dir / "raw_tcgdex" / "me01-104.json"
        self.assertTrue(raw_path.exists())
        raw_payload = json.loads(raw_path.read_text(encoding="utf-8"))
        skel = build_deterministic_skeleton(raw_payload)

        # 1. Identity & 3-Prize Mega-Evolution ex rule
        self.assertEqual(skel.cardId, "me01-104")
        self.assertEqual(skel.identity.nameFr, "Méga-Kangourex-ex")
        self.assertTrue(skel.identity.isRuleBox)
        self.assertEqual(skel.identity.prizeCardsGiven, 3)
        self.assertEqual(skel.category, CardCategory.POKEMON)
        self.assertEqual(skel.subCategory, CardSubCategory.BASIC)

        # 2. PokemonStats
        self.assertIsNotNone(skel.pokemonStats)
        self.assertEqual(skel.pokemonStats.hp, 300)
        self.assertEqual(skel.pokemonStats.types, ["Incolore"])
        self.assertEqual(skel.pokemonStats.stage, "Base")
        self.assertEqual(skel.pokemonStats.retreatCost, 3)
        self.assertEqual(len(skel.pokemonStats.weaknesses), 1)
        self.assertEqual(skel.pokemonStats.weaknesses[0].type, "Combat")
        self.assertEqual(skel.pokemonStats.weaknesses[0].value, "×2")

        # 3. PlayableActions skeleton
        action_types = [a.actionType for a in skel.playableActions]
        self.assertEqual(
            action_types,
            [
                ActionType.PLAY_FROM_HAND,
                ActionType.USE_ABILITY,
                ActionType.ATTACK,
                ActionType.RETREAT,
            ],
        )

        # 4. Merge fallback/LLM payload and verify Course Fructueuse & Combo en Rafale
        payload = build_fallback_llm_payload(skel)
        model = merge_llm_payload_into_skeleton(skel, payload)

        ability_act = next(a for a in model.playableActions if a.actionType == ActionType.USE_ABILITY)
        self.assertEqual(ability_act.label, "Course Fructueuse")
        self.assertIn("SELF_IS_ACTIVE", ability_act.preconditions)
        self.assertTrue(any(e.primitive == EffectPrimitive.DRAW_CARDS and e.count == 2 for e in ability_act.effects))

        attack_act = next(a for a in model.playableActions if a.actionType == ActionType.ATTACK)
        self.assertEqual(attack_act.label, "Combo en Rafale")
        self.assertEqual(attack_act.cost, {"Incolore": 3})
        self.assertTrue(any(e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.value == 200 for e in attack_act.effects))

        retreat_act = next(a for a in model.playableActions if a.actionType == ActionType.RETREAT)
        self.assertEqual(retreat_act.cost, {"Incolore": 3})

    def test_regulation_mark_g_and_tera_and_stage2_synergies(self):
        raw_charizard = {
            "id": "sv03-125",
            "localId": "125",
            "name": "Dracaufeu-ex",
            "category": "Pokémon",
            "stage": "Niveau 2",
            "evolveFrom": "Reptincel",
            "hp": 330,
            "types": ["Obscurité"],
            "dexId": [6],
            "regulationMark": "G",
            "legal": {"standard": True, "expanded": True},
            "rarity": "Double rare",
            "set": {"id": "sv03", "name": "Flammes Obsidiennes"},
            "abilities": [
                {
                    "type": "Talent",
                    "name": "Règne Infernal",
                    "effect": (
                        "Lorsque vous jouez ce Pokémon de votre main pour faire évoluer l'un de vos Pokémon, "
                        "vous pouvez chercher dans votre deck jusqu'à 3 cartes Énergie {R} de base et les attacher à vos Pokémon."
                    ),
                }
            ],
            "attacks": [
                {
                    "name": "Combustion Obscure",
                    "cost": ["Feu", "Feu"],
                    "damage": "180+",
                    "effect": (
                        "Cette attaque inflige 30 dégâts supplémentaires pour chaque carte Récompense "
                        "que votre adversaire a récupérée."
                    ),
                }
            ],
            "effect": "Tant que ce Pokémon est sur votre Banc, évitez tous les dégâts infligés à ce Pokémon par des attaques.",
        }
        skel = build_deterministic_skeleton(raw_charizard)
        self.assertTrue(skel.identity.legalStandard)
        self.assertTrue(skel.identity.isRuleBox)
        self.assertEqual(skel.identity.prizeCardsGiven, 2)
        self.assertTrue(skel.identity.isTera)
        self.assertIn("requires_energy_type:Feu", skel.base_synergies)

    def test_paradox_ancient_and_future_detection_by_dex_id(self):
        raw_raging_bolt = {
            "id": "sv05-123",
            "localId": "123",
            "name": "Ire-Foudre-ex",
            "category": "Pokémon",
            "stage": "De base",
            "hp": 240,
            "types": ["Dragon"],
            "dexId": [1021],
            "regulationMark": "H",
            "legal": {"standard": True, "expanded": True},
            "set": {"id": "sv05", "name": "Forces Temporelles"},
        }
        id_rb, _ = self.fetcher.build_deterministic_models("sv05-123", raw_raging_bolt, None)
        self.assertTrue(id_rb.isAncient)
        self.assertFalse(id_rb.isFuture)

        raw_iron_leaves = {
            "id": "sv05-025",
            "localId": "025",
            "name": "Vert-de-Fer-ex",
            "category": "Pokémon",
            "stage": "De base",
            "hp": 220,
            "types": ["Plante"],
            "dexId": [1010],
            "regulationMark": "H",
            "legal": {"standard": True, "expanded": True},
            "set": {"id": "sv05", "name": "Forces Temporelles"},
        }
        id_il, _ = self.fetcher.build_deterministic_models("sv05-025", raw_iron_leaves, None)
        self.assertFalse(id_il.isAncient)
        self.assertTrue(id_il.isFuture)

    def test_pure_damage_attack_creates_zero_llm_slots(self):
        raw_vanilla = {
            "id": "sv01-001",
            "name": "Pikachu",
            "category": "Pokémon",
            "stage": "De base",
            "hp": 60,
            "types": ["Électrique"],
            "retreat": 1,
            "attacks": [
                {
                    "name": "Éclair",
                    "cost": ["Électrique", "Incolore"],
                    "damage": 30,
                }
            ],
        }
        skel = build_deterministic_skeleton(raw_vanilla)
        self.assertEqual(len(skel.slots_for_llm), 0)
        atk = next(a for a in skel.playableActions if a.actionType == ActionType.ATTACK)
        self.assertEqual(atk.cost, {"Électrique": 1, "Incolore": 1})
        self.assertEqual(len(atk.effects), 1)
        self.assertEqual(atk.effects[0].primitive, EffectPrimitive.DAMAGE_ACTIVE)
        self.assertEqual(atk.effects[0].value, 30)

    def test_compilation_metadata_tokens_per_second(self):
        meta_basic = CompilationMetadata(
            modelRepoId="repo",
            modelFilename="file.gguf",
            compilationTimeSeconds=2.5,
            compiledAtIso="2026-10-31T12:00:00Z",
        )
        self.assertIsNone(meta_basic.tokensPerSecond)
        self.assertIsNone(meta_basic.completionTokens)

        meta_with_speed = CompilationMetadata(
            modelRepoId="repo",
            modelFilename="file.gguf",
            compilationTimeSeconds=2.5,
            compiledAtIso="2026-10-31T12:00:00Z",
            completionTokens=125,
            tokensPerSecond=50.0,
        )
        self.assertEqual(meta_with_speed.completionTokens, 125)
        self.assertEqual(meta_with_speed.tokensPerSecond, 50.0)

    def _make_statitik_bundle(self) -> FetchedCardBundle:
        raw_fr = {
            "id": "sv06.5-001",
            "name": "Statitik",
            "category": "Pokémon",
            "stage": "Base",
            "hp": 40,
            "types": ["Plante"],
            "attacks": [{"name": "Esquive", "cost": ["Plante"], "damage": 10, "effect": "Lancez une pièce."}],
        }
        identity, pstats = self.fetcher.build_deterministic_models("sv06.5-001", raw_fr, None)
        return FetchedCardBundle(
            card_id="sv06.5-001",
            resolved_tcgdex_id="sv06.5-001",
            raw_fr=raw_fr,
            raw_en=None,
            identity=identity,
            pokemon_stats=pstats,
            raw_cache_path=Path("data/raw_tcgdex/sv06.5-001.json"),
        )

    def test_local_llm_compiler_streaming_token_callback(self):
        fake_payload = {
            "translatedSlots": [],
            "aiRole": "MAIN_ATTACKER",
            "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            "additionalSynergyTags": [],
        }
        json_str = json.dumps(fake_payload)
        chunks = [
            {"choices": [{"delta": {"content": json_str[:25]}}]},
            {"choices": [{"delta": {"content": json_str[25:50]}}]},
            {"choices": [{"delta": {"content": json_str[50:]}, "finish_reason": "stop"}]},
        ]

        compiler = LocalLLMCardCompiler()
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = iter(chunks)
        compiler._llm = mock_llm

        bundle = self._make_statitik_bundle()
        updates: list[tuple[int, float]] = []
        model = compiler.compile_card(bundle, on_token=lambda tok, tps: updates.append((tok, tps)))
        self.assertEqual(model.cardId, "sv06.5-001")
        self.assertGreater(len(updates), 0)
        self.assertEqual(updates[-1][0], 3)
        self.assertGreater(updates[-1][1], 0.0)

    def test_local_llm_tokens_per_second_measured_from_first_token(self):
        fake_payload = {
            "translatedSlots": [],
            "aiRole": "MAIN_ATTACKER",
            "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            "additionalSynergyTags": [],
        }
        json_str = json.dumps(fake_payload)
        chunks = [
            {"choices": [{"delta": {"content": json_str[:25]}}]},
            {"choices": [{"delta": {"content": json_str[25:50]}}]},
            {"choices": [{"delta": {"content": json_str[50:]}, "finish_reason": "stop"}]},
        ]

        compiler = LocalLLMCardCompiler()
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = iter(chunks)
        compiler._llm = mock_llm

        bundle = self._make_statitik_bundle()
        time_sequence = [100.0, 103.0, 104.0, 105.0, 105.0, 105.1]
        time_idx = 0

        def fake_perf_counter():
            nonlocal time_idx
            if time_idx < len(time_sequence):
                val = time_sequence[time_idx]
                time_idx += 1
                return val
            return 105.1

        with patch("time.perf_counter", side_effect=fake_perf_counter):
            model = compiler.compile_card(bundle, on_token=lambda tok, tps: None)

        meta = model.compilationMetadata
        self.assertIsNotNone(meta)
        self.assertEqual(meta.completionTokens, 3)
        self.assertEqual(meta.tokensPerSecond, 1.0)
        self.assertEqual(meta.timeToFirstTokenSeconds, 3.0)
        self.assertAlmostEqual(meta.compilationTimeSeconds, 5.1, places=1)

    def test_local_llm_compiler_thinking_disabled_parity(self):
        compiler = LocalLLMCardCompiler(disable_thinking=True)
        self.assertTrue(compiler.disable_thinking)
        self.assertEqual(compiler.thinking, "null")

        fake_payload = {
            "translatedSlots": [],
            "aiRole": "MAIN_ATTACKER",
            "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            "additionalSynergyTags": [],
        }
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = {
            "choices": [{"message": {"content": json.dumps(fake_payload)}, "finish_reason": "stop"}],
            "usage": {"completion_tokens": 15},
        }
        compiler._llm = mock_llm

        bundle = self._make_statitik_bundle()
        model = compiler.compile_card(bundle)
        self.assertEqual(model.cardId, "sv06.5-001")

        _, call_kwargs = mock_llm.create_chat_completion.call_args
        self.assertEqual(call_kwargs.get("max_tokens"), 2048)
        self.assertEqual(call_kwargs.get("chat_template_kwargs"), {"enable_thinking": False})
        self.assertEqual(call_kwargs.get("enable_thinking"), False)
        self.assertEqual(call_kwargs.get("reasoning_effort"), "none")

    def test_local_llm_compiler_oom_friendly_error(self):
        compiler = LocalLLMCardCompiler()
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.side_effect = RuntimeError("llama_decode returned -3")
        compiler._llm = mock_llm

        bundle = self._make_statitik_bundle()
        with self.assertRaises(RuntimeError) as ctx:
            compiler.compile_card(bundle)

        self.assertIn("Mémoire GPU/Metal saturée sur Apple Silicon", str(ctx.exception))
        self.assertIn("LLM_PROVIDER=lm_studio", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
