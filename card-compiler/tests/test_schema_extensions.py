"""Tests unitaires pour les extensions du schéma JSON, le filtre Standard (G/H/I) et le post-processeur."""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from compiler.post_processor import (
    _build_deterministic_ability_action,
    _build_deterministic_attack_action,
    sanitize_and_enrich_card,
)
from compiler.schemas import (
    ActionSourceType,
    ActionTiming,
    CardCategory,
    CardSubCategory,
    CostType,
    DamageScalingType,
    EffectPrimitive,
    EngineCardModel,
    PreconditionType,
    SpecialConditionType,
)
from compiler.tcgdex_fetcher import TCGdexFetcher


class TestSchemaExtensionsAndStandardFilter(unittest.TestCase):
    def setUp(self) -> None:
        self.data_dir = Path(__file__).resolve().parent.parent / "data"
        self.fetcher = TCGdexFetcher(data_dir=self.data_dir)

    def test_backward_compatibility_with_all_compiled_cards(self):
        compiled_dir = self.data_dir / "compiled_cards"
        if not compiled_dir.exists():
            return
        files = sorted(compiled_dir.glob("*.json"))
        self.assertGreater(len(files), 0)
        for fpath in files:
            raw_text = fpath.read_text(encoding="utf-8")
            model = EngineCardModel.model_validate_json(raw_text)
            self.assertEqual(model.cardId, fpath.stem)

    def test_regulation_mark_g_included_in_standard(self):
        raw_charizard = {
            "id": "sv03-125",
            "localId": "125",
            "name": "Dracaufeu-ex",
            "category": "Pokémon",
            "stage": "Niveau 2",
            "hp": 330,
            "types": ["Obscurité"],
            "dexId": [6],
            "regulationMark": "G",
            "legal": {"standard": False, "expanded": True},
            "rarity": "Double rare",
            "set": {"id": "sv03", "name": "Flammes Obsidiennes"},
            "abilities": [
                {
                    "type": "Talent",
                    "name": "Règne Infernal",
                    "effect": (
                        "Lorsque vous jouez ce Pokémon de votre main pour faire évoluer l'un de vos Pokémon, "
                        "vous pouvez chercher dans votre deck jusqu'à 3 cartes Énergie {R} de base."
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
        identity, pstats = self.fetcher.build_deterministic_models("sv03-125", raw_charizard, None)
        self.assertTrue(identity.legalStandard)
        self.assertEqual(identity.regulationMark, "G")
        self.assertIsNotNone(pstats)
        self.assertTrue(pstats.isTera)
        self.assertTrue(pstats.hasAbility)
        self.assertEqual(pstats.dexId, [6])

    def test_paradox_ancient_and_future_detection_by_dex_id(self):
        # Ire-Foudre-ex (dexId 1021 -> Temps passé / Ancient)
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
        id_rb, stats_rb = self.fetcher.build_deterministic_models("sv05-123", raw_raging_bolt, None)
        self.assertTrue(id_rb.isAncient)
        self.assertFalse(id_rb.isFuture)
        self.assertTrue(stats_rb.isAncient)
        self.assertFalse(stats_rb.isFuture)

        # Vert-de-Fer-ex (dexId 1010 -> Temps futur / Future)
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
        id_il, stats_il = self.fetcher.build_deterministic_models("sv05-025", raw_iron_leaves, None)
        self.assertFalse(id_il.isAncient)
        self.assertTrue(id_il.isFuture)
        self.assertTrue(stats_il.isFuture)

    def test_ace_spec_and_technical_machine_detection(self):
        raw_prime_catcher = {
            "id": "sv05-157",
            "localId": "157",
            "name": "Attrape-Ultime",
            "category": "Dresseur",
            "trainerType": "Objet",
            "rarity": "HIGH-TECH rare",
            "regulationMark": "H",
            "set": {"id": "sv05", "name": "Forces Temporelles"},
        }
        id_pc, _ = self.fetcher.build_deterministic_models("sv05-157", raw_prime_catcher, None)
        self.assertTrue(id_pc.isAceSpec)

        raw_tm_evo = {
            "id": "sv04-178",
            "localId": "178",
            "name": "Capsule Technique : Évolution",
            "category": "Dresseur",
            "trainerType": "Outil",
            "regulationMark": "G",
            "set": {"id": "sv04", "name": "Faille Paradoxe"},
            "attacks": [{"name": "Évolution", "cost": ["Incolore"], "effect": "Cherchez vos évolutions."}],
        }
        id_tm, _ = self.fetcher.build_deterministic_models("sv04-178", raw_tm_evo, None)
        self.assertTrue(id_tm.isTechnicalMachine)
        self.assertTrue(id_tm.legalStandard)

    def test_multi_type_attack_energy_cost_and_scaling(self):
        atk_fr = {
            "name": "Tempête Éclats",
            "cost": ["Électrique", "Combat"],
            "damage": "70×",
            "effect": (
                "Vous pouvez défausser autant d'Énergies de base que vous le voulez de vos Pokémon. "
                "Cette attaque inflige 70 dégâts pour chaque carte défaussée de cette façon."
            ),
        }
        action = _build_deterministic_attack_action(atk_fr, None, CardSubCategory.BASIC)
        self.assertEqual(action.energyCost, ["Électrique", "Combat"])
        energy_preconds = [
            p for p in action.preconditions if p.type == PreconditionType.SELF_HAS_ENERGY_COST
        ]
        self.assertEqual(len(energy_preconds), 2)
        types_required = {p.targetFilter.energyType: p.minCount for p in energy_preconds}
        self.assertEqual(types_required, {"Électrique": 1, "Combat": 1})
        self.assertEqual(action.effects[0].damageScalingType, DamageScalingType.PER_ENERGY_DISCARDED)
        self.assertEqual(action.effects[0].damageScalingValue, 70)

    def test_passive_and_reactive_and_self_ko_abilities(self):
        # 1. Tortipouss - Coquille Dure (Passif réduction de dégâts)
        ab_turtwig = {
            "name": "Coquille Dure",
            "effect": "Ce Pokémon subit 20 dégâts de moins provenant des attaques.",
        }
        act_turtwig = _build_deterministic_ability_action(ab_turtwig, None, CardSubCategory.BASIC)
        self.assertIsNotNone(act_turtwig)
        self.assertEqual(act_turtwig.sourceType, ActionSourceType.ABILITY_PASSIVE)
        self.assertEqual(act_turtwig.timing, ActionTiming.PASSIVE_CONTINUOUS)
        self.assertEqual(act_turtwig.effects[0].primitive, EffectPrimitive.PASSIVE_DAMAGE_REDUCTION)
        self.assertEqual(act_turtwig.effects[0].count, 20)

        # 2. Rosélia - Point Poison (Réactif aux dégâts)
        ab_roselia = {
            "name": "Point Poison",
            "effect": (
                "Si ce Pokémon est sur le Poste Actif et qu'il subit les dégâts d'une attaque "
                "de l'un des Pokémon de votre adversaire, le Pokémon Attaquant est maintenant Empoisonné."
            ),
        }
        act_roselia = _build_deterministic_ability_action(ab_roselia, None, CardSubCategory.BASIC)
        self.assertIsNotNone(act_roselia)
        self.assertEqual(act_roselia.sourceType, ActionSourceType.ABILITY_REACTIVE)
        self.assertEqual(act_roselia.timing, ActionTiming.ON_DAMAGED_OR_KO_TRIGGER)
        self.assertEqual(act_roselia.effects[0].primitive, EffectPrimitive.APPLY_SPECIAL_CONDITION)
        self.assertEqual(act_roselia.effects[0].specialCondition, SpecialConditionType.POISONED)

        # 3. Noctunoir - Explosion Maudite (Auto-K.O. + 13 marqueurs de dégâts)
        ab_dusknoir = {
            "name": "Explosion Maudite",
            "effect": (
                "Une fois pendant votre tour, vous pouvez placer 13 marqueurs de dégâts sur l'un des Pokémon "
                "de votre adversaire. Si vous utilisez ce talent, ce Pokémon est mis K.O."
            ),
        }
        act_dusknoir = _build_deterministic_ability_action(ab_dusknoir, None, CardSubCategory.STAGE_2)
        self.assertIsNotNone(act_dusknoir)
        self.assertEqual(act_dusknoir.sourceType, ActionSourceType.ABILITY_ACTIVATED)
        self.assertEqual(act_dusknoir.costs[0].type, CostType.KNOCK_OUT_SELF)
        self.assertEqual(act_dusknoir.effects[0].primitive, EffectPrimitive.PLACE_DAMAGE_COUNTERS)
        self.assertEqual(act_dusknoir.effects[0].count, 13)

        # 4. Vert-de-Fer-ex - Vernier Rapide (Pose de la main sur le Banc)
        ab_iron_leaves = {
            "name": "Vernier Rapide",
            "effect": (
                "Lorsque vous jouez ce Pokémon de votre main sur votre Banc pendant votre tour, "
                "vous pouvez l'échanger contre votre Pokémon Actif. Dans ce cas, vous pouvez déplacer "
                "autant d'Énergies que vous le voulez de vos autres Pokémon vers ce Pokémon."
            ),
        }
        act_il = _build_deterministic_ability_action(ab_iron_leaves, None, CardSubCategory.BASIC)
        self.assertIsNotNone(act_il)
        self.assertEqual(act_il.sourceType, ActionSourceType.ABILITY_ON_PLAY_FROM_HAND)
        self.assertEqual(act_il.timing, ActionTiming.ON_PLAY_FROM_HAND_TRIGGER)
        primitives = [e.primitive for e in act_il.effects]
        self.assertIn(EffectPrimitive.SWITCH_ACTIVE_POKEMON, primitives)
        self.assertIn(EffectPrimitive.MOVE_ENERGY_BETWEEN_POKEMON, primitives)

    def test_compilation_metadata_tokens_per_second(self):
        from compiler.schemas import CompilationMetadata

        # Sans tokens (rétro-compatibilité)
        meta_basic = CompilationMetadata(
            modelRepoId="repo",
            modelFilename="file.gguf",
            compilationTimeSeconds=2.5,
            compiledAtIso="2026-10-31T12:00:00Z",
        )
        self.assertIsNone(meta_basic.tokensPerSecond)
        self.assertIsNone(meta_basic.completionTokens)

        # Avec métriques de débit
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

    def test_local_llm_compiler_streaming_token_callback(self):
        from unittest.mock import MagicMock
        from compiler.llm_engine import LocalLLMCardCompiler
        from compiler.tcgdex_fetcher import FetchedCardBundle

        fake_card_json = {
            "reasoningAnalysis": "Test local streaming.",
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
        chunks = [
            {"choices": [{"delta": {"content": json_str[:25]}}]},
            {"choices": [{"delta": {"content": json_str[25:50]}}]},
            {"choices": [{"delta": {"content": json_str[50:]}, "finish_reason": "stop"}]},
        ]

        compiler = LocalLLMCardCompiler()
        compiler._ready = True
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = iter(chunks)
        compiler._llm = mock_llm

        identity, pstats = self.fetcher.build_deterministic_models(
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

        updates: list[tuple[int, float]] = []
        model = compiler.compile_card(bundle, on_token=lambda tok, tps: updates.append((tok, tps)))
        self.assertEqual(model.cardId, "sv06.5-001")
        self.assertGreater(len(updates), 0)
        self.assertEqual(updates[-1][0], 3)
        self.assertGreater(updates[-1][1], 0.0)

    def test_local_llm_tokens_per_second_measured_from_first_token(self):
        from unittest.mock import MagicMock, patch
        from compiler.llm_engine import LocalLLMCardCompiler
        from compiler.tcgdex_fetcher import FetchedCardBundle

        fake_card_json = {
            "reasoningAnalysis": "Test local streaming tps.",
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
        chunks = [
            {"choices": [{"delta": {"content": json_str[:25]}}]},
            {"choices": [{"delta": {"content": json_str[25:50]}}]},
            {"choices": [{"delta": {"content": json_str[50:]}, "finish_reason": "stop"}]},
        ]

        compiler = LocalLLMCardCompiler()
        compiler._ready = True
        mock_llm = MagicMock()
        mock_llm.create_chat_completion.return_value = iter(chunks)
        compiler._llm = mock_llm

        identity, pstats = self.fetcher.build_deterministic_models(
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

        # t0 = 100.0, 1er token = 103.0 (TTFT = 3.0s), 2e = 104.0, 3e = 105.0 (gén = 2.0s pour 2 intervalles = 1.0 t/s), fin = 105.1
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


if __name__ == "__main__":
    unittest.main()
