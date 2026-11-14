"""Moteur d'analyse et de raisonnement textuel (Passe 1 du pipeline Two-Pass).

Ce module gère :
1. Le chargement de l'IA de raisonnement (DeepSeek-R1 Distill Qwen 14B en 4-bit ou 8-bit)
   via MLX (`mlx-lm`) ou GGUF (`llama-cpp-python` avec `n_gpu_layers=-1`).
2. La génération d'une analyse ciblée EXCLUSIVEMENT sur les `slots_for_llm`
   (extraits par `compiler/deterministic_builder.py`) et le profil stratégique (`aiRole`, `turnPhaseWeights`).
3. La sauvegarde de chaque analyse dans `data/reasoning_texts/{card_id}.json`.
4. Le déchargement strict et total de la mémoire (`close()`, `del`, `gc.collect()`, `mx.clear_cache()`)
   avant le lancement de la Passe 2 (Coding).
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

from compiler import load_env_file
from compiler.deterministic_builder import (
    DeterministicCardSkeleton,
    build_deterministic_skeleton,
)
from compiler.mlx_utils import (
    build_mlx_logits_processors,
    build_mlx_sampler,
    clear_mlx_memory_cache,
    encode_prompt_tokens,
    resolve_mlx_batch_size,
    run_mlx_continuous_batch,
)
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
    normalize_intensity_mode,
    resolve_gguf_filename_for_repo,
    resolve_model_for_configuration,
)
from compiler.rules_knowledge import (
    CORE_RULES_SYSTEM_BLOCK,
    format_relevant_rules_block,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


REASONING_SYSTEM_PROMPT = f"""Tu es un Juge Officiel Pokémon TCG (Professeur Pokémon) et un expert en modélisation de moteur de jeu par IA.

TA MISSION (PASSE 1 - ANALYSE CIBLÉE DES SLOTS D'EFFETS ET STRATÉGIE) :
Python a DÉJÀ construit de façon 100 % déterministe l'identité de la carte, ses statistiques, ses coûts d'énergie, ses timings (`USE_ABILITY`, `TRIGGERED_ABILITY`, `PASSIVE_ABILITY`, `ATTACK`, etc.) et les dégâts numériques de base de ses attaques.
Tu ne dois analyser QUE les slots textuels fournis (`slots_for_llm`) et le profil stratégique de la carte.

{CORE_RULES_SYSTEM_BLOCK}

Pour chaque `slotId` fourni en entrée, détaille de manière concise et chirurgicale :
1. **Préconditions (`preconditions`)** :
   Conditions requises pour activer ce slot parmi le vocabulaire fermé :
   `SELF_IS_ACTIVE`, `SELF_ON_BENCH`, `SELF_IS_IN_HAND`, `BENCH_HAS_EMPTY_SLOT`, `BENCH_HAS_POKEMON`, `OPPONENT_HAS_BENCHED_POKEMON`, `TARGET_IN_PLAY_SINCE_PREVIOUS_TURN`, `NOT_FIRST_TURN`, `ON_EVOLVE_FROM_HAND`, `ON_PLAY_FROM_HAND_TO_BENCH`, `KO_SUFFERED_LAST_TURN`, `PLAYER_BEHIND_ON_PRIZES`, `OPPONENT_PRIZES_EXACT_COUNT`, `HAND_MIN_OTHER_CARDS:<N>`, `DECK_NOT_EMPTY`, `HAND_NOT_EMPTY`, `SELF_HAS_ENERGY`, `ONCE_PER_GAME`, `IN_PLAY:<Nom>`.
   (Les exceptions « utilisable au Tour 1 en jouant en premier » relèvent de `canUseTurn1GoingFirst` sur le squelette, pas de `NOT_FIRST_TURN`.)
2. **Séquence d'effets atomiques (`effects`)** :
   Traduis fidèlement chaque effet (y compris lancers de pièce, scaling `+`/`×`, marqueurs de dégâts, dégâts de recul sur `SELF`, verrous au tour suivant, modificateurs passifs) avec les primitives officielles :
   `SEARCH_DECK`, `DRAW_CARDS`, `DAMAGE_ACTIVE`, `DAMAGE_BENCH`, `ATTACH_ENERGY`, `DISCARD_CARDS`, `HEAL`, `SWITCH_ACTIVE`, `APPLY_SPECIAL_CONDITION`, `EVOLVE_POKEMON`, `SHUFFLE_HAND_DRAW`, `RECOVER_FROM_DISCARD`, `PLACE_DAMAGE_COUNTERS`, `MOVE_DAMAGE_COUNTERS`, `MOVE_ENERGY`, `MODIFY_DAMAGE_TAKEN`, `MODIFY_DAMAGE_DEALT`, `MODIFY_HP`, `MODIFY_RETREAT_COST`, `PREVENT_DAMAGE_OR_EFFECTS`, `LOCK_NEXT_TURN_ATTACK`, `LOCK_RETREAT`, `LOCK_ABILITIES`, `LOCK_ITEMS`, `EXPAND_BENCH`, `KNOCK_OUT`, `MILL_DECK`, `TAKE_EXTRA_PRIZE`, `PUT_ON_TOP_OR_BOTTOM_OF_DECK`.
   Attention : « Cherchez dans votre deck... » = `SEARCH_DECK` (JAMAIS `DRAW_CARDS`) ; « Placez X marqueurs de dégâts » = `PLACE_DAMAGE_COUNTERS` (JAMAIS `DAMAGE_ACTIVE`/`DAMAGE_BENCH`). Mélanger son deck après `SEARCH_DECK` est implicite (ne cherche jamais de primitive `SHUFFLE_DECK`).
   Précise selon le cas :
   - `target` (`SELF`, `OPPONENT_ACTIVE`, `OPPONENT_BENCH_SINGLE`, `OPPONENT_BENCH_ALL`, `OPPONENT_POKEMON_ANY`, `OPPONENT_ALL_POKEMON`, `OWN_ACTIVE`, `OWN_BENCH_SINGLE`, `OWN_BENCH_ALL`, `OWN_POKEMON_ANY`, `OWN_ALL_POKEMON`, `ALL_POKEMON_IN_PLAY`, `PLAYER`, `OPPONENT`),
   - `sourceZone` / `destinationZone` / `zone` (`DECK`, `TOP_OF_DECK`, `BOTTOM_OF_DECK`, `HAND`, `DISCARD`, `BENCH`, `ACTIVE`, `PRIZES`, `LOST_ZONE`, `ATTACHED_CARDS`),
   - `specialCondition` si `APPLY_SPECIAL_CONDITION` (`POISONED`, `BURNED`, `ASLEEP`, `PARALYZED`, `CONFUSED`),
   - `coinFlipMode` (`SINGLE_HEADS_REQUIRED`, `SINGLE_HEADS_BONUS`, `MULTI_COIN_PER_HEADS`, `UNTIL_TAILS_PER_HEADS`, `TWO_TAILS_SELF_DAMAGE`) + `coinCount`,
   - `scalingOperator` (`ADD`, `MULTIPLY`) + `scalingMetric` + `bonusValue`,
   - `filter` (ex. `IS_POKEMON_EX`, `BASIC_ENERGY`, `BASIC_POKEMON`), `value`, `count`, `upTo`, `optional`.
   Si une mécanique rare sort des 29 primitives (ex. attaquer deux fois, copier une attaque), décris-la brièvement et indique `effects: []` (ou les primitives partielles applicables) sans jamais inventer de primitive ni bloquer.
3. **Condition de carte morte (`deadCardCondition`)** :
   INVERSE logique de `preconditions` : la situation où l'action/carte est INUTILISABLE (ex: `NO_KO_SUFFERED_LAST_TURN` si précondition = `KO_SUFFERED_LAST_TURN`, `NOT_BEHIND_ON_PRIZES`, `BENCH_FULL`, `OPPONENT_BENCH_EMPTY`, `NO_VALID_TARGET_IN_DECK`, `SELF_NOT_ACTIVE`, `STADIUM_ALREADY_IN_PLAY_SAME_NAME`, `NO_POKEMON_WITHOUT_TOOL`, `NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY`, ou `null`). Vérifie bien si `"jusqu'à X"` implique >= 1 cible valide (1..X vs 0 autorisé sur pioche).
4. **Évaluation Stratégique (`strategicEvaluator`)** :
   - `aiRole` parmi : `MAIN_ATTACKER`, `SECONDARY_ATTACKER`, `DRAW_ENGINE`, `ENERGY_ACCELERATOR`, `GUEST_TECH`, `DISRUPTION`, `CONSISTENCY_BOOSTER` (les Dresseurs/Énergies et pré-évolutions de Base <= 70 PV non-RuleBox ne sont jamais `MAIN_ATTACKER`).
   - `turnPhaseWeights` : 4 poids flottants réalistes entre `0.0` et `1.0` (`turn1`, `turn2`, `turn3`, `turn4Plus`) adaptés au stade/coût/rôle.
   - `additionalSynergyTags` : uniquement tags `requires_*` normalisés (`requires_stage_2_pokemon`, `requires_basic_hp_lte_70`, `requires_tera_pokemon`, `requires_ancient_pokemon`, `requires_future_pokemon`, `requires_discard_synergy`).

RÈGLE DE CLÔTURE : Rédige une analyse directe, concise et structurée slot par slot en une seule passe. Dès que tous les slots et le profil stratégique sont posés, ne boucle jamais en re-vérifications (« Wait / Final check ») : termine immédiatement ta réflexion et produis la synthèse finale."""


DEFAULT_REASONING_MAX_TOKENS = 8192
DEFAULT_REASONING_TEMPERATURE = 1.0
DEFAULT_REASONING_TOP_P = 0.95
DEFAULT_REASONING_TOP_K = 64
DEFAULT_REASONING_REPETITION_PENALTY = 1.08
DEFAULT_REASONING_REPETITION_CONTEXT_SIZE = 128


@dataclass
class ReasoningRecord:
    """Structure sauvegardée dans `data/reasoning_texts/{card_id}.json`."""

    cardId: str
    nameFr: str
    nameEn: Optional[str] = None
    modelRepoId: str = ""
    modelBackend: str = "mlx"
    reasoningText: str = ""
    rawThinkingProcess: Optional[str] = None
    createdAtIso: str = ""
    completionTokens: int = 0
    tokensPerSecond: float = 0.0
    generationDurationSeconds: float = 0.0
    timeToFirstTokenSeconds: float = 0.0
    finishReason: Optional[str] = None
    wasTruncated: bool = False
    dedupSourceCardId: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "ReasoningRecord":
        return cls(
            cardId=str(data.get("cardId", "")),
            nameFr=str(data.get("nameFr", "")),
            nameEn=data.get("nameEn"),
            modelRepoId=str(data.get("modelRepoId", "")),
            modelBackend=str(data.get("modelBackend", "mlx")),
            reasoningText=str(data.get("reasoningText", "")),
            rawThinkingProcess=data.get("rawThinkingProcess"),
            createdAtIso=str(data.get("createdAtIso", "")),
            completionTokens=int(data.get("completionTokens", 0) or 0),
            tokensPerSecond=float(data.get("tokensPerSecond", 0.0) or 0.0),
            generationDurationSeconds=float(data.get("generationDurationSeconds", 0.0) or 0.0),
            timeToFirstTokenSeconds=float(data.get("timeToFirstTokenSeconds", 0.0) or 0.0),
            finishReason=data.get("finishReason"),
            wasTruncated=bool(data.get("wasTruncated", False)),
            dedupSourceCardId=data.get("dedupSourceCardId"),
        )


def detect_reasoning_truncation(
    raw_text: str,
    finish_reason: Optional[str] = None,
) -> bool:
    """Détecte si la réponse de Passe 1 a été interrompue avant sa conclusion complète."""
    if finish_reason == "length":
        return True
    text = raw_text or ""
    if "<|channel>thought" in text and "<channel|>" not in text:
        return True
    for open_tag, close_tag in (
        ("<think>", "</think>"),
        ("<thought>", "</thought>"),
        ("<|thought|>", "</|thought|>"),
    ):
        if open_tag in text and close_tag not in text:
            return True
    return False


def clone_reasoning_record(
    source: ReasoningRecord,
    target_bundle: FetchedCardBundle,
) -> ReasoningRecord:
    """Clone une fiche d'analyse validée vers une carte fonctionnellement identique."""
    return ReasoningRecord(
        cardId=target_bundle.card_id,
        nameFr=target_bundle.identity.nameFr,
        nameEn=target_bundle.identity.nameEn,
        modelRepoId=source.modelRepoId,
        modelBackend=source.modelBackend,
        reasoningText=source.reasoningText,
        rawThinkingProcess=source.rawThinkingProcess,
        createdAtIso=datetime.now(timezone.utc).isoformat(),
        completionTokens=0,
        tokensPerSecond=0.0,
        generationDurationSeconds=0.0,
        timeToFirstTokenSeconds=0.0,
        finishReason=source.finishReason,
        wasTruncated=source.wasTruncated,
        dedupSourceCardId=source.dedupSourceCardId or source.cardId,
    )


def get_reasoning_texts_dir(data_dir: Path) -> Path:
    """Retourne et crée si besoin le dossier `data/reasoning_texts/`."""
    r_dir = data_dir / "reasoning_texts"
    r_dir.mkdir(parents=True, exist_ok=True)
    return r_dir


def load_reasoning_record(card_id: str, data_dir: Path) -> Optional[ReasoningRecord]:
    """Charge la fiche d'analyse d'une carte depuis `data/reasoning_texts/{card_id}.json` si elle existe."""
    fpath = get_reasoning_texts_dir(data_dir) / f"{card_id}.json"
    if not fpath.exists():
        return None
    try:
        raw = json.loads(fpath.read_text(encoding="utf-8"))
        if isinstance(raw, dict) and raw.get("reasoningText"):
            return ReasoningRecord.from_dict(raw)
    except Exception:
        return None
    return None


def save_reasoning_record(record: ReasoningRecord, data_dir: Path) -> Path:
    """Sauvegarde la fiche d'analyse d'une carte dans `data/reasoning_texts/{card_id}.json`."""
    fpath = get_reasoning_texts_dir(data_dir) / f"{record.cardId}.json"
    fpath.write_text(
        json.dumps(record.to_dict(), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return fpath


def has_reasoning_record(card_id: str, data_dir: Path) -> bool:
    """Vérifie si une carte possède déjà une fiche d'analyse de raisonnement valide."""
    rec = load_reasoning_record(card_id, data_dir)
    return rec is not None and bool(rec.reasoningText.strip())


def build_reasoning_prompt(
    bundle: FetchedCardBundle,
    skeleton: Optional[DeterministicCardSkeleton] = None,
) -> str:
    """Construit le prompt ultra-ciblé pour la Passe 1 (Raisonnement) contenant uniquement le résumé court et `slots_for_llm`."""
    skel = skeleton or build_deterministic_skeleton(bundle)
    ident = skel.identity
    stats = skel.pokemonStats

    summary_lines = [
        f"ID: {skel.cardId}",
        f"Nom: {ident.nameFr}" + (f" ({ident.nameEn})" if ident.nameEn else ""),
        f"Catégorie: {skel.category.value} / {skel.subCategory.value}",
    ]
    if stats is not None:
        summary_lines.append(
            f"Stats Pokémon: {stats.hp} PV | Types: {', '.join(stats.types)} | Stade: {stats.stage} | "
            f"Retraite: {stats.retreatCost} | Récompenses données: {ident.prizeCardsGiven} (RuleBox={ident.isRuleBox})"
        )
        attacks_summary = [
            f"{a.label} ({a.effects[0].value if a.effects else 0})"
            for a in skel.playableActions
            if a.actionType.value == "ATTACK"
        ]
        if attacks_summary:
            summary_lines.append(f"Attaques connues: {', '.join(attacks_summary)}")

    slots_payload = []
    for slot in skel.slots_for_llm:
        slot_dict: Dict[str, Any] = {
            "slotId": slot.slotId,
            "actionType": slot.actionType.value,
            "label": slot.label,
            "textFr": slot.textFr,
        }
        if slot.textEn:
            slot_dict["textEn"] = slot.textEn
        if slot.baseDamage is not None:
            slot_dict["baseDamageAlreadySetByPython"] = slot.baseDamage
        slots_payload.append(slot_dict)

    slots_json = json.dumps(slots_payload, ensure_ascii=False, indent=2)
    rules_block = format_relevant_rules_block(skel, bundle=bundle)
    rules_section = f"\n\nRÈGLES OFFICIELLES APPLICABLES À CETTE CARTE :\n{rules_block}" if rules_block else ""

    return (
        "Voici le résumé déterministe de la carte et la liste stricte des slots d'effets à analyser :\n\n"
        + "\n".join(summary_lines)
        + rules_section
        + "\n\nSLOTS À ANALYSER (`slots_for_llm`) :\n"
        + f"```json\n{slots_json}\n```\n\n"
        + "Analyse chaque slot (`preconditions`, `effects`, `deadCardCondition`) ainsi que le profil stratégique (`aiRole`, `turnPhaseWeights` entre 0.0 et 1.0, `additionalSynergyTags`)."
    )


def _split_thinking_and_explanation(raw_text: str) -> tuple[Optional[str], str]:
    """Sépare les balises de réflexion (`<|channel>thought...<channel|>`, `<think>...</think>`, `<thought>...</thought>`) de l'explication finale."""
    if not raw_text:
        return None, ""

    # 1. Canal Gemma 4 : <|channel>thought ... <channel|> (ou fermeture orpheline <channel|> si ouvert dans le prompt)
    m_gemma = re.search(r"<\|channel>\s*thought\b(.*?)<channel\|>", raw_text, flags=re.DOTALL | re.IGNORECASE)
    if m_gemma:
        thinking = m_gemma.group(1).strip()
        explanation = re.sub(
            r"<\|channel>\s*thought\b.*?<channel\|>", "", raw_text, flags=re.DOTALL | re.IGNORECASE
        ).strip()
        return thinking or None, explanation or thinking

    if "<channel|>" in raw_text:
        parts = raw_text.split("<channel|>", 1)
        thinking = re.sub(r"^.*?<\|channel>\s*thought\b", "", parts[0], flags=re.DOTALL | re.IGNORECASE).strip()
        explanation = parts[1].strip()
        return thinking or None, explanation or thinking

    if re.search(r"<\|channel>\s*thought\b", raw_text, flags=re.IGNORECASE):
        cleaned = re.sub(r"^.*?<\|channel>\s*thought\b", "", raw_text, flags=re.DOTALL | re.IGNORECASE).strip()
        return cleaned or None, cleaned

    # 2. Balises standard <think>...</think> / <thought>...</thought>
    for open_tag, close_tag in (
        ("<think>", "</think>"),
        ("<thought>", "</thought>"),
        ("<|thought|>", "</|thought|>"),
    ):
        pattern = re.escape(open_tag) + r"(.*?)" + re.escape(close_tag)
        m = re.search(pattern, raw_text, flags=re.DOTALL | re.IGNORECASE)
        if m:
            thinking = m.group(1).strip()
            explanation = re.sub(pattern, "", raw_text, flags=re.DOTALL | re.IGNORECASE).strip()
            if not explanation:
                explanation = thinking
            return thinking or None, explanation

        if close_tag in raw_text:
            parts = raw_text.split(close_tag, 1)
            thinking = parts[0].replace(open_tag, "").strip()
            explanation = parts[1].strip()
            return thinking or None, explanation or thinking

    return None, raw_text.strip()


class ReasoningEngine:
    """Moteur d'exécution de la Passe 1 (Raisonnement) supportant Apple MLX et llama.cpp GGUF."""

    def __init__(
        self,
        model: Optional[str] = None,
        intensity: Optional[Union[IntensityMode, str]] = None,
        backend: Optional[str] = None,
        hf_token: Optional[str] = None,
        max_tokens: Optional[int] = None,
        temperature: Optional[float] = None,
        top_p: Optional[float] = None,
        top_k: Optional[int] = None,
        repetition_penalty: Optional[float] = None,
        repetition_context_size: Optional[int] = None,
        enable_thinking: bool = True,
    ) -> None:
        load_env_file()
        self.intensity = normalize_intensity_mode(intensity)
        self.backend = (backend or "mlx").strip().lower()
        if self.backend not in {"mlx", "llama_cpp"}:
            self.backend = "mlx"

        self.repo_id = resolve_model_for_configuration(
            pipeline_mode=PipelineMode.two_pass,
            intensity=self.intensity,
            phase=PipelinePhase.reason,
            backend=self.backend,
            explicit_model=model,
        )
        self.hf_token = hf_token

        env_max_tok = os.environ.get("REASONING_MAX_TOKENS")
        self.max_tokens = (
            max(256, int(max_tokens))
            if max_tokens is not None
            else (max(256, int(env_max_tok)) if env_max_tok and env_max_tok.strip().isdigit() else DEFAULT_REASONING_MAX_TOKENS)
        )
        env_temp = os.environ.get("REASONING_TEMPERATURE")
        self.temperature = (
            float(temperature)
            if temperature is not None
            else (float(env_temp) if env_temp and env_temp.strip() else DEFAULT_REASONING_TEMPERATURE)
        )
        env_top_p = os.environ.get("REASONING_TOP_P")
        self.top_p = (
            float(top_p)
            if top_p is not None
            else (float(env_top_p) if env_top_p and env_top_p.strip() else DEFAULT_REASONING_TOP_P)
        )
        env_top_k = os.environ.get("REASONING_TOP_K")
        self.top_k = (
            int(top_k)
            if top_k is not None
            else (int(env_top_k) if env_top_k and env_top_k.strip().isdigit() else DEFAULT_REASONING_TOP_K)
        )
        env_rep_pen = os.environ.get("REASONING_REPETITION_PENALTY")
        self.repetition_penalty = (
            float(repetition_penalty)
            if repetition_penalty is not None
            else (float(env_rep_pen) if env_rep_pen and env_rep_pen.strip() else DEFAULT_REASONING_REPETITION_PENALTY)
        )
        env_rep_ctx = os.environ.get("REASONING_REPETITION_CONTEXT_SIZE")
        self.repetition_context_size = (
            max(16, int(repetition_context_size))
            if repetition_context_size is not None
            else (
                max(16, int(env_rep_ctx))
                if env_rep_ctx and env_rep_ctx.strip().isdigit()
                else DEFAULT_REASONING_REPETITION_CONTEXT_SIZE
            )
        )
        self.enable_thinking = enable_thinking

        self._model: Any = None
        self._tokenizer: Any = None
        self._llama_instance: Any = None

    def load_model_in_memory(self) -> None:
        """Charge le modèle de raisonnement en mémoire unifiée."""
        if self.backend == "mlx":
            if self._model is not None and self._tokenizer is not None:
                return
            import mlx_lm

            try:
                self._model, self._tokenizer = mlx_lm.load(self.repo_id)
            except Exception:
                from huggingface_hub import snapshot_download

                try:
                    local_snap = snapshot_download(self.repo_id, local_files_only=True)
                except Exception:
                    local_snap = snapshot_download(
                        "mlx-community/gemma-4-26b-a4b-it-4bit",
                        local_files_only=True,
                    )
                self._model, self._tokenizer = mlx_lm.load(local_snap)
        else:
            if self._llama_instance is not None:
                return
            from huggingface_hub import hf_hub_download
            from llama_cpp import Llama

            gguf_file = resolve_gguf_filename_for_repo(self.repo_id, self.intensity)
            if ":" in self.repo_id:
                repo_part, gguf_file = self.repo_id.split(":", 1)
            else:
                repo_part = self.repo_id

            if Path(self.repo_id).expanduser().is_file():
                model_path = str(Path(self.repo_id).expanduser().resolve())
            else:
                if not gguf_file:
                    gguf_file = "DeepSeek-R1-Distill-Qwen-14B-Q4_K_M.gguf"
                model_path = hf_hub_download(
                    repo_id=repo_part,
                    filename=gguf_file,
                    token=self.hf_token,
                )

            self._llama_instance = Llama(
                model_path=model_path,
                n_gpu_layers=-1,
                n_ctx=max(16384, self.max_tokens + 4096),
                n_batch=512,
                flash_attn=True,
                verbose=False,
            )

    def _build_static_record(self, bundle: FetchedCardBundle) -> ReasoningRecord:
        static_text = (
            f"Analyse déterministe immédiate pour {bundle.card_id} ({bundle.identity.nameFr}) : "
            "aucun slot d'effet textuel à traduire (0 slot IA)."
        )
        return ReasoningRecord(
            cardId=bundle.card_id,
            nameFr=bundle.identity.nameFr,
            nameEn=bundle.identity.nameEn,
            modelRepoId="STATIC_DETERMINISTIC",
            modelBackend=self.backend,
            reasoningText=static_text,
            rawThinkingProcess=None,
            createdAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=0,
            tokensPerSecond=0.0,
            generationDurationSeconds=0.0,
            timeToFirstTokenSeconds=0.0,
            finishReason="static",
            wasTruncated=False,
        )

    def _build_messages_and_prompt(
        self,
        bundle: FetchedCardBundle,
        skeleton: DeterministicCardSkeleton,
    ) -> Tuple[List[Dict[str, str]], str]:
        user_prompt = build_reasoning_prompt(bundle, skeleton=skeleton)
        messages = [
            {"role": "system", "content": REASONING_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]
        if self._tokenizer is None:
            return messages, f"{REASONING_SYSTEM_PROMPT}\n\n{user_prompt}\n"
        try:
            formatted = self._tokenizer.apply_chat_template(
                messages,
                tokenize=False,
                add_generation_prompt=True,
                enable_thinking=self.enable_thinking,
            )
        except TypeError:
            try:
                formatted = self._tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
            except Exception:
                formatted = f"{REASONING_SYSTEM_PROMPT}\n\n{user_prompt}\n"
        except Exception:
            formatted = f"{REASONING_SYSTEM_PROMPT}\n\n{user_prompt}\n"
        return messages, formatted

    def _finalize_record(
        self,
        bundle: FetchedCardBundle,
        raw_full_text: str,
        completion_tokens: int,
        tps: float,
        gen_duration: float,
        ttft: float,
        finish_reason: Optional[str],
    ) -> ReasoningRecord:
        thinking_part, explanation_part = _split_thinking_and_explanation(raw_full_text)
        was_truncated = detect_reasoning_truncation(raw_full_text, finish_reason)
        return ReasoningRecord(
            cardId=bundle.card_id,
            nameFr=bundle.identity.nameFr,
            nameEn=bundle.identity.nameEn,
            modelRepoId=self.repo_id,
            modelBackend=self.backend,
            reasoningText=explanation_part,
            rawThinkingProcess=thinking_part,
            createdAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=completion_tokens,
            tokensPerSecond=tps,
            generationDurationSeconds=round(gen_duration, 3),
            timeToFirstTokenSeconds=round(ttft, 3),
            finishReason=finish_reason,
            wasTruncated=was_truncated,
        )

    def generate_reasoning(
        self,
        bundle: FetchedCardBundle,
        on_token: Optional[Callable[[int, float], None]] = None,
    ) -> ReasoningRecord:
        """Exécute la Passe 1 de raisonnement sur une carte et retourne son `ReasoningRecord`."""
        from compiler.static_cards import is_basic_energy

        skeleton = build_deterministic_skeleton(bundle)

        # Court-circuit déterministe si Énergie de base ou aucun slot d'effet textuel (0 slot IA)
        if is_basic_energy(bundle) or not skeleton.slots_for_llm:
            return self._build_static_record(bundle)

        self.load_model_in_memory()
        messages, formatted_prompt = self._build_messages_and_prompt(bundle, skeleton)

        t0 = time.perf_counter()
        first_token_time: Optional[float] = None
        last_ui_update = t0
        token_count = 0
        chunks: List[str] = []
        finish_reason: Optional[str] = None

        if self.backend == "mlx":
            import mlx_lm

            sampler = build_mlx_sampler(
                temperature=self.temperature,
                top_p=self.top_p,
                top_k=self.top_k,
            )
            logits_processors = build_mlx_logits_processors(
                repetition_penalty=self.repetition_penalty,
                repetition_context_size=self.repetition_context_size,
            )
            stream_kwargs: Dict[str, Any] = {
                "prompt": formatted_prompt,
                "max_tokens": self.max_tokens,
                "sampler": sampler,
            }
            if logits_processors:
                stream_kwargs["logits_processors"] = logits_processors
            for response in mlx_lm.stream_generate(
                self._model,
                self._tokenizer,
                **stream_kwargs,
            ):
                piece = getattr(response, "text", "")
                resp_finish = getattr(response, "finish_reason", None)
                if isinstance(resp_finish, str):
                    finish_reason = resp_finish
                if piece:
                    now = time.perf_counter()
                    if first_token_time is None:
                        first_token_time = now
                    chunks.append(piece)
                    token_count = getattr(response, "generation_tokens", token_count + 1)
                    if on_token is not None and (now - last_ui_update) >= 0.5:
                        gen_elapsed = now - first_token_time
                        live_tps = token_count / gen_elapsed if gen_elapsed > 0.05 else 0.0
                        on_token(token_count, live_tps)
                        last_ui_update = now
        else:
            llama_kwargs: Dict[str, Any] = {
                "messages": messages,
                "temperature": self.temperature,
                "top_p": self.top_p,
                "top_k": self.top_k,
                "max_tokens": self.max_tokens,
                "stream": True,
                "chat_template_kwargs": {"enable_thinking": self.enable_thinking},
            }
            try:
                stream = self._llama_instance.create_chat_completion(**llama_kwargs)
            except TypeError:
                llama_kwargs.pop("chat_template_kwargs", None)
                try:
                    stream = self._llama_instance.create_chat_completion(**llama_kwargs)
                except TypeError:
                    llama_kwargs.pop("top_k", None)
                    llama_kwargs.pop("top_p", None)
                    stream = self._llama_instance.create_chat_completion(**llama_kwargs)

            for chunk in stream:
                choices = chunk.get("choices", [])
                if not choices:
                    continue
                if choices[0].get("finish_reason") is not None:
                    finish_reason = choices[0].get("finish_reason")
                delta = choices[0].get("delta", {})
                piece = delta.get("content") or delta.get("reasoning_content") or ""
                if piece:
                    now = time.perf_counter()
                    if first_token_time is None:
                        first_token_time = now
                    chunks.append(piece)
                    token_count += 1
                    if on_token is not None and (now - last_ui_update) >= 0.5:
                        gen_elapsed = now - first_token_time
                        live_tps = token_count / gen_elapsed if gen_elapsed > 0.05 else 0.0
                        on_token(token_count, live_tps)
                        last_ui_update = now

        t_end = time.perf_counter()
        total_elapsed = max(0.001, t_end - t0)
        ttft = (first_token_time - t0) if first_token_time is not None else total_elapsed
        gen_duration = (t_end - first_token_time) if first_token_time is not None else total_elapsed
        tps = round(token_count / gen_duration, 2) if gen_duration > 0 and token_count > 0 else 0.0

        if on_token is not None and token_count > 0:
            on_token(token_count, tps)

        return self._finalize_record(
            bundle=bundle,
            raw_full_text="".join(chunks),
            completion_tokens=token_count,
            tps=tps,
            gen_duration=gen_duration,
            ttft=ttft,
            finish_reason=finish_reason,
        )

    def generate_reasoning_batch(
        self,
        bundles: Sequence[FetchedCardBundle],
        batch_size: Optional[int] = None,
        on_card_done: Optional[Callable[[ReasoningRecord], None]] = None,
    ) -> Tuple[List[ReasoningRecord], Dict[str, Any]]:
        """Exécute la Passe 1 en parallèle continu (batching MLX) ou séquentiel si repli."""
        from compiler.static_cards import is_basic_energy

        if not bundles:
            return [], {"batch_tps": 0.0, "generation_tokens": 0, "wall_seconds": 0.0, "peak_memory_gb": 0.0}

        eff_batch = resolve_mlx_batch_size(batch_size)
        ordered_records: List[Optional[ReasoningRecord]] = [None] * len(bundles)
        pending_llm: List[Tuple[int, FetchedCardBundle, DeterministicCardSkeleton]] = []

        for idx, b in enumerate(bundles):
            sk = build_deterministic_skeleton(b)
            if is_basic_energy(b) or not sk.slots_for_llm:
                rec = self._build_static_record(b)
                ordered_records[idx] = rec
                if on_card_done is not None:
                    on_card_done(rec)
            else:
                pending_llm.append((idx, b, sk))

        if not pending_llm:
            return [r for r in ordered_records if r is not None], {
                "batch_tps": 0.0,
                "generation_tokens": 0,
                "wall_seconds": 0.0,
                "peak_memory_gb": 0.0,
            }

        if self.backend != "mlx" or eff_batch <= 1 or len(pending_llm) <= 1:
            t_seq0 = time.perf_counter()
            total_toks = 0
            for idx, b, _ in pending_llm:
                rec = self.generate_reasoning(b)
                ordered_records[idx] = rec
                total_toks += rec.completionTokens
                if on_card_done is not None:
                    on_card_done(rec)
            wall_s = max(0.001, time.perf_counter() - t_seq0)
            return [r for r in ordered_records if r is not None], {
                "batch_tps": round(total_toks / wall_s, 2) if total_toks > 0 else 0.0,
                "generation_tokens": total_toks,
                "wall_seconds": round(wall_s, 3),
                "peak_memory_gb": 0.0,
            }

        self.load_model_in_memory()
        sampler = build_mlx_sampler(
            temperature=self.temperature,
            top_p=self.top_p,
            top_k=self.top_k,
        )
        logits_processors = build_mlx_logits_processors(
            repetition_penalty=self.repetition_penalty,
            repetition_context_size=self.repetition_context_size,
        )

        # Traitement par vagues pour checkpointing régulier et stabilité mémoire Metal
        chunk_size = max(eff_batch * 8, 32)
        total_toks = 0
        total_wall = 0.0
        total_gen_time = 0.0
        peak_mem = 0.0

        for start in range(0, len(pending_llm), chunk_size):
            chunk = pending_llm[start : start + chunk_size]
            prompts_tokens: List[List[int]] = []
            for _, b, sk in chunk:
                _, formatted = self._build_messages_and_prompt(b, sk)
                prompts_tokens.append(encode_prompt_tokens(self._tokenizer, formatted))

            def handle_item(item_res: Any, local_chunk: List[Tuple[int, FetchedCardBundle, DeterministicCardSkeleton]] = chunk) -> None:
                orig_idx, target_b, _ = local_chunk[item_res.index]
                rec = self._finalize_record(
                    bundle=target_b,
                    raw_full_text=item_res.text,
                    completion_tokens=item_res.completion_tokens,
                    tps=item_res.tokens_per_second,
                    gen_duration=item_res.generation_duration_seconds,
                    ttft=item_res.time_to_first_token_seconds,
                    finish_reason=item_res.finish_reason,
                )
                ordered_records[orig_idx] = rec
                if on_card_done is not None:
                    on_card_done(rec)

            _, chunk_stats = run_mlx_continuous_batch(
                model=self._model,
                tokenizer=self._tokenizer,
                prompts_tokens=prompts_tokens,
                max_tokens=self.max_tokens,
                sampler=sampler,
                batch_size=eff_batch,
                on_item_complete=handle_item,
                logits_processors=logits_processors,
            )
            total_toks += chunk_stats.generation_tokens
            total_wall += chunk_stats.wall_seconds
            if chunk_stats.generation_tps > 0 and chunk_stats.generation_tokens > 0:
                total_gen_time += chunk_stats.generation_tokens / chunk_stats.generation_tps
            else:
                total_gen_time += chunk_stats.wall_seconds
            peak_mem = max(peak_mem, chunk_stats.peak_memory_gb)
            clear_mlx_memory_cache()

        agg_tps = round(total_toks / total_gen_time, 2) if total_gen_time > 0 and total_toks > 0 else 0.0
        return [r for r in ordered_records if r is not None], {
            "batch_tps": agg_tps,
            "generation_tokens": total_toks,
            "wall_seconds": round(total_wall, 3),
            "peak_memory_gb": peak_mem,
        }

    def close(self) -> None:
        """Décharge strictement et intégralement le modèle de la RAM/VRAM."""
        if self._model is not None:
            del self._model
            self._model = None
        if self._tokenizer is not None:
            del self._tokenizer
            self._tokenizer = None
        if self._llama_instance is not None:
            try:
                if hasattr(self._llama_instance, "close"):
                    self._llama_instance.close()
            except Exception:
                pass
            del self._llama_instance
            self._llama_instance = None

        clear_mlx_memory_cache()
