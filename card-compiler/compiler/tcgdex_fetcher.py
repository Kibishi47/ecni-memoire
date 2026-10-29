"""Client HTTP asynchrone TCGdex avec cache disque, gestion des IDs (404 / zéro initial) et résolveur de lignée d'évolution.

Ce module implémente :
- Étape 1 : Récupération et mise en cache de l'index global (`GET https://api.tcgdex.net/v2/fr/cards`
  -> `data/raw_tcgdex/_cards_index.json`).
- Étape 2 : Récupération détaillée par ID en français (`/v2/fr/cards/{id}`) et en anglais (`/v2/en/cards/{id}`)
  avec gestion automatique des formats d'identifiants (avec/sans zéro initial) et sauvegarde dans
  `data/raw_tcgdex/{id}.json`.
- Résolution récursive de la lignée d'évolution (`evolvesFrom` -> `rootBasicName` + `evolutionChain`).
- Extraction déterministe de `CardIdentity` et `PokemonStats`.
"""

from __future__ import annotations

import asyncio
import json
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from compiler.schemas import (
    CardCategory,
    CardIdentity,
    CardSubCategory,
    PokemonStats,
)

TCGDEX_API_BASE = "https://api.tcgdex.net/v2"

# Liste officielle des 10 cartes stratégiques de référence du mode --test
TEST_CARD_IDS: List[str] = [
    "sv04-125",    # Super Bonbon (Rare Candy)
    "sv05-144",    # Poffin Pote-Pote (Buddy-Buddy Poffin)
    "sv01-196",    # Hyper Ball (Ultra Ball)
    "sv01-181",    # Faiblo Ball (Nest Ball)
    "sv03-125",    # Dracaufeu ex (Charizard ex)
    "sv03-164",    # Roucarnage ex (Pidgeot ex)
    "sv02-185",    # Mashynn (Iono)
    "sv01-166",    # Pepper / Arven
    "sv04-160",    # Attrape-Riposte (Counter Catcher)
    "sv06.5-038",  # Fezandipiti ex (Félicanis ex)
]

# Table de référence garantissant que les 10 IDs stratégiques résolvent toujours vers la bonne carte
# même si la numérotation locale varie entre extensions TCGdex (ex: Super Bonbon est sv01-191 sur TCGdex).
TEST_CARDS_REFERENCE: Dict[str, Dict[str, str]] = {
    "sv04-125": {
        "expected_name_fr": "Super Bonbon",
        "expected_name_en": "Rare Candy",
        "fallback_tcgdex_id": "sv01-191",
    },
    "sv05-144": {
        "expected_name_fr": "Poffin Pote-Pote",
        "expected_name_en": "Buddy-Buddy Poffin",
        "fallback_tcgdex_id": "sv05-144",
    },
    "sv01-196": {
        "expected_name_fr": "Hyper Ball",
        "expected_name_en": "Ultra Ball",
        "fallback_tcgdex_id": "sv01-196",
    },
    "sv01-181": {
        "expected_name_fr": "Faiblo Ball",
        "expected_name_en": "Nest Ball",
        "fallback_tcgdex_id": "sv01-181",
    },
    "sv03-125": {
        "expected_name_fr": "Dracaufeu",
        "expected_name_en": "Charizard",
        "fallback_tcgdex_id": "sv03-125",
    },
    "sv03-164": {
        "expected_name_fr": "Roucarnage",
        "expected_name_en": "Pidgeot",
        "fallback_tcgdex_id": "sv03-164",
    },
    "sv02-185": {
        "expected_name_fr": "Mashynn",
        "expected_name_en": "Iono",
        "fallback_tcgdex_id": "sv02-185",
    },
    "sv01-166": {
        "expected_name_fr": "Pepper",
        "expected_name_en": "Arven",
        "fallback_tcgdex_id": "sv01-166",
    },
    "sv04-160": {
        "expected_name_fr": "Attrape-Riposte",
        "expected_name_en": "Counter Catcher",
        "fallback_tcgdex_id": "sv04-160",
    },
    "sv06.5-038": {
        "expected_name_fr": "Félicanis",
        "expected_name_en": "Fezandipiti",
        "fallback_tcgdex_id": "sv06.5-038",
    },
}


@dataclass
class FetchedCardBundle:
    """Conteneur regroupant les données brutes TCGdex (FR + EN) et les modèles déterministes."""

    card_id: str
    resolved_tcgdex_id: str
    raw_fr: Dict[str, Any]
    raw_en: Optional[Dict[str, Any]]
    identity: CardIdentity
    pokemon_stats: Optional[PokemonStats]
    raw_cache_path: Path


def generate_candidate_ids(card_id: str) -> List[str]:
    """Génère les variantes d'identifiants TCGdex (avec ou sans zéros initiaux) pour gérer les 404.

    Exemples :
    - 'sv06.5-038' -> ['sv06.5-038', 'sv06.5-38', 'sv6.5-038', 'sv6.5-38']
    - 'sv04-125'   -> ['sv04-125', 'sv4-125']
    - 'sv01-38'    -> ['sv01-38', 'sv01-038', 'sv1-38', 'sv1-038']
    """
    cleaned = card_id.strip()
    candidates: List[str] = [cleaned]

    if "-" not in cleaned:
        return candidates

    set_part, local_part = cleaned.split("-", 1)

    # Variantes du numéro de carte (sans zéro initial, paddé sur 3 chiffres, paddé sur 2 chiffres)
    local_variants: List[str] = [local_part]
    m_local = re.match(r"^0*(\d+)([a-zA-Z]*)$", local_part)
    if m_local:
        digits, suffix = m_local.group(1), m_local.group(2)
        stripped_local = f"{int(digits)}{suffix}"
        padded3_local = f"{int(digits):03d}{suffix}"
        padded2_local = f"{int(digits):02d}{suffix}"
        for v in (stripped_local, padded3_local, padded2_local):
            if v not in local_variants:
                local_variants.append(v)

    # Variantes du code d'extension (ex: sv04 <-> sv4, sv06.5 <-> sv6.5)
    set_variants: List[str] = [set_part]
    m_set = re.match(r"^([a-zA-Z]+)0*(\d+)(\.\d+)?$", set_part)
    if m_set:
        prefix, set_num, decimal_part = m_set.group(1), m_set.group(2), m_set.group(3) or ""
        stripped_set = f"{prefix}{int(set_num)}{decimal_part}"
        padded2_set = f"{prefix}{int(set_num):02d}{decimal_part}"
        for sv in (stripped_set, padded2_set):
            if sv not in set_variants:
                set_variants.append(sv)

    for sv in set_variants:
        for lv in local_variants:
            cand = f"{sv}-{lv}"
            if cand not in candidates:
                candidates.append(cand)

    return candidates


def _normalize_text(text: Optional[str]) -> str:
    if not text:
        return ""
    return re.sub(r"\s+", " ", text).strip()


def infer_category_and_subcategory(
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]] = None,
) -> Tuple[CardCategory, CardSubCategory]:
    """Détermine de façon déterministe `CardCategory` et `CardSubCategory` depuis le JSON TCGdex."""
    cat_fr = (raw_fr.get("category") or "").strip().lower()
    cat_en = ((raw_en or {}).get("category") or "").strip().lower()

    # 1. POKEMON
    if "pok" in cat_fr or "pok" in cat_en:
        stage_fr = (raw_fr.get("stage") or "").strip().lower()
        stage_en = ((raw_en or {}).get("stage") or "").strip().lower()
        if "niveau 2" in stage_fr or "stage2" in stage_en or "stage 2" in stage_en:
            return CardCategory.POKEMON, CardSubCategory.STAGE_2
        if (
            "niveau 1" in stage_fr
            or "stage1" in stage_en
            or "stage 1" in stage_en
            or "vmax" in stage_fr
            or "vstar" in stage_fr
            or "vmax" in stage_en
            or "vstar" in stage_en
        ):
            return CardCategory.POKEMON, CardSubCategory.STAGE_1
        return CardCategory.POKEMON, CardSubCategory.BASIC

    # 2. ENERGY
    if "énerg" in cat_fr or "energ" in cat_fr or "energ" in cat_en:
        etype_fr = (raw_fr.get("energyType") or "").strip().lower()
        etype_en = ((raw_en or {}).get("energyType") or "").strip().lower()
        name_fr = (raw_fr.get("name") or "").strip().lower()
        name_en = ((raw_en or {}).get("name") or "").strip().lower()
        effect_fr = (raw_fr.get("effect") or "").strip()
        effect_en = ((raw_en or {}).get("effect") or "").strip()
        if (
            "spécial" in etype_fr
            or "special" in etype_en
            or bool(effect_fr or effect_en)
            and "de base" not in name_fr
            and "basic" not in name_en
        ):
            return CardCategory.ENERGY, CardSubCategory.SPECIAL_ENERGY
        return CardCategory.ENERGY, CardSubCategory.BASIC_ENERGY

    # 3. TRAINER
    ttype_fr = (raw_fr.get("trainerType") or "").strip().lower()
    ttype_en = ((raw_en or {}).get("trainerType") or "").strip().lower()
    if "supporter" in ttype_fr or "supporter" in ttype_en:
        return CardCategory.TRAINER, CardSubCategory.SUPPORTER
    if "outil" in ttype_fr or "tool" in ttype_en or "technical machine" in ttype_en:
        return CardCategory.TRAINER, CardSubCategory.TOOL
    if "stade" in ttype_fr or "stadium" in ttype_en:
        return CardCategory.TRAINER, CardSubCategory.STADIUM
    return CardCategory.TRAINER, CardSubCategory.ITEM


def extract_raw_rules_text(
    raw_fr: Dict[str, Any],
    raw_en: Optional[Dict[str, Any]] = None,
) -> List[str]:
    """Assemble tous les textes d'effets, talents et attaques (FR + EN) pour le prompt et l'identité."""
    lines: List[str] = []

    effect_fr = _normalize_text(raw_fr.get("effect"))
    if effect_fr:
        lines.append(f"[Effet FR] {effect_fr}")

    if raw_en:
        effect_en = _normalize_text(raw_en.get("effect"))
        if effect_en and effect_en != effect_fr:
            lines.append(f"[Effect EN] {effect_en}")

    for ability in raw_fr.get("abilities") or []:
        if isinstance(ability, dict):
            ab_type = ability.get("type") or "Talent"
            ab_name = ability.get("name") or ""
            ab_effect = _normalize_text(ability.get("effect"))
            lines.append(f"[{ab_type} FR: {ab_name}] {ab_effect}")

    if raw_en:
        for ability in raw_en.get("abilities") or []:
            if isinstance(ability, dict):
                ab_type = ability.get("type") or "Ability"
                ab_name = ability.get("name") or ""
                ab_effect = _normalize_text(ability.get("effect"))
                lines.append(f"[{ab_type} EN: {ab_name}] {ab_effect}")

    for attack in raw_fr.get("attacks") or []:
        if isinstance(attack, dict):
            atk_name = attack.get("name") or ""
            atk_cost = ",".join(attack.get("cost") or [])
            atk_dmg = attack.get("damage")
            atk_eff = _normalize_text(attack.get("effect"))
            dmg_str = f" ({atk_dmg} dégâts)" if atk_dmg is not None else ""
            lines.append(f"[Attaque FR: {atk_name} | Coût: {atk_cost}{dmg_str}] {atk_eff}".strip())

    if raw_en:
        for attack in raw_en.get("attacks") or []:
            if isinstance(attack, dict):
                atk_name = attack.get("name") or ""
                atk_cost = ",".join(attack.get("cost") or [])
                atk_dmg = attack.get("damage")
                atk_eff = _normalize_text(attack.get("effect"))
                dmg_str = f" ({atk_dmg} dmg)" if atk_dmg is not None else ""
                lines.append(f"[Attack EN: {atk_name} | Cost: {atk_cost}{dmg_str}] {atk_eff}".strip())

    return lines


def detect_rule_box_and_prizes(name_fr: str, name_en: Optional[str], raw_fr: Dict[str, Any]) -> Tuple[bool, int]:
    """Détermine si un Pokémon possède un encadré Règle (ex, V, VSTAR, VMAX, Radieux) et le nombre de Récompenses."""
    combined_name = f"{name_fr} {name_en or ''}"
    suffix = str(raw_fr.get("suffix") or "").lower()

    if re.search(r"\bvmax\b", combined_name, flags=re.IGNORECASE) or "vmax" in suffix:
        return True, 3

    if (
        re.search(r"(?:\b|-)(ex|v|vstar|gx)\b", combined_name, flags=re.IGNORECASE)
        or suffix in {"ex", "v", "vstar", "gx"}
    ):
        return True, 2

    if re.search(r"\b(radieux|radiant)\b", combined_name, flags=re.IGNORECASE):
        return True, 1

    return False, 1


class TCGdexFetcher:
    """Client asynchrone TCGdex gérant l'index global, le cache brut et la résolution de lignée d'évolution."""

    def __init__(self, data_dir: Path, timeout_seconds: float = 25.0) -> None:
        self.data_dir = data_dir
        self.raw_dir = self.data_dir / "raw_tcgdex"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.raw_dir / "_cards_index.json"
        self.timeout_seconds = timeout_seconds
        self._name_to_pre_evo_cache: Dict[str, Optional[str]] = {}
        self._cards_index_cache: Optional[List[Dict[str, Any]]] = None

    async def fetch_cards_index(
        self,
        client: httpx.AsyncClient,
        force: bool = False,
    ) -> List[Dict[str, Any]]:
        """Étape 1 : Récupère la liste globale de toutes les cartes via `GET /v2/fr/cards` et la met en cache."""
        if self._cards_index_cache is not None and not force:
            return self._cards_index_cache

        if self.index_path.exists() and not force:
            try:
                cached = json.loads(self.index_path.read_text(encoding="utf-8"))
                if isinstance(cached, list) and len(cached) > 0:
                    self._cards_index_cache = cached
                    return cached
            except Exception:
                pass

        url = f"{TCGDEX_API_BASE}/fr/cards"
        response = await client.get(url)
        response.raise_for_status()
        cards_list = response.json()
        if not isinstance(cards_list, list):
            raise ValueError(f"Réponse inattendue de {url}: attendu une liste JSON.")

        self.index_path.write_text(
            json.dumps(cards_list, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._cards_index_cache = cards_list
        return cards_list

    async def _get_card_json_with_variants(
        self,
        client: httpx.AsyncClient,
        lang: str,
        card_id: str,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Interroge `/v2/{lang}/cards/{candidate}` en testant automatiquement les variantes avec/sans zéro initial."""
        for candidate in generate_candidate_ids(card_id):
            url = f"{TCGDEX_API_BASE}/{lang}/cards/{urllib.parse.quote(candidate)}"
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    data = resp.json()
                    if isinstance(data, dict) and data.get("id"):
                        return data, candidate
                elif resp.status_code == 404:
                    continue
            except httpx.HTTPError:
                continue
        return None, None

    async def _resolve_pre_evolution_name(
        self,
        client: httpx.AsyncClient,
        pokemon_name_fr: str,
    ) -> Optional[str]:
        """Résout le `evolveFrom` d'un Pokémon intermédiaire (ex: 'Reptincel' -> 'Salamèche') via TCGdex."""
        clean_name = pokemon_name_fr.strip()
        if not clean_name:
            return None

        if clean_name in self._name_to_pre_evo_cache:
            return self._name_to_pre_evo_cache[clean_name]

        # Recherche dans l'index ou via le filtre ?name= de TCGdex
        url = f"{TCGDEX_API_BASE}/fr/cards?name={urllib.parse.quote(clean_name)}"
        try:
            resp = await client.get(url)
            if resp.status_code == 200:
                matches = resp.json()
                if isinstance(matches, list):
                    # Privilégie une correspondance exacte (insensible à la casse)
                    exact_matches = [
                        m for m in matches
                        if isinstance(m, dict) and str(m.get("name", "")).strip().lower() == clean_name.lower()
                    ]
                    candidates = exact_matches or [m for m in matches if isinstance(m, dict)]
                    for item in candidates[:3]:
                        cid = item.get("id")
                        if not cid:
                            continue
                        detail, _ = await self._get_card_json_with_variants(client, "fr", str(cid))
                        if detail and detail.get("category", "").lower().startswith("pok"):
                            pre_evo = detail.get("evolveFrom") or detail.get("evolvesFrom")
                            self._name_to_pre_evo_cache[clean_name] = pre_evo
                            return pre_evo
        except httpx.HTTPError:
            pass

        self._name_to_pre_evo_cache[clean_name] = None
        return None

    async def resolve_evolution_lineage(
        self,
        client: httpx.AsyncClient,
        raw_fr: Dict[str, Any],
        sub_category: CardSubCategory,
    ) -> Tuple[Optional[str], Optional[str], List[str]]:
        """Calcule `(evolves_from, root_basic_name, evolution_chain)` pour un Pokémon."""
        card_name = str(raw_fr.get("name") or "").strip()
        evolve_from = raw_fr.get("evolveFrom") or raw_fr.get("evolvesFrom")
        if isinstance(evolve_from, str):
            evolve_from = evolve_from.strip() or None
        else:
            evolve_from = None

        if sub_category == CardSubCategory.BASIC or not evolve_from:
            return None, card_name, [card_name] if card_name else []

        if sub_category == CardSubCategory.STAGE_1:
            return evolve_from, evolve_from, [evolve_from, card_name]

        # STAGE_2 : on remonte d'un cran supplémentaire depuis le Niveau 1 (ex: Dracaufeu ex -> Reptincel -> Salamèche)
        root_basic = await self._resolve_pre_evolution_name(client, evolve_from)
        if root_basic and root_basic != evolve_from:
            return evolve_from, root_basic, [root_basic, evolve_from, card_name]

        return evolve_from, evolve_from, [evolve_from, card_name]

    def build_deterministic_models(
        self,
        requested_card_id: str,
        raw_fr: Dict[str, Any],
        raw_en: Optional[Dict[str, Any]],
        evolution_info: Optional[Tuple[Optional[str], Optional[str], List[str]]] = None,
    ) -> Tuple[CardIdentity, Optional[PokemonStats]]:
        """Construit `CardIdentity` et `PokemonStats` à partir des données brutes TCGdex."""
        category, sub_category = infer_category_and_subcategory(raw_fr, raw_en)
        name_fr = str(raw_fr.get("name") or requested_card_id).strip()
        name_en = str(raw_en.get("name")).strip() if raw_en and raw_en.get("name") else None

        set_obj = raw_fr.get("set") if isinstance(raw_fr.get("set"), dict) else {}
        set_id = str(set_obj.get("id") or requested_card_id.split("-")[0]).strip()
        set_name = str(set_obj.get("name")).strip() if set_obj.get("name") else None
        local_id = str(raw_fr.get("localId") or requested_card_id.split("-")[-1]).strip()

        legal_obj = raw_fr.get("legal") if isinstance(raw_fr.get("legal"), dict) else {}
        legal_standard = bool(legal_obj.get("standard", False))
        legal_expanded = bool(legal_obj.get("expanded", False))

        raw_rules_text = extract_raw_rules_text(raw_fr, raw_en)

        identity = CardIdentity(
            cardId=requested_card_id,
            nameFr=name_fr,
            nameEn=name_en,
            setId=set_id,
            setName=set_name,
            localId=local_id,
            category=category,
            subCategory=sub_category,
            regulationMark=raw_fr.get("regulationMark") or (raw_en or {}).get("regulationMark"),
            legalStandard=legal_standard,
            legalExpanded=legal_expanded,
            rarity=raw_fr.get("rarity") or (raw_en or {}).get("rarity"),
            imageUrl=raw_fr.get("image") or (raw_en or {}).get("image"),
            rawRulesText=raw_rules_text,
        )

        pokemon_stats: Optional[PokemonStats] = None
        if category == CardCategory.POKEMON:
            hp_raw = raw_fr.get("hp") if raw_fr.get("hp") is not None else (raw_en or {}).get("hp")
            try:
                hp = int(hp_raw) if hp_raw is not None else 0
            except (TypeError, ValueError):
                hp = 0

            types_list = [str(t) for t in (raw_fr.get("types") or (raw_en or {}).get("types") or [])]
            stage_str = raw_fr.get("stage") or (raw_en or {}).get("stage")

            if evolution_info is not None:
                evolves_from, root_basic, evo_chain = evolution_info
            else:
                evo_from_raw = raw_fr.get("evolveFrom") or raw_fr.get("evolvesFrom")
                evolves_from = str(evo_from_raw).strip() if evo_from_raw else None
                root_basic = evolves_from or name_fr
                evo_chain = [evolves_from, name_fr] if evolves_from else [name_fr]

            retreat_raw = raw_fr.get("retreat") if raw_fr.get("retreat") is not None else (raw_en or {}).get("retreat")
            try:
                retreat_cost = int(retreat_raw) if retreat_raw is not None else 0
            except (TypeError, ValueError):
                retreat_cost = 0

            weaknesses = [
                str(w.get("type"))
                for w in (raw_fr.get("weaknesses") or [])
                if isinstance(w, dict) and w.get("type")
            ]
            resistances = [
                str(r.get("type"))
                for r in (raw_fr.get("resistances") or [])
                if isinstance(r, dict) and r.get("type")
            ]
            is_rule_box, prize_cards = detect_rule_box_and_prizes(name_fr, name_en, raw_fr)

            pokemon_stats = PokemonStats(
                hp=hp,
                types=types_list,
                stage=stage_str,
                evolvesFrom=evolves_from,
                rootBasicName=root_basic,
                evolutionChain=evo_chain,
                retreatCost=retreat_cost,
                weaknesses=weaknesses,
                resistances=resistances,
                prizeCardsGiven=prize_cards,
                isRuleBox=is_rule_box,
            )

        return identity, pokemon_stats

    async def fetch_card_by_id(
        self,
        client: httpx.AsyncClient,
        card_id: str,
        force: bool = False,
    ) -> FetchedCardBundle:
        """Étape 2 : Récupère une carte par ID (FR + EN) avec cache dans `data/raw_tcgdex/{id}.json`."""
        safe_id = card_id.strip()
        cache_path = self.raw_dir / f"{safe_id}.json"

        # 1. Lecture depuis le cache disque si disponible et non forcé
        if cache_path.exists() and not force:
            try:
                cached_payload = json.loads(cache_path.read_text(encoding="utf-8"))
                if isinstance(cached_payload, dict) and "fr" in cached_payload:
                    raw_fr = cached_payload["fr"]
                    raw_en = cached_payload.get("en")
                    resolved_id = cached_payload.get("resolvedTcgdexId", safe_id)
                    evo_obj = cached_payload.get("resolvedEvolution") or {}
                    evo_tuple = (
                        evo_obj.get("evolvesFrom"),
                        evo_obj.get("rootBasicName"),
                        evo_obj.get("evolutionChain") or [],
                    ) if evo_obj else None
                    identity, pokemon_stats = self.build_deterministic_models(
                        requested_card_id=safe_id,
                        raw_fr=raw_fr,
                        raw_en=raw_en,
                        evolution_info=evo_tuple,
                    )
                    return FetchedCardBundle(
                        card_id=safe_id,
                        resolved_tcgdex_id=resolved_id,
                        raw_fr=raw_fr,
                        raw_en=raw_en,
                        identity=identity,
                        pokemon_stats=pokemon_stats,
                        raw_cache_path=cache_path,
                    )
            except Exception:
                pass

        # 2. Téléchargement depuis TCGdex (FR + EN)
        raw_fr, resolved_id = await self._get_card_json_with_variants(client, "fr", safe_id)
        raw_en, _ = await self._get_card_json_with_variants(client, "en", resolved_id or safe_id)

        # Vérification de cohérence pour les 10 cartes de référence (ex: sv04-125 -> Super Bonbon / sv01-191)
        ref_spec = TEST_CARDS_REFERENCE.get(safe_id)
        if ref_spec is not None:
            exp_fr = ref_spec["expected_name_fr"].lower()
            exp_en = ref_spec["expected_name_en"].lower()
            actual_fr = str((raw_fr or {}).get("name") or "").lower()
            actual_en = str((raw_en or {}).get("name") or "").lower()
            if raw_fr is None or (exp_fr not in actual_fr and exp_en not in actual_en):
                fallback_id = ref_spec["fallback_tcgdex_id"]
                fb_fr, fb_resolved = await self._get_card_json_with_variants(client, "fr", fallback_id)
                if fb_fr is not None:
                    raw_fr = fb_fr
                    resolved_id = fb_resolved or fallback_id
                    raw_en, _ = await self._get_card_json_with_variants(client, "en", resolved_id)

        if raw_fr is None:
            raise RuntimeError(
                f"Impossible de récupérer la carte '{safe_id}' sur TCGdex (variantes testées: {generate_candidate_ids(safe_id)})."
            )

        resolved_final_id = resolved_id or str(raw_fr.get("id") or safe_id)
        category, sub_category = infer_category_and_subcategory(raw_fr, raw_en)

        evolution_info: Optional[Tuple[Optional[str], Optional[str], List[str]]] = None
        if category == CardCategory.POKEMON:
            evolution_info = await self.resolve_evolution_lineage(client, raw_fr, sub_category)

        identity, pokemon_stats = self.build_deterministic_models(
            requested_card_id=safe_id,
            raw_fr=raw_fr,
            raw_en=raw_en,
            evolution_info=evolution_info,
        )

        # Sauvegarde du brut consolidé dans data/raw_tcgdex/{id}.json
        cache_record: Dict[str, Any] = {
            "requestedId": safe_id,
            "resolvedTcgdexId": resolved_final_id,
            "fr": raw_fr,
            "en": raw_en,
            "resolvedEvolution": (
                {
                    "evolvesFrom": evolution_info[0],
                    "rootBasicName": evolution_info[1],
                    "evolutionChain": evolution_info[2],
                }
                if evolution_info is not None
                else None
            ),
        }
        cache_path.write_text(
            json.dumps(cache_record, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        return FetchedCardBundle(
            card_id=safe_id,
            resolved_tcgdex_id=resolved_final_id,
            raw_fr=raw_fr,
            raw_en=raw_en,
            identity=identity,
            pokemon_stats=pokemon_stats,
            raw_cache_path=cache_path,
        )

    async def resolve_standard_card_ids(
        self,
        client: httpx.AsyncClient,
        limit: Optional[int] = None,
    ) -> List[str]:
        """Récupère les IDs des cartes légales au format Standard (`legal.standard == true`).

        Optimise la sélection en filtrant les extensions Écarlate et Violet (`sv*`) de l'index global
        ou en vérifiant `legal.standard` lors du téléchargement détaillé.
        """
        cards_index = await self.fetch_cards_index(client, force=False)
        # Les cartes Standard actuelles appartiennent aux séries Écarlate et Violet (sv*)
        sv_candidates: List[str] = []
        other_candidates: List[str] = []
        for entry in cards_index:
            if not isinstance(entry, dict):
                continue
            cid = str(entry.get("id") or "").strip()
            if not cid:
                continue
            # Si l'index inclut déjà l'objet legal, on l'utilise directement
            legal = entry.get("legal")
            if isinstance(legal, dict) and "standard" in legal:
                if legal.get("standard") is True:
                    sv_candidates.append(cid)
                continue
            if cid.lower().startswith("sv"):
                sv_candidates.append(cid)
            else:
                other_candidates.append(cid)

        selected = sv_candidates if sv_candidates else other_candidates
        if limit is not None and limit > 0:
            return selected[:limit]
        return selected

    async def fetch_batch(
        self,
        mode: str = "test",
        custom_ids: Optional[List[str]] = None,
        force: bool = False,
        standard_limit: Optional[int] = None,
    ) -> List[FetchedCardBundle]:
        """Exécute les Étapes 1 et 2 du workflow : index global puis récupération détaillée par lot."""
        headers = {
            "Accept": "application/json",
            "User-Agent": "pokemon-tcg-card-compiler/0.1.0",
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds, headers=headers, follow_redirects=True) as client:
            # Étape 1 : Liste globale systématiquement assurée dans data/raw_tcgdex/_cards_index.json
            await self.fetch_cards_index(client, force=False)

            # Détermination des IDs cibles selon le mode
            if custom_ids:
                target_ids = [cid.strip() for cid in custom_ids if cid.strip()]
            elif mode == "standard":
                target_ids = await self.resolve_standard_card_ids(client, limit=standard_limit)
            else:
                target_ids = list(TEST_CARD_IDS)

            bundles: List[FetchedCardBundle] = []
            semaphore = asyncio.Semaphore(5)

            async def _fetch_one(cid: str) -> Optional[FetchedCardBundle]:
                async with semaphore:
                    bundle = await self.fetch_card_by_id(client, cid, force=force)
                    if mode == "standard" and not bundle.identity.legalStandard:
                        return None
                    return bundle

            results = await asyncio.gather(*[_fetch_one(cid) for cid in target_ids])
            for res in results:
                if res is not None:
                    bundles.append(res)

            return bundles
