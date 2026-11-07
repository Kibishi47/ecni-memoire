"""Post-processeur déterministe et verrous d'invariants Pokémon TCG (`compiler/post_processor.py`).

Ce module s'appuie sur `compiler/deterministic_builder.py` pour :
1. Garantir que `identity`, `pokemonStats` et les squelettes des `playableActions`
   respectent 100 % des valeurs déterministes extraites de TCGdex.
2. Appliquer les verrous déterministes finaux (`canUseTurn1GoingFirst`, `canUseTurn1GoingSecond`,
   dégâts de base `DAMAGE_ACTIVE`, bornage de `turnPhaseWeights` entre `0.0` et `1.0`).
"""

from __future__ import annotations

from typing import List

from compiler.deterministic_builder import (
    build_deterministic_skeleton,
    merge_llm_payload_into_skeleton,
)
from compiler.schemas import (
    EngineCardModel,
    LLMCompiledPayload,
    LLMTranslatedSlot,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


def sanitize_and_enrich_card(
    bundle: FetchedCardBundle,
    card: EngineCardModel,
) -> EngineCardModel:
    """Valide et verrouille déterministiquement un `EngineCardModel` à partir de son `FetchedCardBundle`."""
    skeleton = build_deterministic_skeleton(bundle)

    # Extraction des slots déjà présents dans card.playableActions
    slot_ids = {s.slotId for s in skeleton.slots_for_llm}
    translated_slots: List[LLMTranslatedSlot] = []
    for action in card.playableActions:
        if action.actionId in slot_ids:
            translated_slots.append(
                LLMTranslatedSlot(
                    slotId=action.actionId,
                    preconditions=list(action.preconditions),
                    effects=list(action.effects),
                    deadCardCondition=action.deadCardCondition,
                )
            )

    payload = LLMCompiledPayload(
        translatedSlots=translated_slots,
        aiRole=card.strategicEvaluator.aiRole,
        turnPhaseWeights=card.strategicEvaluator.turnPhaseWeights,
        additionalSynergyTags=list(card.strategicEvaluator.decklistSynergyRequirements),
    )

    return merge_llm_payload_into_skeleton(
        skeleton=skeleton,
        llm_payload=payload,
        compilation_metadata=card.compilationMetadata,
    )
