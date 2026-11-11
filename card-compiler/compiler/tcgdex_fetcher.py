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
import time
import urllib.parse
from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

try:
    from tcgdexsdk import TCGdex
    from tcgdexsdk.query import Query
except ImportError:
    TCGdex = None
    Query = None

from compiler.schemas import (
    CardCategory,
    CardIdentity,
    CardSubCategory,
    PokemonStats,
)

TCGDEX_API_BASE = "https://api.tcgdex.net/v2"


class FetcherProvider(str, Enum):
    """Fournisseurs d'accès aux données de cartes Pokémon TCG."""

    sdk = "sdk"
    rest = "rest"

# Liste officielle des 14 cartes stratégiques et énergies de référence du mode --test
TEST_CARD_IDS: List[str] = [
    "sv04-125",  # Super Bonbon (Rare Candy)
    "sv05-144",  # Poffin Copain-Copain (Buddy-Buddy Poffin)
    "sv01-196",  # Hyper Ball (Ultra Ball)
    "sv01-181",  # Faiblo Ball (Nest Ball)
    "sv03-125",  # Dracaufeu-ex (Charizard ex)
    "sv03-164",  # Roucarnage-ex (Pidgeot ex)
    "sv02-185",  # Mashynn (Iono)
    "sv01-166",  # Pepper / Arven
    "sv04-160",  # Attrape-Riposte (Counter Catcher)
    "sv05-123",  # Ire-Foudre-ex (Raging Bolt ex)
    "sv06.5-038",  # Favianos-ex (Fezandipiti ex)
    "me01-104",  # Méga-Kangourex-ex (Mega Kangaskhan ex)
    "sve-002",  # Énergie Feu (Fire Energy) - Court-circuit statique
    "sve-004",  # Énergie Électrique (Lightning Energy) - Court-circuit statique
]

# Table de référence garantissant que les IDs stratégiques résolvent toujours vers la bonne carte
# même si la numérotation locale varie entre extensions TCGdex (ex: Super Bonbon est sv01-191 sur TCGdex).
TEST_CARDS_REFERENCE: Dict[str, Dict[str, str]] = {
    "sv04-125": {
        "expected_name_fr": "Super Bonbon",
        "expected_name_en": "Rare Candy",
        "fallback_tcgdex_id": "sv01-191",
    },
    "sv05-144": {
        "expected_name_fr": "Poffin",
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
    "sv05-123": {
        "expected_name_fr": "Ire-Foudre",
        "expected_name_en": "Raging Bolt",
        "fallback_tcgdex_id": "sv05-123",
    },
    "sv06.5-038": {
        "expected_name_fr": "Favianos",
        "expected_name_en": "Fezandipiti",
        "fallback_tcgdex_id": "sv06.5-038",
    },
    "me01-104": {
        "expected_name_fr": "Kangourex",
        "expected_name_en": "Kangaskhan",
        "fallback_tcgdex_id": "me01-104",
    },
    "sve-002": {
        "expected_name_fr": "Énergie Feu",
        "expected_name_en": "Fire Energy",
        "fallback_tcgdex_id": "sve-002",
    },
    "sve-004": {
        "expected_name_fr": "Énergie Electrik",
        "expected_name_en": "Lightning Energy",
        "fallback_tcgdex_id": "sve-004",
    },
}


def _clean_tcgdex_dict(obj: Any) -> Any:
    """Nettoie récursivement les dictionnaires issus de `asdict` en supprimant les instances SDK non sérialisables."""
    if isinstance(obj, dict):
        return {k: _clean_tcgdex_dict(v) for k, v in obj.items() if k != "sdk"}
    elif isinstance(obj, list):
        return [_clean_tcgdex_dict(v) for v in obj]
    return obj


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


from compiler.deterministic_builder import (
    _normalize_whitespace,
    build_identity_and_stats_from_raw,
    detect_rule_box_and_prizes as _det_rule_box_and_prizes,
    extract_raw_rules_text,
    infer_category_and_subcategory,
)


def _normalize_text(text: Optional[str]) -> str:
    return _normalize_whitespace(text)


def detect_rule_box_and_prizes(name_fr: str, name_en: Optional[str], raw_fr: Dict[str, Any]) -> Tuple[bool, int]:
    """Détermine si un Pokémon possède un encadré Règle (ex, V, VSTAR, VMAX, Méga-ex, Radieux) et le nombre de Récompenses."""
    return _det_rule_box_and_prizes(name_fr, name_en, raw_fr)


class TCGdexFetcher:
    """Client asynchrone TCGdex gérant l'index global, le cache brut et la résolution de lignée d'évolution."""

    def __init__(
        self,
        data_dir: Path,
        timeout_seconds: float = 25.0,
        provider: FetcherProvider = FetcherProvider.sdk,
    ) -> None:
        self.data_dir = data_dir
        self.raw_dir = self.data_dir / "raw_tcgdex"
        self.raw_dir.mkdir(parents=True, exist_ok=True)
        self.index_path = self.raw_dir / "_cards_index.json"
        self.standard_index_path = self.raw_dir / "_cards_standard_index.json"
        self.timeout_seconds = timeout_seconds
        self.provider = provider
        self._name_to_pre_evo_cache: Dict[str, Optional[str]] = {}
        self._cards_index_cache: Optional[List[Dict[str, Any]]] = None
        self._standard_cards_index_cache: Optional[List[Dict[str, Any]]] = None

        if self.provider == FetcherProvider.sdk and TCGdex is not None:
            self._sdk_fr = TCGdex("fr")
            self._sdk_en = TCGdex("en")
        else:
            self._sdk_fr = None
            self._sdk_en = None

    async def fetch_cards_index(
        self,
        client: httpx.AsyncClient,
        force: bool = False,
    ) -> List[Dict[str, Any]]:
        """Étape 1 : Récupère la liste globale de toutes les cartes via SDK ou `GET /v2/fr/cards` et la met en cache."""
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

        # 1. Tentative via SDK officiel si provider SDK
        if self.provider == FetcherProvider.sdk and self._sdk_fr is not None:
            try:
                cards_list_obj = await asyncio.to_thread(self._sdk_fr.card.listSync)
                if cards_list_obj and isinstance(cards_list_obj, list):
                    cards_list = [_clean_tcgdex_dict(asdict(c)) for c in cards_list_obj if hasattr(c, "id")]
                    if cards_list:
                        self.index_path.write_text(
                            json.dumps(cards_list, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                        self._cards_index_cache = cards_list
                        return cards_list
            except Exception:
                pass

        # 2. Requête REST via httpx
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

    async def fetch_standard_cards_index(
        self,
        client: httpx.AsyncClient,
        force: bool = False,
    ) -> List[Dict[str, Any]]:
        """Récupère la liste officielle des cartes légales au format Standard (`legal.standard=true`).

        Interroge en priorité le SDK Python officiel TCGdex (`t.card.listSync(Query().contains('legal.standard', 'true'))`)
        ou l'API REST `GET /v2/fr/cards?legal.standard=true`. Met en cache dans `data/raw_tcgdex/_cards_standard_index.json`.
        """
        if self._standard_cards_index_cache is not None and not force:
            return self._standard_cards_index_cache

        if self.standard_index_path.exists() and not force:
            try:
                cached = json.loads(self.standard_index_path.read_text(encoding="utf-8"))
                if isinstance(cached, list) and len(cached) > 0:
                    self._standard_cards_index_cache = cached
                    return cached
            except Exception:
                pass

        # 1. Tentative via SDK officiel si provider SDK
        if self.provider == FetcherProvider.sdk and self._sdk_fr is not None and Query is not None:
            try:
                q = Query().contains("legal.standard", "true")
                cards_list_obj = await asyncio.to_thread(self._sdk_fr.card.listSync, q)
                if cards_list_obj and isinstance(cards_list_obj, list):
                    cards_list = [_clean_tcgdex_dict(asdict(c)) for c in cards_list_obj if hasattr(c, "id")]
                    if cards_list:
                        self.standard_index_path.write_text(
                            json.dumps(cards_list, ensure_ascii=False, indent=2),
                            encoding="utf-8",
                        )
                        self._standard_cards_index_cache = cards_list
                        return cards_list
            except Exception:
                pass

        # 2. Requête REST via httpx (provider REST ou repli SDK)
        url = f"{TCGDEX_API_BASE}/fr/cards?legal.standard=true"
        response = await client.get(url)
        response.raise_for_status()
        cards_list = response.json()
        if not isinstance(cards_list, list):
            raise ValueError(f"Réponse inattendue de {url}: attendu une liste JSON.")

        self.standard_index_path.write_text(
            json.dumps(cards_list, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self._standard_cards_index_cache = cards_list
        return cards_list

    async def _get_card_json_with_variants(
        self,
        client: httpx.AsyncClient,
        lang: str,
        card_id: str,
    ) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
        """Interroge le provider sélectionné (SDK ou REST) en testant automatiquement les variantes avec/sans zéro initial."""
        sdk_instance = self._sdk_fr if lang == "fr" else self._sdk_en
        candidates = generate_candidate_ids(card_id)

        # 1. Tentative via SDK Python officiel TCGdex si activé
        if self.provider == FetcherProvider.sdk and sdk_instance is not None:
            for candidate in candidates:
                try:
                    card_obj = await asyncio.to_thread(sdk_instance.card.getSync, candidate)
                    if card_obj is not None and getattr(card_obj, "id", None):
                        data = _clean_tcgdex_dict(asdict(card_obj))
                        return data, candidate
                except Exception:
                    continue

        # 2. Requête REST directe via httpx (provider REST ou fallback si SDK indisponible)
        for candidate in candidates:
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
        return build_identity_and_stats_from_raw(
            requested_card_id=requested_card_id,
            raw_fr=raw_fr,
            raw_en=raw_en,
            evolution_info=evolution_info,
        )

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

        if raw_fr is None and cache_path.exists():
            try:
                cached_payload = json.loads(cache_path.read_text(encoding="utf-8"))
                if isinstance(cached_payload, dict) and "fr" in cached_payload:
                    raw_fr = cached_payload["fr"]
                    raw_en = cached_payload.get("en")
                    resolved_id = cached_payload.get("resolvedTcgdexId", safe_id)
            except Exception:
                pass

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
        force: bool = False,
    ) -> List[str]:
        """Récupère les IDs des cartes légales au format Standard (`legal.standard == true`).

        Interroge en priorité le SDK Python officiel TCGdex (`t.card.listSync(Query().contains('legal.standard', 'true'))`)
        avec repli HTTP REST (`GET /v2/fr/cards?legal.standard=true`).
        Met en cache les résultats dans `data/raw_tcgdex/_cards_standard_index.json`.
        """
        try:
            cards_index = await self.fetch_standard_cards_index(client, force=force)
            card_ids = [
                str(entry.get("id")).strip()
                for entry in cards_index
                if isinstance(entry, dict) and entry.get("id")
            ]
            unique_ids = list(dict.fromkeys(card_ids))
            if unique_ids:
                if limit is not None and limit > 0:
                    return unique_ids[:limit]
                return unique_ids
        except Exception:
            pass

        # Repli défensif si hors ligne et sans cache _cards_standard_index.json
        cards_index = await self.fetch_cards_index(client, force=False)
        candidate_ids: List[str] = []
        for entry in cards_index:
            if not isinstance(entry, dict):
                continue
            cid = str(entry.get("id") or "").strip()
            if not cid:
                continue
            reg_m = str(entry.get("regulationMark") or "").strip().upper()
            if reg_m in {"G", "H", "I"}:
                candidate_ids.append(cid)
            elif cid.lower().startswith(("sv", "me")):
                candidate_ids.append(cid)

        unique_ids = list(dict.fromkeys(candidate_ids))
        if limit is not None and limit > 0:
            return unique_ids[:limit]
        return unique_ids

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
                    try:
                        bundle = await self.fetch_card_by_id(client, cid, force=force)
                        if mode == "standard" and not bundle.identity.legalStandard:
                            return None
                        return bundle
                    except Exception:
                        # En mode batch ou standard, une carte introuvable sur TCGdex
                        # (ex: placeholders de sets non parus, 404 temporaire) ne doit pas
                        # faire planter tout le pipeline : on l'ignore proprement.
                        return None

            results = await asyncio.gather(*[_fetch_one(cid) for cid in target_ids])
            for res in results:
                if res is not None:
                    bundles.append(res)

            return bundles

    async def download_raw_cards(
        self,
        card_ids: List[str],
        client: Optional[httpx.AsyncClient] = None,
        force: bool = False,
        concurrency: int = 5,
        progress_callback: Optional[Callable[[str, str, bool, Optional[str]], None]] = None,
    ) -> Dict[str, Any]:
        """Télécharge et enregistre chaque carte dans le cache individuel `data/raw_tcgdex/{card_id}.json`.

        Args:
            card_ids: Liste d'identifiants de cartes à télécharger dans le cache.
            client: Instance httpx.AsyncClient optionnelle (créée automatiquement si None).
            force: Si True, force le re-téléchargement et écrase data/raw_tcgdex/{card_id}.json.
                   Si False, les cartes déjà présentes sur le disque sont préservées (cache hit).
            concurrency: Nombre de téléchargements simultanés (requêtes réseau parallèles).
            progress_callback: Callback optionnel appelé après le traitement de chaque carte:
                               callback(card_id, card_name, newly_downloaded, error_msg)

        Returns:
            Dictionnaire récapitulatif {
                "total": int,
                "cached": int,
                "downloaded": int,
                "failed": int,
                "failed_cards": Dict[str, str],
                "elapsed_seconds": float,
            }
        """
        if client is not None:
            return await self._download_raw_cards_impl(
                card_ids=card_ids,
                client=client,
                force=force,
                concurrency=concurrency,
                progress_callback=progress_callback,
            )

        headers = {
            "Accept": "application/json",
            "User-Agent": "pokemon-tcg-card-compiler/0.1.0",
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds, headers=headers, follow_redirects=True) as local_client:
            return await self._download_raw_cards_impl(
                card_ids=card_ids,
                client=local_client,
                force=force,
                concurrency=concurrency,
                progress_callback=progress_callback,
            )

    async def _download_raw_cards_impl(
        self,
        card_ids: List[str],
        client: httpx.AsyncClient,
        force: bool = False,
        concurrency: int = 5,
        progress_callback: Optional[Callable[[str, str, bool, Optional[str]], None]] = None,
    ) -> Dict[str, Any]:
        start_time = time.perf_counter()
        unique_ids = list(dict.fromkeys(cid.strip() for cid in card_ids if cid.strip()))
        total = len(unique_ids)

        cached_count = 0
        downloaded_count = 0
        failed_cards: Dict[str, str] = {}
        lock = asyncio.Lock()
        semaphore = asyncio.Semaphore(max(1, concurrency))

        async def _worker(cid: str) -> None:
            nonlocal cached_count, downloaded_count
            cache_file = self.raw_dir / f"{cid}.json"
            was_cached = cache_file.exists() and not force

            async with semaphore:
                try:
                    bundle = await self.fetch_card_by_id(client, cid, force=force)
                    cname = bundle.identity.nameFr or cid
                    async with lock:
                        if was_cached:
                            cached_count += 1
                        else:
                            downloaded_count += 1
                    if progress_callback:
                        progress_callback(cid, cname, not was_cached, None)
                except Exception as exc:
                    async with lock:
                        failed_cards[cid] = str(exc)
                    if progress_callback:
                        progress_callback(cid, cid, False, str(exc))

        await asyncio.gather(*[_worker(cid) for cid in unique_ids])
        elapsed = time.perf_counter() - start_time

        return {
            "total": total,
            "cached": cached_count,
            "downloaded": downloaded_count,
            "failed": len(failed_cards),
            "failed_cards": failed_cards,
            "elapsed_seconds": elapsed,
        }

