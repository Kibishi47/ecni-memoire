"""Référentiel officiel distillé des règles du Pokémon TCG pour le compilateur deux passes.

Ce module fournit :
1. `CORE_RULES_SYSTEM_BLOCK` : socle compact et statique des règles officielles
   (livret Pokémon TCG Scarlet & Violet — Paradox Rift) destiné au prompt système
   de la Passe 1 (`ReasoningEngine`), optimisé pour le cache de préfixe MLX.
2. `select_relevant_rule_snippets` & `format_relevant_rules_block` : injection
   contextuelle dynamique de micro-règles ciblées uniquement sur les mécaniques
   présentes dans la carte en cours d'analyse, évitant tout bruit de contexte.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import TYPE_CHECKING, Callable, List, Optional, Tuple

from compiler.schemas import CardCategory, CardSubCategory

if TYPE_CHECKING:
    from compiler.deterministic_builder import DeterministicCardSkeleton
    from compiler.tcgdex_fetcher import FetchedCardBundle


CORE_RULES_SYSTEM_BLOCK = """RÈGLES OFFICIELLES DE RÉFÉRENCE (JUGE POKÉMON TCG) :
- **Structure du tour & Limites T1** : Début de tour = pioche 1 carte (la défaite par deck vide ne survient QUE si le joueur ne peut pas piocher au début de son tour, jamais à cause d'un effet de carte). Limites par tour : 1 Énergie attachée, 1 Supporter (interdit Tour 1 du 1er joueur sauf texte explicite), 1 Stade (reste en jeu, unique en jeu, défausse l'ancien, interdit de jouer un Stade du même nom), 1 Retraite, Talents utilisables selon leur texte. Chaque Pokémon ne peut avoir qu'**1 seul Outil** attaché à la fois. Évolution interdite au Tour 1 des deux joueurs et sur un Pokémon entré/évolué ce tour (`TARGET_IN_PLAY_SINCE_PREVIOUS_TURN`), sauf exception explicite (ex: objet d'évolution directe). Une attaque termine le tour (interdite Tour 1 du 1er joueur sauf mention explicite).
- **Attaque vs Talent vs Marqueurs de dégâts** : Une attaque sans dégât de base (0) reste une attaque (soumise à Confusion, T1 J1, verrous d'attaque et fin de tour). Un Talent (ou Trait Antique) n'est jamais une attaque. `PLACE_DAMAGE_COUNTERS` (1 marqueur = 10 PV) N'EST PAS un dégât d'attaque : il **ignore** Faiblesse, Résistance, protection du Banc (y compris Téracristal) et réductions/immunités de dégâts. Les dégâts sur le Banc n'appliquent jamais Faiblesse ni Résistance. Résolution d'une attaque : Confusion -> choix requis par l'attaque -> lancers de pièce -> avant dégâts -> `(Base + Bonus attaquant) -> Faiblesse -> Résistance -> Modifs défenseur` -> effets après dégâts.
- **États Spéciaux & Retraite/Échange** : Seul l'Actif subit les États Spéciaux. **Évoluer ou passer sur le Banc (Retraite ou `SWITCH_ACTIVE`) efface tous les États Spéciaux ET tous les effets d'attaques** (dont `LOCK_NEXT_TURN_ATTACK` / `LOCK_RETREAT`). `ASLEEP` et `PARALYZED` bloquent attaque et retraite ; `CONFUSED` (pile/face avant d'attaquer : si pile, attaque annulée + 30 sur soi), `POISONED` et `BURNED` n'empêchent PAS de battre en retraite. Contrôle Pokémon (entre tours) : 1) Poison (10) -> 2) Brûlure (20 + flip) -> 3) Sommeil (flip) -> 4) Paralysie (guérit après le tour suivant du propriétaire). `ASLEEP`/`CONFUSED`/`PARALYZED` s'écrasent ; `POISONED`/`BURNED` se cumulent.
- **Quantificateurs & Limites structurelles** : `"jusqu'à X"` / `"up to X"` impose **1 à X** (requiert >= 1 cible valide), **SAUF** `"piocher jusqu'à X"` / `"draw up to X"` où 0 est autorisé. `"n'importe quel nombre"` / `"any amount"` autorise 0. `"vous pouvez"` / `"you may"` = `optional: true`. Les limites structurelles (1 Outil/Pokémon, Stade de même nom, 1 Pouvoir VSTAR/partie, T1) se modélisent via `preconditions` / `deadCardCondition` / `canUseTurn1*`, jamais en inventant des primitives dans `effects`.
- **Noms exacts** : `ex`, `-EX`, `Radieux`/`Radiant`, variante régionale (`Paldea`, `Alola`, `Galar`, `Hisui`) et nom de Dresseur font partie intégrante du nom (évolution et limite de 4 copies)."""


@dataclass(frozen=True)
class _ContextualRuleContext:
    category: CardCategory
    sub_category: CardSubCategory
    is_tera: bool
    is_ace_spec: bool
    is_technical_machine: bool
    prize_cards: int
    name_lower: str
    text_lower: str
    has_attacks_on_card: bool


@dataclass(frozen=True)
class _ContextualRuleSpec:
    code: str
    title: str
    predicate: Callable[[_ContextualRuleContext], bool]
    snippet: str


def _build_context(
    skeleton: "DeterministicCardSkeleton",
    bundle: Optional["FetchedCardBundle"] = None,
) -> _ContextualRuleContext:
    ident = skeleton.identity
    parts: List[str] = [ident.nameFr or "", ident.nameEn or "", *ident.rawRulesText]
    for slot in skeleton.slots_for_llm:
        parts.append(slot.label or "")
        parts.append(slot.textFr or "")
        if slot.textEn:
            parts.append(slot.textEn)

    has_attacks = any(a.actionType.value == "ATTACK" for a in skeleton.playableActions)
    if bundle is not None:
        raw_fr = getattr(bundle, "raw_fr", None) or {}
        raw_en = getattr(bundle, "raw_en", None) or {}
        for raw in (raw_fr, raw_en):
            if isinstance(raw, dict):
                if raw.get("effect"):
                    parts.append(str(raw["effect"]))
                if raw.get("attacks"):
                    has_attacks = True

    combined = re.sub(r"\s+", " ", " ".join(parts)).lower()
    name_low = f"{ident.nameFr or ''} {ident.nameEn or ''}".lower()
    return _ContextualRuleContext(
        category=skeleton.category,
        sub_category=skeleton.subCategory,
        is_tera=ident.isTera,
        is_ace_spec=ident.isAceSpec,
        is_technical_machine=ident.isTechnicalMachine,
        prize_cards=ident.prizeCardsGiven,
        name_lower=name_low,
        text_lower=combined,
        has_attacks_on_card=has_attacks,
    )


def _has_any(text: str, needles: Tuple[str, ...]) -> bool:
    return any(n in text for n in needles)


_CONTEXTUAL_RULE_TABLE: Tuple[_ContextualRuleSpec, ...] = (
    _ContextualRuleSpec(
        code="STADIUM",
        title="Stade",
        predicate=lambda c: c.sub_category == CardSubCategory.STADIUM
        or _has_any(c.text_lower, ("stade", "stadium")),
        snippet=(
            "Un Stade reste en jeu ; 1 seul Stade peut être en jeu (le nouveau défausse l'ancien) "
            "et on ne peut pas jouer un Stade du même nom qu'un Stade déjà en jeu "
            "(`deadCardCondition: \"STADIUM_ALREADY_IN_PLAY_SAME_NAME\"` pour une carte Stade)."
        ),
    ),
    _ContextualRuleSpec(
        code="TOOL_AND_TM",
        title="Outil Pokémon / Capsule Technique",
        predicate=lambda c: c.sub_category == CardSubCategory.TOOL
        or c.is_technical_machine
        or _has_any(c.text_lower, ("outil pokémon", "pokémon tool", "capsule technique", "technical machine")),
        snippet=(
            "Chaque Pokémon ne peut avoir qu'1 seul Outil attaché (`NO_POKEMON_WITHOUT_TOOL`). "
            "Une Capsule Technique (ou Outil à attaque) s'attache en phase principale (`effects=[]` sur le slot d'attache) "
            "et confère son `ATTACK` au Pokémon Actif avec son propre coût en Énergie (vérifier si elle se défausse en fin de tour)."
        ),
    ),
    _ContextualRuleSpec(
        code="SUPPORTER",
        title="Supporter",
        predicate=lambda c: c.sub_category == CardSubCategory.SUPPORTER,
        snippet=(
            "Limite de 1 carte Supporter par tour ; le joueur qui joue en premier ne peut pas jouer de Supporter "
            "pendant son premier tour (`canUseTurn1GoingFirst=false` sauf texte contraire)."
        ),
    ),
    _ContextualRuleSpec(
        code="FOSSIL",
        title="Carte Dresseur Fossile",
        predicate=lambda c: c.category == CardCategory.TRAINER
        and _has_any(c.text_lower, ("fossile", "fossil")),
        snippet=(
            "Un Fossile Dresseur n'est PAS un Pokémon de Base tant qu'il est dans le deck, la main ou la défausse, "
            "mais se pose sur le Banc comme un Pokémon de Base (`BENCH_HAS_EMPTY_SLOT` / `deadCardCondition: \"BENCH_FULL\"`) "
            "avec ses éventuels PV et Talents actifs en jeu."
        ),
    ),
    _ContextualRuleSpec(
        code="TERA_BENCH",
        title="Pokémon Téracristal-ex",
        predicate=lambda c: c.is_tera or _has_any(c.text_lower, ("téracristal", "tera pokémon", "tera ")),
        snippet=(
            "Sur le Banc, un Pokémon Téracristal-ex évite tous les **dégâts d'attaques** (des deux joueurs), "
            "mais subit normalement `PLACE_DAMAGE_COUNTERS` et les autres effets non-dégâts."
        ),
    ),
    _ContextualRuleSpec(
        code="DAMAGE_VS_COUNTERS",
        title="Dégâts vs Marqueurs / Banc",
        predicate=lambda c: _has_any(
            c.text_lower,
            (
                "marqueur de dégâts",
                "marqueurs de dégâts",
                "damage counter",
                "compteur de dégâts",
                "faiblesse",
                "résistance",
                "weakness",
                "resistance",
            ),
        )
        or (
            c.has_attacks_on_card
            and _has_any(c.text_lower, ("banc", "bench"))
            and _has_any(c.text_lower, ("dégât", "damage", "marqueur", "counter"))
        ),
        snippet=(
            "Poser des marqueurs = `PLACE_DAMAGE_COUNTERS` (`count` = nb de marqueurs de 10 PV ; ignore Faiblesse, "
            "Résistance, immunité Banc Téracristal et réductions). Les dégâts `DAMAGE_BENCH` ignorent Faiblesse et Résistance."
        ),
    ),
    _ContextualRuleSpec(
        code="SPECIAL_CONDITIONS_SWITCH",
        title="États Spéciaux & Retraite / Échange",
        predicate=lambda c: _has_any(
            c.text_lower,
            (
                "état spécial",
                "états spéciaux",
                "special condition",
                "empoisonn",
                "poison",
                "brûl",
                "burn",
                "endorm",
                "asleep",
                "paralys",
                "paralyz",
                "confus",
                "échang",
                "switch",
                "retraite",
                "retreat",
            ),
        ),
        snippet=(
            "Seul l'Actif subit les États Spéciaux ; évoluer ou passer sur le Banc (Retraite/`SWITCH_ACTIVE`) efface tous "
            "les États Spéciaux et effets d'attaques. Seuls `ASLEEP` et `PARALYZED` bloquent la retraite ; `CONFUSED` "
            "demande un lancer avant d'attaquer (pile = attaque annulée + 30 sur soi)."
        ),
    ),
    _ContextualRuleSpec(
        code="QUANTIFIER_UP_TO_ANY",
        title="Quantificateurs 'jusqu'à' / 'n'importe quel'",
        predicate=lambda c: _has_any(
            c.text_lower,
            ("jusqu'à", "up to", "n'importe quel", "any amount", "any number"),
        ),
        snippet=(
            "`\"jusqu'à X\"` / `\"up to X\"` signifie **1 à X** (requiert >= 1 cible), sauf pour piocher (`\"draw up to X\"` -> 0 permis). "
            "`\"n'importe quel nombre\"` / `\"any amount\"` autorise 0."
        ),
    ),
    _ContextualRuleSpec(
        code="ACE_SPEC_RADIANT",
        title="Limite Deck ACE SPEC / Radieux",
        predicate=lambda c: c.is_ace_spec
        or _has_any(c.text_lower, ("ace spec", "high-tech", "radieux", "radiant")),
        snippet=(
            "Règle de deck : au plus 1 carte ACE SPEC au total (toutes ACE SPEC confondues) et au plus 1 Pokémon Radieux "
            "au total par deck. Renseigne le profil stratégique sans ajouter d'effet fictif."
        ),
    ),
    _ContextualRuleSpec(
        code="VSTAR_POWER",
        title="Pouvoir VSTAR",
        predicate=lambda c: "vstar" in c.text_lower,
        snippet=(
            "Limite de 1 seul Pouvoir VSTAR par partie (tous Pokémon VSTAR confondus). "
            "Modéliser la restriction d'unicité via les préconditions (`ONCE_PER_GAME` / marqueur VSTAR), pas dans `effects`."
        ),
    ),
    _ContextualRuleSpec(
        code="LOST_ZONE",
        title="Zone Perdue",
        predicate=lambda c: _has_any(c.text_lower, ("zone perdue", "lost zone")),
        snippet=(
            "La Zone Perdue est hors jeu et irrécupérable pour toute la partie : utiliser `ZoneType.LOST_ZONE` (jamais `DISCARD`)."
        ),
    ),
    _ContextualRuleSpec(
        code="MEGA_EVOLUTION",
        title="Méga-Évolution",
        predicate=lambda c: bool(re.search(r"(?:^|\b)(?:méga|mega)[-\s]", c.name_lower))
        or _has_any(c.text_lower, ("méga-évolution", "mega evolution")),
        snippet=(
            "Un `Méga-...-ex` moderne donne 3 Récompenses et évolue normalement depuis son stade inférieur (ou Base s'il est Base) ; "
            "une ancienne Méga-Évolution XY (`M ...-EX`) donne 2 Récompenses et met fin au tour lors de l'évolution."
        ),
    ),
    _ContextualRuleSpec(
        code="OVERDRAW_MILL",
        title="Pioche / Manipulation haut de deck",
        predicate=lambda c: _has_any(
            c.text_lower,
            ("pioche", "draw ", "dessus du deck", "top ", "cartes de votre deck", "cards of your deck"),
        ),
        snippet=(
            "Si une carte fait piocher/regarder plus de cartes que le deck n'en contient, résoudre au maximum sans perdre ; "
            "seul le manque de carte à piocher au début du tour entraîne la défaite."
        ),
    ),
)


def select_relevant_rule_snippets(
    skeleton: "DeterministicCardSkeleton",
    bundle: Optional["FetchedCardBundle"] = None,
) -> List[Tuple[str, str]]:
    """Sélectionne uniquement les micro-règles officielles pertinentes pour la carte courante."""
    ctx = _build_context(skeleton, bundle=bundle)
    selected: List[Tuple[str, str]] = []
    for spec in _CONTEXTUAL_RULE_TABLE:
        if spec.predicate(ctx):
            selected.append((f"{spec.code} ({spec.title})", spec.snippet))
    return selected


def format_relevant_rules_block(
    skeleton: "DeterministicCardSkeleton",
    bundle: Optional["FetchedCardBundle"] = None,
) -> str:
    """Formate les micro-règles applicables à injecter dans `build_reasoning_prompt`."""
    snippets = select_relevant_rule_snippets(skeleton, bundle=bundle)
    if not snippets:
        return ""
    return "\n".join(f"- [{title}] {text}" for title, text in snippets)
