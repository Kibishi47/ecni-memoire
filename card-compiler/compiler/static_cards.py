"""Générateur déterministe statique pour les cartes d'Énergies de Base Pokémon TCG.

Les Énergies de Base (Feu, Eau, Plante, Électrique, Psy, Combat, Obscurité, Métal)
ne possèdent aucun texte de règle ni effet activé : leur attachement manuel (1 par tour)
est une règle universelle native du moteur de jeu.
Ce module court-circuite complètement le LLM pour ces cartes afin de garantir :
- 0 token consommé
- 0s d'attente (< 1 milliseconde par carte)
- 0 risque d'hallucination sémantique
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union

from compiler.schemas import (
    CardCategory,
    CardIdentity,
    CardSubCategory,
    CompilationMetadata,
    EngineCardModel,
    StrategicEvaluator,
    StrategicRole,
    TurnPhaseWeights,
)
from compiler.tcgdex_fetcher import FetchedCardBundle

# Types d'énergie élémentaires normalisés du JCC Pokémon
CANONICAL_ENERGY_TYPES: List[str] = [
    "Feu",
    "Eau",
    "Plante",
    "Électrique",
    "Psy",
    "Combat",
    "Obscurité",
    "Métal",
]

# Variantes de mots-clés FR et EN associées à chaque type d'énergie
ENERGY_TYPE_KEYWORDS: Dict[str, List[str]] = {
    "Feu": ["feu", "fire"],
    "Eau": ["eau", "water"],
    "Plante": ["plante", "grass"],
    "Électrique": ["électrique", "electrique", "electrik", "électrik", "lightning"],
    "Psy": ["psy", "psychic"],
    "Combat": ["combat", "fighting"],
    "Obscurité": ["obscurité", "obscurite", "obscur", "darkness", "dark"],
    "Métal": ["métal", "metal"],
}

# Noms normalisés officiels des 8 énergies de base FR et EN
BASIC_ENERGY_NAMES_EXACT: set[str] = {
    # Noms français
    "énergie plante",
    "energie plante",
    "énergie feu",
    "energie feu",
    "énergie eau",
    "energie eau",
    "énergie électrique",
    "energie electrique",
    "énergie electrik",
    "energie electrik",
    "énergie psy",
    "energie psy",
    "énergie combat",
    "energie combat",
    "énergie obscurité",
    "energie obscurite",
    "énergie métal",
    "energie metal",
    # Variantes "Énergie de base ..."
    "énergie de base plante",
    "énergie de base feu",
    "énergie de base eau",
    "énergie de base électrique",
    "énergie de base electrik",
    "énergie de base psy",
    "énergie de base combat",
    "énergie de base obscurité",
    "énergie de base métal",
    # Noms anglais
    "grass energy",
    "fire energy",
    "water energy",
    "lightning energy",
    "psychic energy",
    "fighting energy",
    "darkness energy",
    "metal energy",
    # Variantes "Basic ... Energy"
    "basic grass energy",
    "basic fire energy",
    "basic water energy",
    "basic lightning energy",
    "basic psychic energy",
    "basic fighting energy",
    "basic darkness energy",
    "basic metal energy",
}


def _extract_raw_bundle_data(
    raw_card: Union[FetchedCardBundle, Dict[str, Any]],
) -> Tuple[str, Dict[str, Any], Dict[str, Any], Optional[CardIdentity]]:
    """Normalise l'extraction des données brutes FR/EN et de l'identité selon le type d'entrée."""
    if isinstance(raw_card, FetchedCardBundle):
        return (
            raw_card.card_id,
            raw_card.raw_fr or {},
            raw_card.raw_en or {},
            raw_card.identity,
        )
    elif isinstance(raw_card, dict):
        if "fr" in raw_card and isinstance(raw_card["fr"], dict):
            cid = str(raw_card.get("requestedId") or raw_card["fr"].get("id") or "")
            return cid, raw_card["fr"], raw_card.get("en") or {}, None
        else:
            cid = str(raw_card.get("id") or raw_card.get("cardId") or "")
            return cid, raw_card, {}, None
    raise TypeError(f"Entrée non supportée pour l'extraction de carte : {type(raw_card)}")


def is_basic_energy(raw_card: Union[FetchedCardBundle, Dict[str, Any]]) -> bool:
    """Détecte avec certitude si une carte est une Énergie de Base Pokémon TCG.

    Retourne `True` si :
    - La catégorie est `ENERGY` / `Énergie`.
    - ET le nom correspond à l'une des 8 Énergies de Base officielles (FR/EN)
      ou le type d'énergie brut est 'Normal' / 'De base' sans effet spécial complexe.
    - ET ce n'est PAS une Énergie Spéciale (ex: Double Turbo, Brume, Propulsion, Inversion, etc.).
    """
    card_id, raw_fr, raw_en, identity = _extract_raw_bundle_data(raw_card)

    # 1. Vérification de la catégorie
    if identity is not None:
        if identity.category != CardCategory.ENERGY:
            return False
        if identity.subCategory == CardSubCategory.SPECIAL_ENERGY:
            return False
    else:
        cat_fr = str(raw_fr.get("category") or "").strip().lower()
        cat_en = str(raw_en.get("category") or "").strip().lower()
        is_energy_cat = any(term in cat_fr for term in ["énerg", "energ"]) or any(
            term in cat_en for term in ["energ"]
        )
        if not is_energy_cat:
            return False

    # 2. Rejet immédiat des Énergies Spéciales
    energy_type_fr = str(raw_fr.get("energyType") or "").strip().lower()
    energy_type_en = str(raw_en.get("energyType") or "").strip().lower()
    if "spécial" in energy_type_fr or "special" in energy_type_en:
        return False

    name_fr = str(raw_fr.get("name") or "").strip().lower()
    name_en = str(raw_en.get("name") or "").strip().lower()

    # Si le nom contient explicitement des mots-clés d'énergies spéciales connues
    special_keywords = [
        "double turbo",
        "brume",
        "mist",
        "propulsion",
        "jet",
        "inversion",
        "reversal",
        "lumineuse",
        "luminous",
        "héritage",
        "legacy",
        "boomerang",
        "thérapeutique",
        "therapeutic",
        "néo-supérieure",
        "neo upper",
        "cadeau",
        "gift",
    ]
    if any(sk in name_fr or sk in name_en for sk in special_keywords):
        return False

    # 3. Correspondance avec la liste exacte des 8 Énergies de Base
    if name_fr in BASIC_ENERGY_NAMES_EXACT or name_en in BASIC_ENERGY_NAMES_EXACT:
        return True

    # Variantes sans accent ou nettoyées
    clean_fr = re.sub(r"[^a-z0-9 ]+", " ", name_fr).strip()
    clean_en = re.sub(r"[^a-z0-9 ]+", " ", name_en).strip()
    if clean_fr in BASIC_ENERGY_NAMES_EXACT or clean_en in BASIC_ENERGY_NAMES_EXACT:
        return True

    # 4. Vérification via energyType TCGdex ('Normal', 'De base', 'Base') et absence d'effet textuel
    effect_fr = str(raw_fr.get("effect") or "").strip()
    effect_en = str(raw_en.get("effect") or "").strip()
    is_normal_type = energy_type_fr in {"normal", "de base", "base"} or energy_type_en in {
        "normal",
        "basic",
    }

    if is_normal_type and (not effect_fr or not effect_en):
        return True

    # Vérification si le nom contient l'un des 8 types de base
    for canon_type, keywords in ENERGY_TYPE_KEYWORDS.items():
        if any(kw in name_fr or kw in name_en for kw in keywords):
            return True

    return False


def extract_energy_type(raw_card: Union[FetchedCardBundle, Dict[str, Any]]) -> str:
    """Extrait le type d'énergie élémentaire normalisé parmi les 8 types officiels.

    Retourne :
    'Feu', 'Eau', 'Plante', 'Électrique', 'Psy', 'Combat', 'Obscurité', ou 'Métal'.
    """
    card_id, raw_fr, raw_en, identity = _extract_raw_bundle_data(raw_card)

    name_fr = str(raw_fr.get("name") or (identity.nameFr if identity else "")).strip().lower()
    name_en = str(raw_en.get("name") or (identity.nameEn if identity and identity.nameEn else "")).strip().lower()

    combined = f"{name_fr} {name_en} {str(raw_fr.get('energyType') or '')} {str(raw_en.get('energyType') or '')}".lower()

    for canon_type, keywords in ENERGY_TYPE_KEYWORDS.items():
        for kw in keywords:
            # Recherche par frontière de mot ou sous-chaîne distinctive
            if kw in combined:
                return canon_type

    # Si aucun type élémentaire n'est explicitement trouvé, lève une exception descriptive
    raise ValueError(
        f"Impossible d'extraire le type d'énergie de base pour la carte '{card_id}' (nom: '{name_fr}')."
    )


def build_basic_energy_model(
    raw_card: Union[FetchedCardBundle, Dict[str, Any]],
) -> EngineCardModel:
    """Construit de façon 100 % déterministe et instantanée le modèle `EngineCardModel` d'une Énergie de Base.

    Caractéristiques :
    - `category`: `ENERGY`
    - `subCategory`: `BASIC_ENERGY`
    - `pokemonStats`: `None`
    - `playableActions`: `[]` (l'attachement manuel est une règle universelle native, 1 par tour)
    - `strategicEvaluator`: Profil standard de ressource d'énergie pure (score 50, discardPriority 15, holdBonus 25)
    - `compilationMetadata`: Trace statique `STATIC_DETERMINISTIC` (temps 0.001s, 0 token LLM)
    """
    card_id, raw_fr, raw_en, identity = _extract_raw_bundle_data(raw_card)

    if identity is not None:
        deterministic_identity = identity.model_copy(
            update={
                "category": CardCategory.ENERGY,
                "subCategory": CardSubCategory.BASIC_ENERGY,
            }
        )
    else:
        set_obj = raw_fr.get("set") if isinstance(raw_fr.get("set"), dict) else {}
        set_id = str(set_obj.get("id") or (card_id.split("-")[0] if "-" in card_id else "")).strip()
        set_name = str(set_obj.get("name") or "").strip() or None
        local_id = str(raw_fr.get("localId") or (card_id.split("-")[-1] if "-" in card_id else "")).strip()
        legal_obj = raw_fr.get("legal") if isinstance(raw_fr.get("legal"), dict) else {}
        name_fr = str(raw_fr.get("name") or card_id).strip()
        name_en = str(raw_en.get("name")).strip() if raw_en and raw_en.get("name") else None

        deterministic_identity = CardIdentity(
            cardId=card_id,
            nameFr=name_fr,
            nameEn=name_en,
            setId=set_id,
            setName=set_name,
            localId=local_id,
            category=CardCategory.ENERGY,
            subCategory=CardSubCategory.BASIC_ENERGY,
            regulationMark=raw_fr.get("regulationMark"),
            legalStandard=bool(legal_obj.get("standard", True)),
            legalExpanded=bool(legal_obj.get("expanded", True)),
            rarity=raw_fr.get("rarity") or (raw_en or {}).get("rarity"),
            imageUrl=raw_fr.get("image") or (raw_en or {}).get("image"),
            rawRulesText=[],
        )

    evaluator = StrategicEvaluator(
        primaryRole=StrategicRole.RESOURCE_ENERGY,
        intrinsicBaseScore=50,
        turnPhaseWeights=TurnPhaseWeights(
            turn1=1.0,
            turn2=1.0,
            turn3=1.0,
            turn4Plus=1.0,
        ),
        decklistSynergyRequirements=[],
        inGameDeadCardConditions=[],
        discardPriorityWhenDead=15,
        holdForNextTurnBonus=25,
    )

    metadata = CompilationMetadata(
        modelRepoId="STATIC_DETERMINISTIC",
        modelFilename="builtin_engine_rule",
        compilationTimeSeconds=0.001,
        compiledAtIso=datetime.now(timezone.utc).isoformat(),
    )

    return EngineCardModel(
        cardId=card_id,
        identity=deterministic_identity,
        pokemonStats=None,
        category=CardCategory.ENERGY,
        subCategory=CardSubCategory.BASIC_ENERGY,
        playableActions=[],
        strategicEvaluator=evaluator,
        compilationMetadata=metadata,
    )
