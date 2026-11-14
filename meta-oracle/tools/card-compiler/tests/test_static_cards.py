"""Tests unitaires pour le module compiler/static_cards.py."""

from __future__ import annotations

import time
import unittest
from pathlib import Path

from compiler.schemas import (
    ActionType,
    AIRole,
    CardCategory,
    CardSubCategory,
    EngineCardModel,
)
from compiler.static_cards import (
    CANONICAL_ENERGY_TYPES,
    build_basic_energy_model,
    extract_energy_type,
    is_basic_energy,
)


class TestStaticCards(unittest.TestCase):
    def test_all_eight_basic_energies_detected_fr(self):
        sample_names = [
            ("Énergie Plante", "Plante"),
            ("Énergie Feu", "Feu"),
            ("Énergie Eau", "Eau"),
            ("Énergie Électrique", "Électrique"),
            ("Énergie Electrik", "Électrique"),
            ("Énergie Psy", "Psy"),
            ("Énergie Combat", "Combat"),
            ("Énergie Obscurité", "Obscurité"),
            ("Énergie Métal", "Métal"),
        ]
        for name, expected_type in sample_names:
            raw = {
                "id": "sve-test",
                "category": "Énergie",
                "name": name,
                "energyType": "De base",
                "effect": None,
            }
            self.assertTrue(is_basic_energy(raw), f"Failed to detect {name}")
            self.assertEqual(extract_energy_type(raw), expected_type)

    def test_all_eight_basic_energies_detected_en(self):
        sample_names = [
            ("Grass Energy", "Plante"),
            ("Fire Energy", "Feu"),
            ("Water Energy", "Eau"),
            ("Lightning Energy", "Électrique"),
            ("Psychic Energy", "Psy"),
            ("Fighting Energy", "Combat"),
            ("Darkness Energy", "Obscurité"),
            ("Metal Energy", "Métal"),
            ("Basic Fire Energy", "Feu"),
        ]
        for name, expected_type in sample_names:
            raw = {
                "id": "sve-test",
                "category": "Energy",
                "name": name,
                "energyType": "Normal",
                "effect": None,
            }
            self.assertTrue(is_basic_energy(raw), f"Failed to detect {name}")
            self.assertEqual(extract_energy_type(raw), expected_type)

    def test_special_energies_rejected(self):
        special_cards = [
            {
                "id": "sv04-180",
                "category": "Énergie",
                "name": "Énergie Double Turbo",
                "energyType": "Spéciale",
                "effect": "Cette carte fournit 2 Énergies Incolores mais réduit les dégâts de 20.",
            },
            {
                "id": "sv05-180",
                "category": "Energy",
                "name": "Mist Energy",
                "energyType": "Special",
                "effect": "Prevent all effects of attacks from your opponent's Pokémon.",
            },
            {
                "id": "sv02-180",
                "category": "Énergie",
                "name": "Énergie Propulsion",
                "energyType": "Spéciale",
                "effect": "Quand vous attachez cette carte depuis votre main...",
            },
            {
                "id": "sv06-180",
                "category": "Energy",
                "name": "Legacy Energy",
                "energyType": "Special",
                "effect": "ACE SPEC rule...",
            },
        ]
        for raw in special_cards:
            self.assertFalse(
                is_basic_energy(raw),
                f"Special Energy '{raw['name']}' should NOT be treated as basic!",
            )

    def test_trainers_and_pokemon_rejected(self):
        non_energy_cards = [
            {
                "id": "sv04-125",
                "category": "Trainer",
                "trainerType": "Item",
                "name": "Super Bonbon",
            },
            {
                "id": "sv03-125",
                "category": "Pokemon",
                "name": "Dracaufeu ex",
                "hp": 330,
            },
            {
                "id": "sv01-166",
                "category": "Dresseur",
                "trainerType": "Supporter",
                "name": "Pepper",
            },
        ]
        for raw in non_energy_cards:
            self.assertFalse(is_basic_energy(raw))

    def test_deterministic_generator_performance_and_schema(self):
        raw = {
            "requestedId": "sve-002",
            "fr": {
                "id": "sve-002",
                "name": "Énergie Feu",
                "category": "Énergie",
                "energyType": "De base",
                "localId": "002",
                "set": {"id": "sve", "name": "Écarlate et Violet Énergies"},
            },
            "en": {
                "id": "sve-002",
                "name": "Fire Energy",
                "category": "Energy",
                "energyType": "Normal",
            },
        }

        # Mesure de performance (< 5ms)
        t0 = time.perf_counter()
        model = build_basic_energy_model(raw)
        elapsed_ms = (time.perf_counter() - t0) * 1000

        self.assertLess(elapsed_ms, 5.0, f"Generation took {elapsed_ms:.2f}ms (> 5ms)")
        self.assertIsInstance(model, EngineCardModel)
        self.assertEqual(model.category, CardCategory.ENERGY)
        self.assertEqual(model.subCategory, CardSubCategory.BASIC_ENERGY)
        self.assertIsNone(model.pokemonStats)
        self.assertEqual(len(model.playableActions), 1)
        self.assertEqual(model.playableActions[0].actionType, ActionType.ATTACH_ENERGY)

        evaluator = model.strategicEvaluator
        self.assertEqual(evaluator.aiRole, AIRole.ENERGY_ACCELERATOR)
        self.assertEqual(evaluator.decklistSynergyRequirements, [])
        self.assertEqual(evaluator.turnPhaseWeights.turn1, 1.0)
        self.assertEqual(evaluator.turnPhaseWeights.turn2, 1.0)
        self.assertEqual(evaluator.turnPhaseWeights.turn3, 1.0)
        self.assertEqual(evaluator.turnPhaseWeights.turn4Plus, 1.0)

        metadata = model.compilationMetadata
        self.assertIsNotNone(metadata)
        self.assertEqual(metadata.modelRepoId, "STATIC_DETERMINISTIC")
        self.assertEqual(metadata.modelFilename, "builtin_engine_rule")
        self.assertEqual(metadata.compilationTimeSeconds, 0.001)


if __name__ == "__main__":
    unittest.main()
