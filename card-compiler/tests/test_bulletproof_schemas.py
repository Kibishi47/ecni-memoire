"""Tests unitaires exhaustifs pour valider la robustesse absolue des schémas Pydantic.

Ces tests vérifient qu'aucun type inattendu provenant d'un LLM (`None`, chaînes décimales,
chaînes avec texte ("70 HP", "20x"), listes nulles, booléens en chaîne ("true"/"false"),
champs supplémentaires inattendus ou virgules pendantes) ne provoque de `ValidationError`.
"""

import json
import unittest
from compiler.llm_engine import extract_json_payload
from compiler.schemas import (
    ActionCost,
    ActionPrecondition,
    ActionSourceType,
    ActionTiming,
    AtomicEffect,
    CardCategory,
    CardFilter,
    CardIdentity,
    CardSubCategory,
    CostType,
    EffectPrimitive,
    LLMCompiledCardPart,
    PlayableAction,
    PreconditionType,
    StrategicEvaluator,
    StrategicRole,
    SynergyRequirement,
    TurnPhaseWeights,
    ZoneType,
    build_fallback_compiled_part,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


class TestBulletproofSchemas(unittest.TestCase):
    """Test suite vérifiant la résilience des schémas face à 2000+ cartes."""

    def test_atomic_effect_up_to_none_and_strings(self):
        # 1. upTo: None -> False
        eff1 = AtomicEffect.model_validate({"primitive": "SEARCH_DECK_TO_HAND", "upTo": None})
        self.assertFalse(eff1.upTo)

        # 2. upTo: "true" -> True
        eff2 = AtomicEffect.model_validate({"primitive": "SEARCH_DECK_TO_HAND", "upTo": "true"})
        self.assertTrue(eff2.upTo)

        # 3. upTo: "false" -> False
        eff3 = AtomicEffect.model_validate({"primitive": "SEARCH_DECK_TO_HAND", "upTo": "false"})
        self.assertFalse(eff3.upTo)

        # 4. upTo: "" -> False
        eff4 = AtomicEffect.model_validate({"primitive": "SEARCH_DECK_TO_HAND", "upTo": ""})
        self.assertFalse(eff4.upTo)

    def test_atomic_effect_damage_clamping_robustness(self):
        # 1. "70+" -> 70
        eff1 = AtomicEffect.model_validate({"primitive": "DEAL_DAMAGE_ACTIVE", "baseDamage": "70+"})
        self.assertEqual(eff1.baseDamage, 70)

        # 2. "20x" -> 20
        eff2 = AtomicEffect.model_validate({"primitive": "DEAL_DAMAGE_ACTIVE", "baseDamage": "20x"})
        self.assertEqual(eff2.baseDamage, 20)

        # 3. "N/A" -> None
        eff3 = AtomicEffect.model_validate({"primitive": "DEAL_DAMAGE_ACTIVE", "baseDamage": "N/A"})
        self.assertIsNone(eff3.baseDamage)

        # 4. "" -> None
        eff4 = AtomicEffect.model_validate({"primitive": "DEAL_DAMAGE_ACTIVE", "baseDamage": ""})
        self.assertIsNone(eff4.baseDamage)

        # 5. None -> None
        eff5 = AtomicEffect.model_validate({"primitive": "DEAL_DAMAGE_ACTIVE", "baseDamage": None})
        self.assertIsNone(eff5.baseDamage)

    def test_card_filter_resilience_and_extra_fields(self):
        # Extra fields should be ignored, not fail
        data = {
            "extra_llm_hallucination": "ignored",
            "category": "pokemon",
            "subCategory": "basic",
            "maxHp": "70 PV",
            "minHp": "30",
            "isRuleBox": "false",
            "hasAbility": "true",
            "energyType": "Feu",
            "specificCardName": "Salamèche",
        }
        filt = CardFilter.model_validate(data)
        self.assertEqual(filt.category, CardCategory.POKEMON)
        self.assertEqual(filt.subCategory, CardSubCategory.BASIC)
        self.assertEqual(filt.maxHp, 70)
        self.assertEqual(filt.minHp, 30)
        self.assertFalse(filt.isRuleBox)
        self.assertTrue(filt.hasAbility)

    def test_action_precondition_resilience(self):
        # minCount: None -> 1
        pc1 = ActionPrecondition.model_validate({"type": "ZONE_HAS_MATCHING_CARD", "minCount": None})
        self.assertEqual(pc1.minCount, 1)

        # minCount: "2 cards" -> 2
        pc2 = ActionPrecondition.model_validate({"type": "ZONE_HAS_MATCHING_CARD", "minCount": "2 cards"})
        self.assertEqual(pc2.minCount, 2)

        # targetFilter as string
        pc3 = ActionPrecondition.model_validate({"type": "ZONE_HAS_MATCHING_CARD", "targetFilter": "Dracaufeu"})
        self.assertIsNotNone(pc3.targetFilter)
        self.assertEqual(pc3.targetFilter.specificCardName, "Dracaufeu")

    def test_action_cost_resilience(self):
        # count: None -> 1
        c1 = ActionCost.model_validate({"type": "DISCARD_FROM_HAND", "count": None})
        self.assertEqual(c1.count, 1)

        # count: "2 défaussées" -> 2
        c2 = ActionCost.model_validate({"type": "DISCARD_FROM_HAND", "count": "2 défaussées"})
        self.assertEqual(c2.count, 2)

    def test_playable_action_null_lists_and_bools(self):
        data = {
            "actionId": "test_action",
            "label": "Test",
            "sourceType": "TRAINER_PLAY",
            "timing": "ONCE_PER_CARD",
            "canUseTurn1GoingFirst": None,
            "canUseTurn1GoingSecond": "true",
            "energyCost": None,
            "preconditions": None,
            "costs": None,
            "effects": None,
        }
        act = PlayableAction.model_validate(data)
        self.assertIsInstance(act.energyCost, list)
        self.assertIsInstance(act.preconditions, list)
        self.assertIsInstance(act.costs, list)
        self.assertIsInstance(act.effects, list)
        self.assertTrue(act.canUseTurn1GoingSecond)

    def test_turn_phase_weights_clamping(self):
        data = {
            "turn1": None,
            "turn2": "1.8",
            "turn3": 3.5,   # Should clamp to 2.0
            "turn4Plus": -1,  # Should clamp to 0.0
        }
        w = TurnPhaseWeights.model_validate(data)
        self.assertEqual(w.turn1, 1.0)
        self.assertEqual(w.turn2, 1.8)
        self.assertEqual(w.turn3, 2.0)
        self.assertEqual(w.turn4Plus, 0.0)

    def test_synergy_requirement_resilience(self):
        data = {
            "requiredFilter": {"category": "POKEMON"},
            "minCountInDeck": None,
            "ifMissingSetValueToZero": "true",
            "bonusWeightPerCopy": None,
        }
        syn = SynergyRequirement.model_validate(data)
        self.assertEqual(syn.minCountInDeck, 1)
        self.assertTrue(syn.ifMissingSetValueToZero)
        self.assertEqual(syn.bonusWeightPerCopy, 0.0)

    def test_strategic_evaluator_null_lists(self):
        data = {
            "primaryRole": "MAIN_ATTACKER",
            "intrinsicBaseScore": None,
            "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0},
            "decklistSynergyRequirements": None,
            "inGameDeadCardConditions": None,
            "discardPriorityWhenDead": None,
            "holdForNextTurnBonus": None,
        }
        strat = StrategicEvaluator.model_validate(data)
        self.assertEqual(strat.intrinsicBaseScore, 50)
        self.assertEqual(strat.discardPriorityWhenDead, 50)
        self.assertEqual(strat.holdForNextTurnBonus, 0)
        self.assertIsInstance(strat.decklistSynergyRequirements, list)
        self.assertIsInstance(strat.inGameDeadCardConditions, list)

    def test_llm_compiled_card_part_fallbacks(self):
        data = {
            "reasoningAnalysis": None,
            "category": "POKEMON",
            "subCategory": "BASIC",
            "playableActions": None,
            "strategicEvaluator": None,
        }
        part = LLMCompiledCardPart.model_validate(data)
        self.assertTrue("Analyse déterministe" in part.reasoningAnalysis)
        self.assertIsInstance(part.playableActions, list)
        self.assertIsNotNone(part.strategicEvaluator)

    def test_extract_json_payload_trailing_comma(self):
        raw = """
        ```json
        {
          "reasoningAnalysis": "Test",
          "category": "POKEMON",
          "subCategory": "BASIC",
          "playableActions": [
            {
              "actionId": "atk_1",
              "label": "Charge",
              "sourceType": "ATTACK",
              "timing": "END_OF_TURN_ATTACK",
              "canUseTurn1GoingFirst": false,
              "canUseTurn1GoingSecond": true,
              "energyCost": ["Incolore",],
              "effects": [
                {
                  "primitive": "DEAL_DAMAGE_ACTIVE",
                  "baseDamage": 30,
                  "count": 1,
                  "upTo": false,
                },
              ],
            },
          ],
          "strategicEvaluator": {
            "primaryRole": "MAIN_ATTACKER",
            "intrinsicBaseScore": 50,
            "turnPhaseWeights": {"turn1": 1.0, "turn2": 1.0, "turn3": 1.0, "turn4Plus": 1.0,},
            "decklistSynergyRequirements": [],
            "inGameDeadCardConditions": [],
            "discardPriorityWhenDead": 50,
            "holdForNextTurnBonus": 0,
          },
        }
        ```
        """
        clean = extract_json_payload(raw)
        # Verify it can be loaded directly as valid JSON
        data = json.loads(clean)
        self.assertEqual(data["category"], "POKEMON")
        part = LLMCompiledCardPart.model_validate(data)
        self.assertEqual(len(part.playableActions), 1)

    def test_build_fallback_compiled_part(self):
        identity = CardIdentity(
            cardId="sv05-144",
            nameFr="Poffin Copain-Copain",
            nameEn="Buddy-Buddy Poffin",
            setId="sv05",
            localId="144",
            category=CardCategory.TRAINER,
            subCategory=CardSubCategory.ITEM,
        )
        bundle = FetchedCardBundle(
            card_id="sv05-144",
            resolved_tcgdex_id="sv05-144",
            identity=identity,
            pokemon_stats=None,
            raw_fr={"name": "Poffin Copain-Copain"},
            raw_en={"name": "Buddy-Buddy Poffin"},
            raw_cache_path=None,
        )
        fallback = build_fallback_compiled_part(bundle, reasoning_text="Analyse préalable")
        self.assertEqual(fallback.category, CardCategory.TRAINER)
        self.assertEqual(fallback.subCategory, CardSubCategory.ITEM)
        self.assertTrue(len(fallback.playableActions) > 0)
        self.assertEqual(fallback.reasoningAnalysis, "Analyse préalable")


if __name__ == "__main__":
    unittest.main()
