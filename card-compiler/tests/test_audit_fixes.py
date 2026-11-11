"""Tests unitaires et de non-régression pour les correctifs issus de l'audit des 3 509 cartes Standard."""

from __future__ import annotations

import inspect
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from compiler.deterministic_builder import (
    _normalize_whitespace,
    build_deterministic_skeleton,
    canonicalize_preconditions,
    filter_and_normalize_synergy_tags,
    merge_llm_payload_into_skeleton,
    normalize_and_uninvert_dead_card_condition,
)
from compiler.llm_engine import CODING_SYSTEM_PROMPT
from compiler.mlx_engine import MLXCardCompiler
from compiler.post_processor import repair_compiled_corpus
from compiler.reasoning_engine import REASONING_SYSTEM_PROMPT
from compiler.schemas import (
    AIRole,
    ActionType,
    AtomicEffect,
    CoinFlipMode,
    EffectPrimitive,
    EffectTarget,
    EngineCardModel,
    LLMCompiledPayload,
    LLMTranslatedSlot,
    ScalingMetric,
    ScalingOperator,
    SpecialCondition,
    TurnPhaseWeights,
    ZoneType,
)


def _make_raw_pokemon(
    card_id: str = "sv08-test",
    name: str = "TestMon",
    hp: int = 210,
    stage: str = "De base",
    abilities: list | None = None,
    attacks: list | None = None,
    evolve_from: str | None = None,
) -> dict:
    return {
        "fr": {
            "id": card_id,
            "name": name,
            "category": "Pokémon",
            "stage": stage,
            "hp": hp,
            "types": ["Électrique"],
            "retreat": 2,
            "evolveFrom": evolve_from,
            "abilities": abilities or [],
            "attacks": attacks or [],
            "set": {"id": card_id.split("-")[0], "name": "Test Set"},
            "legal": {"standard": True, "expanded": True},
        }
    }


def _make_raw_trainer(
    card_id: str = "sv01-test",
    name: str = "TestTrainer",
    trainer_type: str = "Objet",
    effect_fr: str | None = None,
    effect_en: str | None = None,
) -> dict:
    return {
        "fr": {
            "id": card_id,
            "name": name,
            "category": "Dresseur",
            "trainerType": trainer_type,
            "effect": effect_fr,
            "set": {"id": card_id.split("-")[0], "name": "Test Set"},
            "legal": {"standard": True, "expanded": True},
        },
        "en": {
            "id": card_id,
            "name": name,
            "category": "Trainer",
            "trainerType": "Item" if trainer_type == "Objet" else "Supporter",
            "effect": effect_en,
            "set": {"id": card_id.split("-")[0], "name": "Test Set"},
            "legal": {"standard": True, "expanded": True},
        },
    }


class TestSchemaEvolutionAndStrictness(unittest.TestCase):
    """Vérifie le schéma strict et la suppression du fallback silencieux vers DRAW_CARDS."""

    def test_unknown_primitive_raises_value_error(self) -> None:
        with self.assertRaises(ValueError):
            AtomicEffect(primitive="COMPLETELY_UNKNOWN_PRIMITIVE")  # type: ignore[arg-type]

    def test_new_primitive_aliases_map_cleanly(self) -> None:
        self.assertEqual(AtomicEffect(primitive="COIN_FLIP").primitive, EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS)
        self.assertEqual(AtomicEffect(primitive="PREVENT_DAMAGE").primitive, EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS)
        self.assertEqual(AtomicEffect(primitive="PLACE_COUNTERS").primitive, EffectPrimitive.PLACE_DAMAGE_COUNTERS)
        self.assertEqual(AtomicEffect(primitive="MILL").primitive, EffectPrimitive.MILL_DECK)
        self.assertEqual(AtomicEffect(primitive="KO").primitive, EffectPrimitive.KNOCK_OUT)
        self.assertEqual(AtomicEffect(primitive="BOOST_HP").primitive, EffectPrimitive.MODIFY_HP)
        self.assertEqual(AtomicEffect(primitive="REDUCE_DAMAGE").primitive, EffectPrimitive.MODIFY_DAMAGE_TAKEN)
        self.assertEqual(AtomicEffect(primitive="LOCK_ATTACK").primitive, EffectPrimitive.LOCK_NEXT_TURN_ATTACK)
        self.assertEqual(AtomicEffect(primitive="CANT_RETREAT").primitive, EffectPrimitive.LOCK_RETREAT)

    def test_apply_special_condition_requires_enum(self) -> None:
        with self.assertRaises(ValueError):
            AtomicEffect(primitive=EffectPrimitive.APPLY_SPECIAL_CONDITION, target=EffectTarget.OPPONENT_ACTIVE)

        eff = AtomicEffect(
            primitive=EffectPrimitive.APPLY_SPECIAL_CONDITION,
            target=EffectTarget.OPPONENT_ACTIVE,
            specialCondition="PARALYZED",  # type: ignore[arg-type]
        )
        self.assertEqual(eff.specialCondition, SpecialCondition.PARALYZED)

    def test_new_action_types_exist(self) -> None:
        self.assertIn(ActionType.USE_ABILITY, set(ActionType))
        self.assertIn(ActionType.TRIGGERED_ABILITY, set(ActionType))
        self.assertIn(ActionType.PASSIVE_ABILITY, set(ActionType))


class TestDeterministicFixes(unittest.TestCase):
    """Vérifie les correctifs sur les effets, HTML, T1, rééditions et garde-fous."""

    def test_html_normalization_strips_tags(self) -> None:
        raw_txt = 'Placez 3 Pokémon <span class="energy-symbol Dragon" title="Dragon">Dragon</span> sur votre <em>Banc</em>.'
        self.assertEqual(_normalize_whitespace(raw_txt), "Placez 3 Pokémon {Dragon} sur votre Banc.")

    def test_base_damage_merge_preserves_recoil_and_modifier(self) -> None:
        raw = _make_raw_pokemon(
            card_id="me01-073",
            name="Hariyama",
            hp=150,
            stage="Niveau 1",
            evolve_from="Makuhita",
            attacks=[
                {"name": "Pression Sauvage", "cost": ["Combat", "Incolore", "Incolore"], "damage": 210, "effect": "Ce Pokémon s'inflige aussi 70 dégâts."},
                {"name": "Bouclier Terra", "cost": ["Combat"], "damage": 200, "effect": "Pendant le prochain tour de votre adversaire, ce Pokémon subit 30 dégâts de moins provenant des attaques."},
            ],
        )
        skel = build_deterministic_skeleton(raw)
        llm_payload = LLMCompiledPayload(
            translatedSlots=[
                LLMTranslatedSlot(
                    slotId="attack_0",
                    effects=[AtomicEffect(primitive=EffectPrimitive.DAMAGE_ACTIVE, target=EffectTarget.SELF, value=70)],
                ),
                LLMTranslatedSlot(
                    slotId="attack_1",
                    effects=[AtomicEffect(primitive=EffectPrimitive.DAMAGE_ACTIVE, target=EffectTarget.SELF, value=-30)],
                ),
            ],
            aiRole=AIRole.MAIN_ATTACKER,
            turnPhaseWeights=TurnPhaseWeights(turn1=0.0, turn2=0.8, turn3=0.9, turn4Plus=0.9),
        )
        model = merge_llm_payload_into_skeleton(skel, llm_payload)

        atk0 = next(a for a in model.playableActions if a.actionId == "attack_0")
        self.assertEqual(atk0.canUseTurn1GoingSecond, True)
        self.assertEqual(len([e for e in atk0.effects if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.OPPONENT_ACTIVE and e.value == 210]), 1)
        self.assertEqual(len([e for e in atk0.effects if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.SELF and e.value == 70]), 1)

        atk1 = next(a for a in model.playableActions if a.actionId == "attack_1")
        self.assertEqual(len([e for e in atk1.effects if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.OPPONENT_ACTIVE and e.value == 200]), 1)
        self.assertTrue(any(e.primitive == EffectPrimitive.MODIFY_DAMAGE_TAKEN and e.target == EffectTarget.SELF and e.value == -30 for e in atk1.effects))

    def test_recoil_duplicate_on_opponent_active_and_paralyze_are_repaired(self) -> None:
        raw = _make_raw_pokemon(
            card_id="me02-034",
            name="Pohmarmotte",
            hp=140,
            stage="Niveau 2",
            evolve_from="Pohmotte",
            attacks=[{"name": "Poing Voltaïque", "cost": ["Électrique"], "damage": 130, "effect": "Ce Pokémon peut s'infliger aussi 60 dégâts et rendre le Pokémon Actif de votre adversaire Paralysé."}],
        )
        skel = build_deterministic_skeleton(raw)
        llm_payload = LLMCompiledPayload(
            translatedSlots=[
                LLMTranslatedSlot(
                    slotId="attack_0",
                    effects=[
                        AtomicEffect(primitive=EffectPrimitive.DAMAGE_ACTIVE, target=EffectTarget.OPPONENT_ACTIVE, value=60),
                    ],
                )
            ],
            aiRole=AIRole.MAIN_ATTACKER,
            turnPhaseWeights=TurnPhaseWeights(turn1=0.0, turn2=0.7, turn3=0.8, turn4Plus=0.8),
        )
        model = merge_llm_payload_into_skeleton(skel, llm_payload)
        atk0 = next(a for a in model.playableActions if a.actionId == "attack_0")
        opp_dmgs = [e.value for e in atk0.effects if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.OPPONENT_ACTIVE]
        self_dmgs = [e.value for e in atk0.effects if e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.SELF]
        self.assertEqual(opp_dmgs, [130])
        self.assertEqual(self_dmgs, [60])
        self.assertTrue(any(e.primitive == EffectPrimitive.APPLY_SPECIAL_CONDITION and e.specialCondition == SpecialCondition.PARALYZED for e in atk0.effects))

    def test_coin_flips_and_damage_scaling_and_bench_counters(self) -> None:
        raw = _make_raw_pokemon(
            card_id="test-coins",
            name="CoinMon-ex",
            hp=260,
            abilities=[{"type": "Talent", "name": "Danse Chance", "effect": "Une fois pendant votre tour, vous pouvez utiliser ce talent. Lancez une pièce. Si c'est face, cherchez dans votre deck un Pokémon et ajoutez-le à votre main."}],
            attacks=[
                {"name": "Requis", "cost": ["Incolore"], "damage": 30, "effect": "Lancez une pièce. Si c'est pile, cette attaque ne fait rien."},
                {"name": "ParaBonus", "cost": ["Électrique"], "damage": 80, "effect": "Lancez une pièce. Si c'est face, le Pokémon Actif de votre adversaire est maintenant Paralysé."},
                {"name": "MultiPiece", "cost": ["Électrique", "Incolore"], "damage": "60×", "effect": "Lancez 3 pièces. Cette attaque inflige 60 dégâts pour chaque côté face."},
                {"name": "JusquaPile", "cost": ["Eau"], "damage": "30×", "effect": "Lancez une pièce jusqu'à obtenir un côté pile. Cette attaque inflige 30 dégâts pour chaque côté face."},
                {"name": "DoublePile", "cost": ["Obscurité"], "damage": 90, "effect": "Lancez 2 pièces. Si vous obtenez 2 côtés pile, ce Pokémon s'inflige aussi 90 dégâts."},
                {"name": "PlongeeBanc", "cost": ["Psy", "Feu"], "damage": 200, "effect": "Placez 6 marqueurs de dégâts sur les Pokémon de Banc de votre adversaire comme il vous plaît."},
            ],
        )
        model = merge_llm_payload_into_skeleton(build_deterministic_skeleton(raw), None)
        by_id = {a.actionId: a for a in model.playableActions}

        self.assertEqual(by_id["ability_0"].actionType, ActionType.USE_ABILITY)
        self.assertEqual(by_id["ability_0"].effects[0].coinFlipMode, CoinFlipMode.SINGLE_HEADS_REQUIRED)

        self.assertEqual(by_id["attack_0"].effects[0].coinFlipMode, CoinFlipMode.SINGLE_HEADS_REQUIRED)
        self.assertEqual(by_id["attack_1"].effects[0].coinFlipMode, None)
        para = next(e for e in by_id["attack_1"].effects if e.primitive == EffectPrimitive.APPLY_SPECIAL_CONDITION)
        self.assertEqual(para.specialCondition, SpecialCondition.PARALYZED)
        self.assertEqual(para.coinFlipMode, CoinFlipMode.SINGLE_HEADS_BONUS)

        self.assertEqual(by_id["attack_2"].effects[0].coinFlipMode, CoinFlipMode.MULTI_COIN_PER_HEADS)
        self.assertEqual(by_id["attack_2"].effects[0].coinCount, 3)

        self.assertEqual(by_id["attack_3"].effects[0].coinFlipMode, CoinFlipMode.UNTIL_TAILS_PER_HEADS)

        self_recoil = next(e for e in by_id["attack_4"].effects if e.target == EffectTarget.SELF)
        self.assertEqual(self_recoil.coinFlipMode, CoinFlipMode.TWO_TAILS_SELF_DAMAGE)
        self.assertEqual(self_recoil.coinCount, 2)

        bench_cnt = next(e for e in by_id["attack_5"].effects if e.primitive == EffectPrimitive.PLACE_DAMAGE_COUNTERS)
        self.assertEqual(bench_cnt.target, EffectTarget.OPPONENT_BENCH_ALL)
        self.assertEqual(bench_cnt.count, 6)
        self.assertEqual(bench_cnt.value, 60)

    def test_special_energy_keeps_attach_and_shuffle_hand_draw_exact(self) -> None:
        raw_energy = {
            "fr": {
                "id": "sv08-191",
                "name": "Énergie Enrichissante",
                "category": "Énergie",
                "energyType": "Spécial",
                "effect": "Lorsque vous attachez cette carte de votre main à un Pokémon, piochez 4 cartes.",
                "set": {"id": "sv08", "name": "Étincelles Déferlantes"},
                "legal": {"standard": True, "expanded": True},
            }
        }
        e_model = merge_llm_payload_into_skeleton(build_deterministic_skeleton(raw_energy), None)
        self.assertEqual(e_model.playableActions[0].effects[0].primitive, EffectPrimitive.ATTACH_ENERGY)
        self.assertNotEqual(e_model.strategicEvaluator.aiRole, AIRole.MAIN_ATTACKER)

        raw_iono = _make_raw_trainer(
            card_id="sv02-185",
            name="Mashynn",
            trainer_type="Supporter",
            effect_fr="Chaque joueur mélange sa main et la place en dessous de son deck. Ensuite, chaque joueur pioche une carte pour chacune de ses cartes Récompense restantes.",
            effect_en="Each player shuffles their hand and puts it on the bottom of their deck. If either player put any cards on the bottom of their deck in this way, each player draws a card for each of their remaining Prize cards.",
        )
        m_iono = merge_llm_payload_into_skeleton(build_deterministic_skeleton(raw_iono), None)
        shuf_eff = next(e for e in m_iono.playableActions[0].effects if e.primitive == EffectPrimitive.SHUFFLE_HAND_DRAW)
        self.assertIsNone(shuf_eff.count)
        self.assertEqual(shuf_eff.scalingMetric, ScalingMetric.PER_PRIZE_REMAINING_PLAYER)

        # Recherche de deck simple ne doit JAMAIS recevoir SHUFFLE_HAND_DRAW(count=6)
        raw_search = _make_raw_trainer(
            card_id="sv04-search",
            name="Chercheur",
            effect_fr="Cherchez dans votre deck un Pokémon, montrez-le, puis ajoutez-le à votre main. Mélangez ensuite votre deck.",
        )
        m_search = merge_llm_payload_into_skeleton(
            build_deterministic_skeleton(raw_search),
            LLMCompiledPayload(
                translatedSlots=[LLMTranslatedSlot(slotId="trainer_0", effects=[AtomicEffect(primitive=EffectPrimitive.SHUFFLE_HAND_DRAW, target=EffectTarget.PLAYER, count=6)])],
                aiRole=AIRole.MAIN_ATTACKER,
                turnPhaseWeights=TurnPhaseWeights(turn1=0.9, turn2=0.9, turn3=0.8, turn4Plus=0.8),
            ),
        )
        prims = {e.primitive for e in m_search.playableActions[0].effects}
        self.assertNotIn(EffectPrimitive.SHUFFLE_HAND_DRAW, prims)
        self.assertIn(EffectPrimitive.SEARCH_DECK, prims)
        self.assertNotIn(m_search.strategicEvaluator.aiRole, {AIRole.MAIN_ATTACKER, AIRole.SECONDARY_ATTACKER})

    def test_reprint_inheritance_for_textless_hyper_ball(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            raw_dir = Path(tmpdir)
            ref = _make_raw_trainer(
                card_id="sv01-196",
                name="Hyper Ball",
                trainer_type="Objet",
                effect_fr="Vous ne pouvez utiliser cette carte que si vous défaussez 2 autres cartes de votre main. Cherchez dans votre deck un Pokémon, montrez-le, puis ajoutez-le à votre main. Mélangez ensuite votre deck.",
            )
            reprint = _make_raw_trainer(card_id="30th-128", name="Hyper Ball", trainer_type="Objet", effect_fr=None, effect_en=None)
            (raw_dir / "sv01-196.json").write_text(json.dumps(ref, ensure_ascii=False), encoding="utf-8")
            (raw_dir / "30th-128.json").write_text(json.dumps(reprint, ensure_ascii=False), encoding="utf-8")

            skel = build_deterministic_skeleton(raw_dir / "30th-128.json", raw_dir=raw_dir)
            model = merge_llm_payload_into_skeleton(skel, None)
            prims = [e.primitive for e in model.playableActions[0].effects]
            self.assertEqual(prims, [EffectPrimitive.DISCARD_CARDS, EffectPrimitive.SEARCH_DECK])
            self.assertEqual(model.playableActions[0].deadCardCondition, "HAND_FEWER_THAN_2_OTHER_CARDS")

    def test_guardrails_small_basic_weights_synergies_and_dead_card_inversion(self) -> None:
        # 1. Petit Pokémon Base 70 PV non-RuleBox ne doit JAMAIS être MAIN_ATTACKER et poids (0.9,0.9,0.8,0.8) recalibrés
        raw_basic = _make_raw_pokemon(
            card_id="sv08-small",
            name="Pikachu",
            hp=70,
            stage="De base",
            attacks=[{"name": "Éclair", "cost": ["Électrique"], "damage": 20, "effect": None}],
        )
        m_small = merge_llm_payload_into_skeleton(
            build_deterministic_skeleton(raw_basic),
            LLMCompiledPayload(
                translatedSlots=[LLMTranslatedSlot(slotId="attack_0", effects=[AtomicEffect(primitive=EffectPrimitive.DAMAGE_ACTIVE, target=EffectTarget.OPPONENT_ACTIVE, value=20)])],
                aiRole=AIRole.MAIN_ATTACKER,
                turnPhaseWeights=TurnPhaseWeights(turn1=0.9, turn2=0.9, turn3=0.8, turn4Plus=0.8),
                additionalSynergyTags=["free text tag with spaces", "requires_discard_synergy"],
            ),
            evolvable_names={"pikachu"},
        )
        self.assertNotEqual(m_small.strategicEvaluator.aiRole, AIRole.MAIN_ATTACKER)
        w = m_small.strategicEvaluator.turnPhaseWeights
        self.assertNotEqual((w.turn1, w.turn2, w.turn3, w.turn4Plus), (0.9, 0.9, 0.8, 0.8))
        self.assertIn("requires_discard_synergy", m_small.strategicEvaluator.decklistSynergyRequirements)
        self.assertNotIn("free text tag with spaces", m_small.strategicEvaluator.decklistSynergyRequirements)

        # 2. deadCardCondition inversée et idempotence de HAND_IS_EMPTY -> HAND_NOT_EMPTY
        self.assertEqual(normalize_and_uninvert_dead_card_condition("SELF_IS_ACTIVE", ["SELF_IS_ACTIVE"]), "SELF_NOT_ACTIVE")
        first = normalize_and_uninvert_dead_card_condition("HAND_IS_EMPTY", ["HAND_IS_EMPTY"])
        self.assertEqual(first, "HAND_NOT_EMPTY")
        self.assertEqual(normalize_and_uninvert_dead_card_condition(first, ["HAND_IS_EMPTY"]), "HAND_NOT_EMPTY")
        self.assertEqual(canonicalize_preconditions(["NONE", "SELF_IS_IN_THE_ACTIVE_SPOT", "BENCH_FULL"]), ["SELF_IS_ACTIVE"])

        # 3. Filtres sur faux KNOCK_OUT (même s'il est mis K.O.)
        raw_trigger = _make_raw_pokemon(
            card_id="30th-022",
            name="Froussardine",
            hp=30,
            abilities=[{"type": "Talent", "name": "Contre-Attaque Groupée", "effect": "Si l'un de vos Froussardine est sur le Poste Actif et qu'il subit les dégâts d'une attaque (même s'il est mis K.O.), placez 3 marqueurs de dégâts sur le Pokémon Attaquant."}],
        )
        m_trig = merge_llm_payload_into_skeleton(
            build_deterministic_skeleton(raw_trigger),
            LLMCompiledPayload(
                translatedSlots=[
                    LLMTranslatedSlot(
                        slotId="ability_0",
                        effects=[
                            AtomicEffect(primitive=EffectPrimitive.PLACE_DAMAGE_COUNTERS, target=EffectTarget.OPPONENT_ACTIVE, value=30, count=3),
                            AtomicEffect(primitive=EffectPrimitive.KNOCK_OUT, target=EffectTarget.OPPONENT_ACTIVE),
                        ],
                    )
                ],
                aiRole=AIRole.GUEST_TECH,
                turnPhaseWeights=TurnPhaseWeights(turn1=0.6, turn2=0.5, turn3=0.3, turn4Plus=0.2),
            ),
        )
        ab0 = m_trig.playableActions[1]
        self.assertEqual(ab0.actionType, ActionType.TRIGGERED_ABILITY)
        self.assertNotIn(EffectPrimitive.KNOCK_OUT, {e.primitive for e in ab0.effects})


class TestPromptsAndCorpusRepair(unittest.TestCase):
    """Vérifie la dé-biaisation des prompts, MLX max_tokens=2048 et repair_compiled_corpus."""

    def test_prompts_have_no_bias_and_mlx_max_tokens_2048(self) -> None:
        self.assertNotIn("0.9", CODING_SYSTEM_PROMPT)
        self.assertIn("SEARCH_DECK", CODING_SYSTEM_PROMPT)
        self.assertIn("TRIGGERED_ABILITY", REASONING_SYSTEM_PROMPT)
        self.assertIn("PLACE_DAMAGE_COUNTERS", REASONING_SYSTEM_PROMPT)
        sig = inspect.signature(MLXCardCompiler.__init__)
        self.assertEqual(sig.parameters["max_tokens"].default, 2048)

    def test_repair_compiled_corpus_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            data_dir = Path(tmpdir)
            raw_dir = data_dir / "raw_tcgdex"
            comp_dir = data_dir / "compiled_cards"
            raw_dir.mkdir()
            comp_dir.mkdir()

            raw_doc = _make_raw_pokemon(
                card_id="sv01-199",
                name="TestMon-ex",
                hp=220,
                attacks=[{"name": "Coup Dur", "cost": ["Électrique"], "damage": 180, "effect": "Ce Pokémon s'inflige aussi 30 dégâts."}],
            )
            (raw_dir / "sv01-199.json").write_text(json.dumps(raw_doc, ensure_ascii=False), encoding="utf-8")

            legacy_card = {
                "cardId": "sv01-199",
                "identity": {
                    "cardId": "sv01-199",
                    "nameFr": "TestMon-ex",
                    "nameEn": "TestMon-ex",
                    "setId": "sv01",
                    "setName": "Test Set",
                    "category": "POKEMON",
                    "subCategory": "BASIC",
                    "isRuleBox": True,
                    "prizeCardsGiven": 2,
                    "legalStandard": True,
                    "legalExpanded": True,
                    "rawRulesText": [],
                },
                "category": "POKEMON",
                "subCategory": "BASIC",
                "playableActions": [
                    {
                        "actionId": "attack_0",
                        "label": "Coup Dur",
                        "actionType": "ATTACK",
                        "timingPhase": "ATTACK_PHASE",
                        "preconditions": ["SELF_IS_ACTIVE"],
                        "effects": [
                            {"primitive": "DAMAGE_ACTIVE", "target": "SELF", "value": 30},
                            {"primitive": "UNKNOWN_LEGACY_PRIM", "target": "PLAYER"},
                        ],
                        "deadCardCondition": "SELF_IS_ACTIVE",
                    }
                ],
                "strategicEvaluator": {
                    "aiRole": "MAIN_ATTACKER",
                    "turnPhaseWeights": {"turn1": 0.9, "turn2": 0.9, "turn3": 0.8, "turn4Plus": 0.8},
                    "decklistSynergyRequirements": ["bad free text tag"],
                },
                "compilationMetadata": {
                    "modelRepoId": "Qwen/Qwen3-14B-GGUF",
                    "modelFilename": "Qwen3-14B-Q4_K_M.gguf",
                },
            }
            (comp_dir / "sv01-199.json").write_text(json.dumps(legacy_card, ensure_ascii=False), encoding="utf-8")

            summary = repair_compiled_corpus(data_dir)
            self.assertEqual(summary["total_processed"], 1)
            self.assertEqual(summary["repaired_count"], 1)
            self.assertEqual(summary["errors"], [])
            self.assertIn("sv01-199", summary["legacy_recompile_ids"])

            repaired = EngineCardModel.model_validate_json((comp_dir / "sv01-199.json").read_text(encoding="utf-8"))
            atk0 = next(a for a in repaired.playableActions if a.actionId == "attack_0")
            self.assertEqual(atk0.deadCardCondition, "SELF_NOT_ACTIVE")
            self.assertTrue(any(e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.OPPONENT_ACTIVE and e.value == 180 for e in atk0.effects))
            self.assertTrue(any(e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.target == EffectTarget.SELF and e.value == 30 for e in atk0.effects))
            self.assertFalse(any(e.primitive == EffectPrimitive.DRAW_CARDS for e in atk0.effects))
            self.assertIn("sv01-199", (data_dir / "cards_to_recompile_llm.txt").read_text(encoding="utf-8"))
            db = json.loads((data_dir / "cards_database.json").read_text(encoding="utf-8"))
            self.assertIsInstance(db, list)
            self.assertEqual(len(db), 1)


if __name__ == "__main__":
    unittest.main()
