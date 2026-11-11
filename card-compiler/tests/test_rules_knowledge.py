"""Tests unitaires pour le référentiel de règles officielles (`compiler/rules_knowledge.py`)
et les corrections déterministes alignées sur le livret Pokémon TCG.
"""

from __future__ import annotations

import json
import unittest
from pathlib import Path

from compiler.deterministic_builder import (
    build_deterministic_skeleton,
    detect_rule_box_and_prizes,
    merge_llm_payload_into_skeleton,
    normalize_and_uninvert_dead_card_condition,
)
from compiler.llm_engine import CODING_SYSTEM_PROMPT
from compiler.reasoning_engine import REASONING_SYSTEM_PROMPT, build_reasoning_prompt
from compiler.rules_knowledge import (
    CORE_RULES_SYSTEM_BLOCK,
    select_relevant_rule_snippets,
)
from compiler.schemas import (
    ActionType,
    AtomicEffect,
    CardCategory,
    CardSubCategory,
    EffectPrimitive,
    EffectTarget,
    LLMCompiledPayload,
    LLMTranslatedSlot,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


class TestRulesKnowledgePrompts(unittest.TestCase):
    """Vérifie le socle de règles fixes et l'injection contextuelle dynamique en Passe 1."""

    def test_reasoning_and_coding_prompts_include_rules_without_bias(self) -> None:
        self.assertIn(CORE_RULES_SYSTEM_BLOCK, REASONING_SYSTEM_PROMPT)
        self.assertIn("PLACE_DAMAGE_COUNTERS", REASONING_SYSTEM_PROMPT)
        self.assertIn("STADIUM_ALREADY_IN_PLAY_SAME_NAME", REASONING_SYSTEM_PROMPT)
        self.assertIn("jusqu'à X", REASONING_SYSTEM_PROMPT)

        # Garde-fou anti-biais conservé sur CODING_SYSTEM_PROMPT
        self.assertNotIn("0.9", CODING_SYSTEM_PROMPT)
        self.assertIn("STADIUM_ALREADY_IN_PLAY_SAME_NAME", CODING_SYSTEM_PROMPT)
        self.assertIn("OPPONENT_PRIZES_EXACT_COUNT", CODING_SYSTEM_PROMPT)

    def test_dynamic_rule_snippets_are_strictly_contextual(self) -> None:
        raw_stadium = {
            "id": "me01-117",
            "localId": "117",
            "name": "Forêt de Vitalité",
            "category": "Dresseur",
            "trainerType": "Stade",
            "regulationMark": "I",
            "effect": "Les Pokémon Plante de chaque joueur peuvent évoluer pendant le tour où ils entrent en jeu.",
            "set": {"id": "me01", "name": "Évolution"},
        }
        skel_stadium = build_deterministic_skeleton(raw_stadium)
        codes_stadium = {code.split(" ")[0] for code, _ in select_relevant_rule_snippets(skel_stadium)}
        self.assertIn("STADIUM", codes_stadium)
        self.assertNotIn("LOST_ZONE", codes_stadium)
        self.assertNotIn("VSTAR_POWER", codes_stadium)
        self.assertNotIn("FOSSIL", codes_stadium)

        bundle_stadium = FetchedCardBundle(
            card_id="me01-117",
            resolved_tcgdex_id="me01-117",
            raw_fr=raw_stadium,
            raw_en=None,
            identity=skel_stadium.identity,
            pokemon_stats=skel_stadium.pokemonStats,
            raw_cache_path=Path("/tmp/fake_cache.json"),
        )
        prompt_stadium = build_reasoning_prompt(bundle_stadium, skeleton=skel_stadium)
        self.assertIn("RÈGLES OFFICIELLES APPLICABLES À CETTE CARTE", prompt_stadium)
        self.assertIn("STADIUM_ALREADY_IN_PLAY_SAME_NAME", prompt_stadium)

        # Un Pokémon de base sans texte spécial n'injecte pas de micro-règles parasites
        raw_plain_basic = {
            "id": "sv01-001",
            "localId": "001",
            "name": "Poussacha",
            "category": "Pokémon",
            "stage": "De base",
            "hp": 60,
            "types": ["Plante"],
            "retreat": 1,
            "attacks": [{"name": "Griffe", "cost": ["Plante"], "damage": 20}],
            "set": {"id": "sv01", "name": "Écarlate et Violet"},
        }
        skel_plain = build_deterministic_skeleton(raw_plain_basic)
        self.assertEqual(select_relevant_rule_snippets(skel_plain), [])

        # Une attaque utilitaire ciblant le Banc sans dégâts ne doit pas déclencher DAMAGE_VS_COUNTERS
        raw_tm_turbo = {
            "id": "sv04-179",
            "localId": "179",
            "name": "Capsule Technique : Énergisant Spontané",
            "category": "Dresseur",
            "trainerType": "Outil",
            "effect": (
                "Le Pokémon auquel cette carte est attachée peut utiliser l'attaque sur cette carte. "
                "Si cette carte est attachée à l'un de vos Pokémon, défaussez-la à la fin de votre tour."
            ),
            "attacks": [
                {
                    "cost": ["Incolore"],
                    "name": "Énergisant Spontané",
                    "effect": (
                        "Cherchez dans votre deck jusqu'à 2 cartes Énergie de base, puis attachez-les à vos "
                        "Pokémon de Banc comme il vous plaît. Mélangez ensuite votre deck."
                    ),
                }
            ],
            "set": {"id": "sv04", "name": "Faille Paradoxe"},
        }
        skel_tm = build_deterministic_skeleton(raw_tm_turbo)
        codes_tm = {code.split(" ")[0] for code, _ in select_relevant_rule_snippets(skel_tm)}
        self.assertIn("TOOL_AND_TM", codes_tm)
        self.assertIn("QUANTIFIER_UP_TO_ANY", codes_tm)
        self.assertNotIn("DAMAGE_VS_COUNTERS", codes_tm)


class TestOfficialRulesDeterministicFixes(unittest.TestCase):
    """Vérifie les corrections déterministes sur CT, Fossiles, Stades et Méga-Évolutions."""

    def test_technical_machine_exposes_tool_attachment_and_real_attack(self) -> None:
        raw_tm_crisis = {
            "id": "sv04.5-090",
            "localId": "090",
            "name": "Capsule Technique : Poing de Crise",
            "category": "Dresseur",
            "trainerType": "Outil",
            "regulationMark": "G",
            "effect": (
                "Le Pokémon auquel cette carte est attachée peut utiliser l'attaque sur cette carte. "
                "(Vous avez toujours besoin des Énergies nécessaires pour utiliser cette attaque.) "
                "Si cette carte est attachée à l'un de vos Pokémon, défaussez-la à la fin de votre tour."
            ),
            "attacks": [
                {
                    "cost": ["Incolore", "Incolore", "Incolore"],
                    "name": "Poing de Crise",
                    "damage": 280,
                    "effect": "Vous ne pouvez utiliser cette attaque que s'il reste exactement une carte Récompense à votre adversaire.",
                }
            ],
            "set": {"id": "sv04.5", "name": "Destinées de Paldea"},
        }
        skel = build_deterministic_skeleton(raw_tm_crisis)
        self.assertEqual(skel.category, CardCategory.TRAINER)
        self.assertEqual(skel.subCategory, CardSubCategory.TOOL)
        self.assertTrue(skel.identity.isTechnicalMachine)
        self.assertEqual([s.slotId for s in skel.slots_for_llm], ["attack_0"])

        merged = merge_llm_payload_into_skeleton(skel)
        by_id = {a.actionId: a for a in merged.playableActions}

        attach_act = by_id["trainer_0"]
        self.assertEqual(attach_act.actionType, ActionType.PLAY_FROM_HAND)
        self.assertEqual(attach_act.effects, [])
        self.assertEqual(attach_act.deadCardCondition, "NO_POKEMON_WITHOUT_TOOL")
        self.assertTrue(attach_act.canUseTurn1GoingFirst)

        atk_act = by_id["attack_0"]
        self.assertEqual(atk_act.actionType, ActionType.ATTACK)
        self.assertEqual(atk_act.cost, {"Incolore": 3})
        self.assertFalse(atk_act.canUseTurn1GoingFirst)
        self.assertTrue(atk_act.canUseTurn1GoingSecond)
        self.assertIn("SELF_IS_ACTIVE", atk_act.preconditions)
        self.assertIn("OPPONENT_PRIZES_EXACT_COUNT", atk_act.preconditions)
        self.assertEqual(atk_act.deadCardCondition, "OPPONENT_PRIZES_NOT_1")
        self.assertTrue(any(e.primitive == EffectPrimitive.DAMAGE_ACTIVE and e.value == 280 for e in atk_act.effects))

    def test_fossil_trainer_keeps_bench_rules_self_lock_and_ability(self) -> None:
        raw_fossil = {
            "id": "sv07-129",
            "localId": "129",
            "name": "Fossile Plaque Ancien",
            "category": "Dresseur",
            "trainerType": "Objet",
            "hp": 60,
            "regulationMark": "H",
            "effect": (
                "Jouez cette carte comme si c'était un Pokémon {C} de base avec 60 PV. "
                "Cette carte ne peut être affectée par aucun État Spécial et ne peut pas battre en retraite. "
                "À tout moment pendant votre tour, vous pouvez défausser cette carte du jeu."
            ),
            "abilities": [
                {
                    "type": "Talent",
                    "name": "Plaque Protectrice",
                    "effect": (
                        "Évitez tous les effets infligés à ce Pokémon provenant des attaques utilisées "
                        "par les Pokémon de votre adversaire. (Les dégâts ne sont pas un effet.)"
                    ),
                }
            ],
            "set": {"id": "sv07", "name": "Couronne Stellaire"},
        }
        skel = build_deterministic_skeleton(raw_fossil)
        self.assertEqual(skel.category, CardCategory.TRAINER)
        self.assertEqual(skel.subCategory, CardSubCategory.ITEM)
        self.assertEqual([s.slotId for s in skel.slots_for_llm], ["trainer_0", "ability_0"])

        merged = merge_llm_payload_into_skeleton(skel)
        by_id = {a.actionId: a for a in merged.playableActions}

        play_act = by_id["trainer_0"]
        self.assertIn("BENCH_HAS_EMPTY_SLOT", play_act.preconditions)
        self.assertEqual(play_act.deadCardCondition, "BENCH_FULL")
        lock_retreats = [e for e in play_act.effects if e.primitive == EffectPrimitive.LOCK_RETREAT]
        self.assertTrue(all(e.target == EffectTarget.SELF for e in lock_retreats))

        ab_act = by_id["ability_0"]
        self.assertEqual(ab_act.actionType, ActionType.PASSIVE_ABILITY)
        self.assertEqual(ab_act.label, "Plaque Protectrice")
        self.assertTrue(any(e.primitive == EffectPrimitive.PREVENT_DAMAGE_OR_EFFECTS for e in ab_act.effects))

    def test_stadium_enforces_same_name_dead_card_and_pipe_idempotence(self) -> None:
        raw_stadium = {
            "id": "sv08-171",
            "localId": "171",
            "name": "Zone de Liaison",
            "category": "Dresseur",
            "trainerType": "Stade",
            "regulationMark": "H",
            "effect": "Le coût de Retraite des Pokémon en jeu possédant au moins 2 Énergies attachées est diminué de 2.",
            "set": {"id": "sv08", "name": "Étincelles Déferlantes"},
        }
        skel = build_deterministic_skeleton(raw_stadium)
        self.assertEqual(skel.playableActions[0].deadCardCondition, "STADIUM_ALREADY_IN_PLAY_SAME_NAME")

        # Si le LLM renvoie une condition valide complémentaire, les deux sont conservées sans doublon
        payload = LLMCompiledPayload(
            translatedSlots=[
                LLMTranslatedSlot(
                    slotId="trainer_0",
                    preconditions=[],
                    effects=[AtomicEffect(primitive=EffectPrimitive.MODIFY_RETREAT_COST, target=EffectTarget.ALL_POKEMON_IN_PLAY, value=-2)],
                    deadCardCondition="NO_VALID_TARGET_IN_DECK",
                )
            ],
            aiRole="GUEST_TECH",
        )
        merged = merge_llm_payload_into_skeleton(skel, llm_payload=payload)
        dead_cond = merged.playableActions[0].deadCardCondition
        self.assertEqual(dead_cond, "NO_VALID_TARGET_IN_DECK|STADIUM_ALREADY_IN_PLAY_SAME_NAME")
        # Idempotence de normalize_and_uninvert_dead_card_condition sur chaîne composite
        self.assertEqual(normalize_and_uninvert_dead_card_condition(dead_cond, []), dead_cond)

    def test_mega_evolution_prize_cards_distinguishes_sv_ex_vs_xy_EX(self) -> None:
        self.assertEqual(
            detect_rule_box_and_prizes("Méga-Kangourex-ex", "Mega Kangaskhan ex", {"suffix": "ex"}),
            (True, 3),
        )
        self.assertEqual(
            detect_rule_box_and_prizes("M-Florizarre-EX", "Mega Venusaur-EX", {"suffix": "EX"}),
            (True, 2),
        )

    def test_real_corpus_tm_and_fossil_files_if_present(self) -> None:
        raw_dir = Path(__file__).resolve().parent.parent / "data" / "raw_tcgdex"
        for cid in ("me03-070", "sv04-179", "sv07-129"):
            fpath = raw_dir / f"{cid}.json"
            if not fpath.exists():
                continue
            raw_obj = json.loads(fpath.read_text(encoding="utf-8"))
            skel = build_deterministic_skeleton(raw_obj)
            merged = merge_llm_payload_into_skeleton(skel)
            if cid in {"me03-070", "sv04-179"}:
                self.assertTrue(any(a.actionType == ActionType.ATTACK for a in merged.playableActions))
            if cid == "sv07-129":
                self.assertTrue(any(a.actionId == "ability_0" for a in merged.playableActions))


if __name__ == "__main__":
    unittest.main()
