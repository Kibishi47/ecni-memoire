"""Post-processeur déterministe, réparation de corpus et verrous d'invariants Pokémon TCG (`compiler/post_processor.py`).

Ce module s'appuie sur `compiler/deterministic_builder.py` pour :
1. Garantir que `identity`, `pokemonStats` et les squelettes des `playableActions`
   respectent 100 % des valeurs déterministes extraites de TCGdex.
2. Appliquer les verrous et garde-fous finaux (`canUseTurn1GoingFirst`, `canUseTurn1GoingSecond`,
   dégâts de base `DAMAGE_ACTIVE`, lancers de pièce, scaling dynamique, désinversion de `deadCardCondition`,
   recalibrage de `strategicEvaluator`).
3. Réparer sans relance LLM lourde un corpus déjà compilé (`repair_compiled_corpus`).
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from compiler.deterministic_builder import (
    _extract_special_conditions,
    build_deterministic_skeleton,
    build_evolvable_names_index,
    build_reprint_effect_index,
    merge_llm_payload_into_skeleton,
)
from compiler.schemas import (
    AtomicEffect,
    EffectPrimitive,
    EngineCardModel,
    LLMCompiledPayload,
    LLMTranslatedSlot,
    TurnPhaseWeights,
    _coerce_ai_role,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


LEGACY_RECOMPILE_FIXED_IDS = ("sv08.5-037", "me02.5-215")


def _preclean_raw_effect_dict(
    raw_eff: Any,
    slot_text_lower: str,
) -> Optional[AtomicEffect]:
    """Pré-nettoie un dict d'effet issu d'une compilation antérieure avant validation `AtomicEffect`."""
    if not isinstance(raw_eff, dict):
        return None
    eff_copy = dict(raw_eff)
    prim_str = str(eff_copy.get("primitive") or "").strip().upper()
    if prim_str == "APPLY_SPECIAL_CONDITION" and eff_copy.get("specialCondition") is None:
        detected = _extract_special_conditions(slot_text_lower)
        if detected:
            eff_copy["specialCondition"] = detected[0].value
        else:
            # Ancien APPLY_SPECIAL_CONDITION utilisé comme verrou/modificateur : supprimé pour réextraction déterministe
            return None
    try:
        return AtomicEffect.model_validate(eff_copy)
    except Exception:
        return None


def sanitize_and_enrich_card(
    bundle: FetchedCardBundle,
    card: EngineCardModel,
    raw_dir: Optional[Path] = None,
    reprint_index: Optional[Dict[Tuple[str, str], Tuple[str, str]]] = None,
    evolvable_names: Optional[Set[str]] = None,
) -> EngineCardModel:
    """Valide et verrouille déterministiquement un `EngineCardModel` à partir de son `FetchedCardBundle`."""
    skeleton = build_deterministic_skeleton(
        bundle,
        raw_dir=raw_dir,
        reprint_index=reprint_index,
    )

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
        evolvable_names=evolvable_names,
    )


def repair_compiled_corpus(
    data_dir: Path,
    target_ids: Optional[List[str]] = None,
    dry_run: bool = False,
) -> Dict[str, Any]:
    """Répare déterministiquement toutes les cartes de `data/compiled_cards/*.json` et génère `cards_to_recompile_llm.txt`."""
    compiled_dir = data_dir / "compiled_cards"
    raw_dir = data_dir / "raw_tcgdex"
    compiled_dir.mkdir(parents=True, exist_ok=True)

    reprint_index = build_reprint_effect_index(raw_dir)
    evolvable_names = build_evolvable_names_index(raw_dir)

    json_files = sorted(f for f in compiled_dir.glob("*.json") if not f.name.startswith("_"))
    if target_ids is not None:
        target_set = set(target_ids)
        json_files = [f for f in json_files if f.stem in target_set]

    repaired_cards: Dict[str, Dict[str, Any]] = {}
    legacy_recompile_ids: List[str] = []
    errors: List[Tuple[str, str]] = []
    total_files = len(json_files)
    modified_count = 0

    for fpath in json_files:
        cid = fpath.stem
        try:
            old_raw_str = fpath.read_text(encoding="utf-8")
            old_data = json.loads(old_raw_str)
        except Exception as exc:
            errors.append((cid, str(exc)))
            continue

        meta_raw = old_data.get("compilationMetadata") or {}
        model_repo = str(meta_raw.get("modelRepoId") or "")
        model_fn = str(meta_raw.get("modelFilename") or "")
        if (
            model_repo == "Qwen/Qwen3-14B-GGUF"
            or model_fn == "model.safetensors (MLX Native)"
            or cid in LEGACY_RECOMPILE_FIXED_IDS
        ):
            legacy_recompile_ids.append(cid)

        raw_path = raw_dir / f"{cid}.json"
        if raw_path.exists():
            skeleton = build_deterministic_skeleton(
                raw_path,
                raw_dir=raw_dir,
                reprint_index=reprint_index,
            )
        else:
            skeleton = build_deterministic_skeleton(
                old_data,
                raw_dir=raw_dir,
                reprint_index=reprint_index,
            )

        slot_spec_map = {s.slotId: s for s in skeleton.slots_for_llm}
        slot_ids = set(slot_spec_map.keys())
        translated_slots: List[LLMTranslatedSlot] = []

        for act in old_data.get("playableActions") or []:
            if not isinstance(act, dict):
                continue
            aid = str(act.get("actionId") or "").strip()
            if aid not in slot_ids:
                continue
            spec = slot_spec_map[aid]
            slot_text_lower = f"{spec.textFr} {spec.textEn or ''}".lower()

            cleaned_effs: List[AtomicEffect] = []
            for raw_eff in act.get("effects") or []:
                parsed_eff = _preclean_raw_effect_dict(raw_eff, slot_text_lower)
                if parsed_eff is not None:
                    cleaned_effs.append(parsed_eff)

            translated_slots.append(
                LLMTranslatedSlot(
                    slotId=aid,
                    preconditions=list(act.get("preconditions") or []),
                    effects=cleaned_effs,
                    deadCardCondition=act.get("deadCardCondition"),
                )
            )

        strat_raw = old_data.get("strategicEvaluator") or {}
        ai_role = _coerce_ai_role(strat_raw.get("aiRole") or strat_raw.get("primaryRole") or "GUEST_TECH")
        weights = TurnPhaseWeights.model_validate(strat_raw.get("turnPhaseWeights") or {})
        raw_syns = list(strat_raw.get("decklistSynergyRequirements") or [])

        # Conserver le payload complet ou reconstruit via fallback si ancienne carte sans slots valides
        # ou carte STATIC_DETERMINISTIC venant d'hériter d'un texte de réédition (ex: 30th-128 Hyper Ball)
        if (skeleton.slots_for_llm and not translated_slots) or (
            model_repo == "STATIC_DETERMINISTIC" and skeleton.slots_for_llm
        ):
            llm_payload = None
        else:
            llm_payload = LLMCompiledPayload(
                translatedSlots=translated_slots,
                aiRole=ai_role,
                turnPhaseWeights=weights,
                additionalSynergyTags=raw_syns,
            )

        meta_obj = None
        if isinstance(meta_raw, dict) and meta_raw.get("modelRepoId"):
            from compiler.schemas import CompilationMetadata

            meta_norm = dict(meta_raw)
            meta_norm.setdefault("compilationTimeSeconds", 0.0)
            meta_norm.setdefault("compiledAtIso", "")
            meta_obj = CompilationMetadata.model_validate(meta_norm)

        repaired_model = merge_llm_payload_into_skeleton(
            skeleton=skeleton,
            llm_payload=llm_payload,
            compilation_metadata=meta_obj,
            evolvable_names=evolvable_names,
        )
        repaired_dict = repaired_model.model_dump(mode="json")
        repaired_cards[cid] = repaired_dict

        new_json_str = json.dumps(repaired_dict, ensure_ascii=False, indent=2)
        if new_json_str != old_raw_str:
            modified_count += 1
            if not dry_run:
                fpath.write_text(new_json_str, encoding="utf-8")

    # S'assurer que toutes les anciennes cartes explicites sont triées/dédupliquées
    legacy_recompile_ids = sorted(dict.fromkeys(legacy_recompile_ids))
    recompile_file = data_dir / "cards_to_recompile_llm.txt"
    if not dry_run:
        header = (
            "# Cartes issues d'anciennes versions du pipeline (Qwen3-14B-GGUF du 29/10,\n"
            "# model.safetensors (MLX Native) du 04/11) ainsi que sv08.5-037 et me02.5-215.\n"
            "# Commande recommandee :\n"
            "#   python3 main.py re-run --phase 2 --ids-file data/cards_to_recompile_llm.txt\n"
        )
        content = header + "\n".join(legacy_recompile_ids) + ("\n" if legacy_recompile_ids else "")
        recompile_file.write_text(content, encoding="utf-8")

    # Mise à jour de data/cards_database.json (uniquement en run complet ou sync incrémentiel)
    db_path = data_dir / "cards_database.json"
    if not dry_run:
        existing_is_dict = False
        existing_db: Any = None
        if db_path.exists() and db_path.stat().st_size > 0:
            try:
                existing_db = json.loads(db_path.read_text(encoding="utf-8"))
                existing_is_dict = isinstance(existing_db, dict)
            except Exception:
                existing_db = None

        if target_ids is None:
            all_cards_by_id = repaired_cards
        else:
            # Charger toutes les cartes du disque pour garder cards_database.json cohérent
            all_cards_by_id = {}
            for p in sorted(f for f in compiled_dir.glob("*.json") if not f.name.startswith("_")):
                all_cards_by_id[p.stem] = repaired_cards.get(p.stem) or json.loads(p.read_text(encoding="utf-8"))

        sorted_cards_list = [all_cards_by_id[k] for k in sorted(all_cards_by_id.keys())]
        if existing_is_dict and isinstance(existing_db, dict) and "cards" in existing_db:
            if isinstance(existing_db["cards"], dict):
                db_payload: Any = {
                    **existing_db,
                    "updatedAtIso": datetime.now(timezone.utc).isoformat(),
                    "totalCards": len(sorted_cards_list),
                    "cards": {k: all_cards_by_id[k] for k in sorted(all_cards_by_id.keys())},
                }
            else:
                db_payload = {
                    **existing_db,
                    "updatedAtIso": datetime.now(timezone.utc).isoformat(),
                    "totalCards": len(sorted_cards_list),
                    "cards": sorted_cards_list,
                }
        else:
            db_payload = sorted_cards_list

        db_path.write_text(
            json.dumps(db_payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    return {
        "total_processed": total_files,
        "modified_count": modified_count,
        "repaired_count": len(repaired_cards),
        "legacy_recompile_count": len(legacy_recompile_ids),
        "legacy_recompile_ids": legacy_recompile_ids,
        "recompile_file": recompile_file,
        "db_path": db_path,
        "errors": errors,
    }
