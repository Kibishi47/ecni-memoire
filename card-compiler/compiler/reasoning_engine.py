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

import gc
import json
import re
import time
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Union

from compiler import load_env_file
from compiler.deterministic_builder import (
    DeterministicCardSkeleton,
    build_deterministic_skeleton,
)
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
    normalize_intensity_mode,
    resolve_gguf_filename_for_repo,
    resolve_model_for_configuration,
)
from compiler.tcgdex_fetcher import FetchedCardBundle


REASONING_SYSTEM_PROMPT = """Tu es un Juge Officiel Pokémon TCG (Professeur Pokémon) et un expert en modélisation de moteur de jeu par IA.

TA MISSION (PASSE 1 - ANALYSE CIBLÉE DES SLOTS D'EFFETS ET STRATÉGIE) :
Python a DÉJÀ construit de façon 100 % déterministe l'identité de la carte, ses statistiques, ses coûts d'énergie, ses timings (`USE_ABILITY`, `TRIGGERED_ABILITY`, `PASSIVE_ABILITY`, `ATTACK`, etc.) et les dégâts numériques de base de ses attaques.
Tu ne dois analyser QUE les slots textuels fournis (`slots_for_llm`) et le profil stratégique de la carte.

Pour chaque `slotId` fourni en entrée, détaille de manière concise et chirurgicale :
1. **Préconditions (`preconditions`)** :
   Conditions requises pour activer ce slot parmi le vocabulaire fermé :
   `SELF_IS_ACTIVE`, `SELF_ON_BENCH`, `SELF_IS_IN_HAND`, `BENCH_HAS_EMPTY_SLOT`, `BENCH_HAS_POKEMON`, `OPPONENT_HAS_BENCHED_POKEMON`, `TARGET_IN_PLAY_SINCE_PREVIOUS_TURN`, `NOT_FIRST_TURN`, `ON_EVOLVE_FROM_HAND`, `ON_PLAY_FROM_HAND_TO_BENCH`, `KO_SUFFERED_LAST_TURN`, `PLAYER_BEHIND_ON_PRIZES`, `HAND_MIN_OTHER_CARDS:<N>`, `SELF_HAS_ENERGY`, `IN_PLAY:<Nom>`.
2. **Séquence d'effets atomiques (`effects`)** :
   Traduis fidèlement chaque effet (y compris lancers de pièce, scaling `+`/`×`, marqueurs de dégâts, dégâts de recul sur `SELF`, verrous au tour suivant, modificateurs passifs) avec les primitives officielles :
   `SEARCH_DECK`, `DRAW_CARDS`, `DAMAGE_ACTIVE`, `DAMAGE_BENCH`, `ATTACH_ENERGY`, `DISCARD_CARDS`, `HEAL`, `SWITCH_ACTIVE`, `APPLY_SPECIAL_CONDITION`, `EVOLVE_POKEMON`, `SHUFFLE_HAND_DRAW`, `RECOVER_FROM_DISCARD`, `PLACE_DAMAGE_COUNTERS`, `MOVE_DAMAGE_COUNTERS`, `MOVE_ENERGY`, `MODIFY_DAMAGE_TAKEN`, `MODIFY_DAMAGE_DEALT`, `MODIFY_HP`, `MODIFY_RETREAT_COST`, `PREVENT_DAMAGE_OR_EFFECTS`, `LOCK_NEXT_TURN_ATTACK`, `LOCK_RETREAT`, `LOCK_ABILITIES`, `LOCK_ITEMS`, `EXPAND_BENCH`, `KNOCK_OUT`, `MILL_DECK`, `TAKE_EXTRA_PRIZE`, `PUT_ON_TOP_OR_BOTTOM_OF_DECK`.
   Attention : « Cherchez dans votre deck... » = `SEARCH_DECK` (JAMAIS `DRAW_CARDS`).
   Précise selon le cas :
   - `target` (`SELF`, `OPPONENT_ACTIVE`, `OPPONENT_BENCH_SINGLE`, `OPPONENT_BENCH_ALL`, `OPPONENT_POKEMON_ANY`, `OPPONENT_ALL_POKEMON`, `OWN_ACTIVE`, `OWN_BENCH_SINGLE`, `OWN_BENCH_ALL`, `OWN_POKEMON_ANY`, `OWN_ALL_POKEMON`, `ALL_POKEMON_IN_PLAY`, `PLAYER`, `OPPONENT`),
   - `sourceZone` / `destinationZone` / `zone` (`DECK`, `TOP_OF_DECK`, `BOTTOM_OF_DECK`, `HAND`, `DISCARD`, `BENCH`, `ACTIVE`, `PRIZES`, `LOST_ZONE`, `ATTACHED_CARDS`),
   - `specialCondition` si `APPLY_SPECIAL_CONDITION` (`POISONED`, `BURNED`, `ASLEEP`, `PARALYZED`, `CONFUSED`),
   - `coinFlipMode` (`SINGLE_HEADS_REQUIRED`, `SINGLE_HEADS_BONUS`, `MULTI_COIN_PER_HEADS`, `UNTIL_TAILS_PER_HEADS`, `TWO_TAILS_SELF_DAMAGE`) + `coinCount`,
   - `scalingOperator` (`ADD`, `MULTIPLY`) + `scalingMetric` + `bonusValue`,
   - `filter`, `value`, `count`, `upTo`, `optional`.
3. **Condition de carte morte (`deadCardCondition`)** :
   INVERSE logique de `preconditions` : la situation où l'action/carte est INUTILISABLE (ex: `NO_KO_SUFFERED_LAST_TURN` si précondition = `KO_SUFFERED_LAST_TURN`, `NOT_BEHIND_ON_PRIZES`, `BENCH_FULL`, `OPPONENT_BENCH_EMPTY`, `NO_VALID_TARGET_IN_DECK`, `SELF_NOT_ACTIVE`, `NO_STAGE_2_IN_HAND_OR_NO_BASIC_IN_PLAY`, ou `null`).
4. **Évaluation Stratégique (`strategicEvaluator`)** :
   - `aiRole` parmi : `MAIN_ATTACKER`, `SECONDARY_ATTACKER`, `DRAW_ENGINE`, `ENERGY_ACCELERATOR`, `GUEST_TECH`, `DISRUPTION`, `CONSISTENCY_BOOSTER` (les Dresseurs/Énergies et pré-évolutions de Base <= 70 PV ne sont jamais `MAIN_ATTACKER`).
   - `turnPhaseWeights` : 4 poids flottants réalistes entre `0.0` et `1.0` (`turn1`, `turn2`, `turn3`, `turn4Plus`) adaptés au stade/coût/rôle.
   - `additionalSynergyTags` : uniquement tags `requires_*` normalisés (`requires_stage_2_pokemon`, `requires_basic_hp_lte_70`, `requires_tera_pokemon`, `requires_ancient_pokemon`, `requires_future_pokemon`, `requires_discard_synergy`).

Sois direct, concis et structuré slot par slot."""


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

    return (
        "Voici le résumé déterministe de la carte et la liste stricte des slots d'effets à analyser :\n\n"
        + "\n".join(summary_lines)
        + "\n\nSLOTS À ANALYSER (`slots_for_llm`) :\n"
        + f"```json\n{slots_json}\n```\n\n"
        + "Analyse chaque slot (`preconditions`, `effects`, `deadCardCondition`) ainsi que le profil stratégique (`aiRole`, `turnPhaseWeights` entre 0.0 et 1.0, `additionalSynergyTags`)."
    )


def _split_thinking_and_explanation(raw_text: str) -> tuple[Optional[str], str]:
    """Sépare le bloc `<think>...</think>` éventuel de l'explication finale."""
    if not raw_text:
        return None, ""
    m = re.search(r"<think>(.*?)</think>", raw_text, flags=re.DOTALL | re.IGNORECASE)
    if m:
        thinking = m.group(1).strip()
        explanation = re.sub(r"<think>.*?</think>", "", raw_text, flags=re.DOTALL | re.IGNORECASE).strip()
        if not explanation:
            explanation = thinking
        return thinking, explanation

    if "</think>" in raw_text:
        parts = raw_text.split("</think>", 1)
        thinking = parts[0].replace("<think>", "").strip()
        explanation = parts[1].strip()
        return thinking, explanation or thinking

    return None, raw_text.strip()


class ReasoningEngine:
    """Moteur d'exécution de la Passe 1 (Raisonnement) supportant Apple MLX et llama.cpp GGUF."""

    def __init__(
        self,
        model: Optional[str] = None,
        intensity: Optional[Union[IntensityMode, str]] = None,
        backend: Optional[str] = None,
        hf_token: Optional[str] = None,
        max_tokens: int = 800,
        temperature: float = 0.2,
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
        self.max_tokens = max_tokens
        self.temperature = temperature

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
                        "mlx-community/DeepSeek-R1-Distill-Qwen-14B-8bit",
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
                n_ctx=8192,
                n_batch=512,
                flash_attn=True,
                verbose=False,
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
            )

        self.load_model_in_memory()
        user_prompt = build_reasoning_prompt(bundle, skeleton=skeleton)
        messages = [
            {"role": "system", "content": REASONING_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        t0 = time.perf_counter()
        first_token_time: Optional[float] = None
        last_ui_update = t0
        token_count = 0
        chunks: List[str] = []

        if self.backend == "mlx":
            import mlx_lm
            from mlx_lm.sample_utils import make_sampler

            try:
                formatted_prompt = self._tokenizer.apply_chat_template(
                    messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
            except Exception:
                formatted_prompt = f"{REASONING_SYSTEM_PROMPT}\n\n{user_prompt}\n"

            sampler = make_sampler(temp=self.temperature)
            for response in mlx_lm.stream_generate(
                self._model,
                self._tokenizer,
                prompt=formatted_prompt,
                max_tokens=self.max_tokens,
                sampler=sampler,
            ):
                piece = getattr(response, "text", "")
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
            stream = self._llama_instance.create_chat_completion(
                messages=messages,
                temperature=self.temperature,
                max_tokens=self.max_tokens,
                stream=True,
            )
            for chunk in stream:
                choices = chunk.get("choices", [])
                if not choices:
                    continue
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

        raw_full_text = "".join(chunks)
        thinking_part, explanation_part = _split_thinking_and_explanation(raw_full_text)

        return ReasoningRecord(
            cardId=bundle.card_id,
            nameFr=bundle.identity.nameFr,
            nameEn=bundle.identity.nameEn,
            modelRepoId=self.repo_id,
            modelBackend=self.backend,
            reasoningText=explanation_part,
            rawThinkingProcess=thinking_part,
            createdAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=token_count,
            tokensPerSecond=tps,
            generationDurationSeconds=round(gen_duration, 3),
            timeToFirstTokenSeconds=round(ttft, 3),
        )

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

        gc.collect()
        try:
            import mlx.core as mx

            if hasattr(mx, "clear_cache"):
                mx.clear_cache()
            elif hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
                mx.metal.clear_cache()
        except Exception:
            pass
