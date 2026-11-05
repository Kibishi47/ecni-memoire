"""Tests unitaires exhaustifs pour valider la robustesse absolue des schémas Pydantic V2.

Ces tests vérifient qu'aucun type inattendu provenant d'un LLM (`None`, chaînes décimales,
chaînes avec texte ("70 HP", "20x"), listes nulles, booléens en chaîne ("true"/"false"),
champs supplémentaires inattendus ou virgules pendantes) ne provoque de `ValidationError`.
"""

import json
import unittest

from compiler.deterministic_builder import (
    build_deterministic_skeleton,
    build_fallback_llm_payload,
)
from compiler.llm_engine import extract_json_payload
from compiler.schemas import (
    ActionType,
    AIRole,
    AtomicEffect,
    CardCategory,
    CardIdentity,
    CardSubCategory,
    EffectPrimitive,
    LLMCompiledPayload,
    LLMTranslatedSlot,
    PlayableAction,
    StrategicEvaluator,
    TimingPhase,
    TurnPhaseWeights,
    TypeModifier,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


class TestBulletproofSchemas(unittest.TestCase):
    """Test suite vérifiant la résilience des schémas face à 2000+ cartes."""

    def test_atomic_effect_up_to_and_optional_booleans(self):
        eff1 = AtomicEffect.model_validate({"primitive": "SEARCH_DECK_TO_HAND", "upTo": None, "optional": None})
        self.assertEqual(eff1.primitive, EffectPrimitive.SEARCH_DECK)
        self.assertFalse(eff1.upTo)
        self.assertFalse(eff1.optional)

        eff2 = AtomicEffect.model_validate({"primitive": "SEARCH_DECK", "upTo": "true", "optional": "1"})
        self.assertTrue(eff2.upTo)
        self.assertTrue(eff2.optional)

        eff3 = AtomicEffect.model_validate({"primitive": "SEARCH_DECK", "upTo": "false", "optional": ""})
        self.assertFalse(eff3.upTo)
        self.assertFalse(eff3.optional)

    def test_atomic_effect_damage_and_count_coercion(self):
        eff1 = AtomicEffect.model_validate({"primitive": "DEAL_DAMAGE_ACTIVE", "baseDamage": "70+"})
        self.assertEqual(eff1.primitive, EffectPrimitive.DAMAGE_ACTIVE)
        self.assertEqual(eff1.value, 70)

        eff2 = AtomicEffect.model_validate({"primitive": "DAMAGE_ACTIVE", "value": "20x"})
        self.assertEqual(eff2.value, 20)

        eff3 = AtomicEffect.model_validate({"primitive": "DAMAGE_ACTIVE", "value": "N/A"})
        self.assertIsNone(eff3.value)

        eff4 = AtomicEffect.model_validate({"primitive": "DRAW_CARDS", "count": "2 cartes"})
        self.assertEqual(eff4.count, 2)

    def test_playable_action_null_lists_and_bools(self):
        data = {
            "actionId": "trainer_0",
            "label": "Test",
            "sourceType": "TRAINER_PLAY",
            "timing": "ONCE_PER_CARD",
            "canUseTurn1GoingFirst": None,
            "canUseTurn1GoingSecond": "true",
            "cost": ["Incolore", "Incolore"],
            "preconditions": [{"type": "SELF_IS_ACTIVE"}],
            "effects": None,
        }
        act = PlayableAction.model_validate(data)
        self.assertEqual(act.actionType, ActionType.PLAY_FROM_HAND)
        self.assertEqual(act.timingPhase, TimingPhase.MAIN_PHASE_1)
        self.assertEqual(act.cost, {"Incolore": 2})
        self.assertEqual(act.preconditions, ["SELF_IS_ACTIVE"])
        self.assertEqual(act.effects, [])
        self.assertTrue(act.canUseTurn1GoingSecond)

    def test_turn_phase_weights_clamping_zero_to_one(self):
        data = {
            "turn1": None,
            "turn2": "0.8",
            "turn3": 3.5,   # Clamped strictly to 1.0
            "turn4Plus": -1,  # Clamped strictly to 0.0
        }
        w = TurnPhaseWeights.model_validate(data)
        self.assertEqual(w.turn1, 0.8)
        self.assertEqual(w.turn2, 0.8)
        self.assertEqual(w.turn3, 1.0)
        self.assertEqual(w.turn4Plus, 0.0)

    def test_strategic_evaluator_normalization(self):
        data = {
            "primaryRole": "BENCH_DEPLOYER",
            "turnPhaseWeights": {"turn1": 1.0, "turn2": 0.9, "turn3": 0.5, "turn4Plus": 0.2},
            "decklistSynergyRequirements": [{"requiredFilter": {"specificCardName": "Salameche"}}, "requires_basic_hp_lte_70"],
        }
        strat = StrategicEvaluator.model_validate(data)
        self.assertEqual(strat.aiRole, AIRole.CONSISTENCY_BOOSTER)
        self.assertIn("requires_evolution_line:Salameche", strat.decklistSynergyRequirements)
        self.assertIn("requires_basic_hp_lte_70", strat.decklistSynergyRequirements)

    def test_llm_compiled_payload_resilience(self):
        data = {
            "translatedSlots": [
                {
                    "slotId": "ability_0",
                    "preconditions": ["SELF_IS_ACTIVE"],
                    "effects": [{"primitive": "DRAW_CARDS", "count": 2}],
                    "deadCardCondition": "NONE",
                }
            ],
            "aiRole": "DRAW_SUPPORT",
            "turnPhaseWeights": {"turn1": 0.9, "turn2": 0.9, "turn3": 0.8, "turn4Plus": 0.8},
            "additionalSynergyTags": None,
        }
        payload = LLMCompiledPayload.model_validate(data)
        self.assertEqual(len(payload.translatedSlots), 1)
        self.assertEqual(payload.translatedSlots[0].slotId, "ability_0")
        self.assertIsNone(payload.translatedSlots[0].deadCardCondition)
        self.assertEqual(payload.aiRole, AIRole.DRAW_ENGINE)
        self.assertEqual(payload.additionalSynergyTags, [])

    def test_extract_json_payload_trailing_comma(self):
        raw = """
        ```json
        {
          "translatedSlots": [
            {
              "slotId": "attack_0",
              "preconditions": [],
              "effects": [
                {
                  "primitive": "DAMAGE_ACTIVE",
                  "value": 30,
                  "upTo": false,
                },
              ],
            },
          ],
          "aiRole": "MAIN_ATTACKER",
          "turnPhaseWeights": {"turn1": 0.9, "turn2": 0.9, "turn3": 0.8, "turn4Plus": 0.8,},
          "additionalSynergyTags": [],
        }
        ```
        """
        clean = extract_json_payload(raw)
        data = json.loads(clean)
        payload = LLMCompiledPayload.model_validate(data)
        self.assertEqual(len(payload.translatedSlots), 1)
        self.assertEqual(payload.aiRole, AIRole.MAIN_ATTACKER)

    def test_build_fallback_llm_payload(self):
        identity = CardIdentity(
            cardId="sv05-144",
            nameFr="Poffin Copain-Copain",
            nameEn="Buddy-Buddy Poffin",
            setId="sv05",
            setName="Forces Temporelles",
            category=CardCategory.TRAINER,
            subCategory=CardSubCategory.ITEM,
        )
        bundle = FetchedCardBundle(
            card_id="sv05-144",
            resolved_tcgdex_id="sv05-144",
            identity=identity,
            pokemon_stats=None,
            raw_fr={
                "id": "sv05-144",
                "name": "Poffin Copain-Copain",
                "category": "Dresseur",
                "trainerType": "Objet",
                "effect": "Cherchez dans votre deck jusqu'à 2 Pokémon de base ayant 70 PV ou moins et placez-les sur votre Banc.",
            },
            raw_en={"name": "Buddy-Buddy Poffin"},
            raw_cache_path=None,
        )
        skeleton = build_deterministic_skeleton(bundle)
        fallback = build_fallback_llm_payload(skeleton)
        self.assertEqual(fallback.aiRole, AIRole.CONSISTENCY_BOOSTER)
        self.assertEqual(len(fallback.translatedSlots), 1)
        self.assertEqual(fallback.translatedSlots[0].slotId, "trainer_0")
        self.assertEqual(fallback.translatedSlots[0].effects[0].primitive, EffectPrimitive.SEARCH_DECK)
        self.assertEqual(fallback.translatedSlots[0].effects[0].count, 2)
        self.assertTrue(fallback.translatedSlots[0].effects[0].upTo)


if __name__ == "__main__":
    unittest.main()
