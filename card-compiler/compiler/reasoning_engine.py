"""Moteur de raisonnement approfondi (Passe 1 du pipeline Two-Pass) pour Pokémon TCG Card Compiler.

Ce module :
1. Charge une IA de raisonnement (ex: DeepSeek-R1 Distill Qwen 14B) en mémoire via Apple MLX ou llama.cpp.
2. Analyse exhaustivement les règles officielles TCGdex d'une carte Pokémon et génère
   une fiche technique textuelle complète expliquant le fonctionnement exact de la carte.
3. Sauvegarde chaque analyse dans `data/reasoning_texts/{card_id}.json`.
4. Décharge complètement l'IA de la mémoire (RAM / Metal) dès la fin du traitement
   du lot pour permettre le chargement ultérieur de l'IA de coding (Passe 2).
"""

from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from pydantic import BaseModel, Field

from compiler import load_env_file
from compiler.models_config import (
    IntensityMode,
    PipelineMode,
    PipelinePhase,
    normalize_intensity_mode,
    resolve_model_for_configuration,
)
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle

REASONING_SYSTEM_PROMPT = """Tu es un grand maître et théoricien expert des règles officielles du Jeu de Cartes à Collectionner Pokémon (Pokémon TCG - Format Standard).
Ta mission est d'analyser en profondeur une carte Pokémon à partir de ses données officielles TCGdex et d'en expliquer de manière exhaustive, structurée et algorithmique le fonctionnement exact.
Ton analyse servira de spécification technique intégrale pour qu'un compilateur génère le modèle formel exécutable du moteur de jeu.

Structure impérativement ton explication selon ces 5 axes :

1. IDENTIFICATION & TYPOLOGIE :
   - Catégorie (POKEMON, TRAINER, ENERGY) et Sous-catégorie exacte (BASIC, STAGE_1, STAGE_2, ITEM, SUPPORTER, STADIUM, TOOL, SPECIAL_ENERGY).
   - Rôle stratégique principal (ex: MAIN_ATTACKER, BENCH_SNIPER, DRAW_ENGINE, ENERGY_ACCELERATOR, HAND_DISRUPTION, CONSISTENCY_TUTOR, GUEST_ATTACKER, TANK, WALL).

2. ANALYSE EXHAUSTIVE DES ACTIONS JOUABLES :
   - Pour chaque Talent (Ability) et chaque Attaque (Attack), ou action Dresseur :
     * Libellé exact et type de source (ATTACK, ABILITY_ACTIVATED, ABILITY_ON_EVOLVE, ABILITY_PASSIVE, TRAINER_PLAY, etc.).
     * Timing d'exécution (END_OF_TURN_ATTACK, ONCE_PER_TURN_ABILITY, ON_EVOLVE_TRIGGER, ONCE_PER_TURN_SUPPORTER, etc.).
     * Restrictions d'activation du Tour 1 (canUseTurn1GoingFirst, canUseTurn1GoingSecond). Rappel : les Supporters et la majorité des Attaques sont interdits au Tour 1 joueur 1.
     * Coûts d'activation précis (énergies requises, défausse de cartes depuis la main `DISCARD_FROM_HAND`, défausse d'énergies en jeu `DISCARD_ENERGY_FROM_PLAY`, etc.).
     * Préconditions strictes (présence en Actif `SELF_IS_ACTIVE`, place sur le banc `BENCH_HAS_EMPTY_SLOTS`, cartes cibles requises dans une zone, etc.).
     * Effets atomiques décomposés : dégâts de base, dégâts conditionnels, recherche dans le deck vers main/banc avec filtres précis, pioche, switch, statuts spéciaux.

3. FILTRES EXACTS ET CRITÈRES DE CIBLAGE :
   - Précise tous les filtres de cartes ciblées par la carte (ex: 'Pokémon de base avec 70 PV ou moins' pour Poffin, 'Énergie de base Feu' pour Dracaufeu, 'Outil Pokémon' pour Pepper).
   - Attention aux symboles d'énergie : {R}=Feu, {L}=Électrique, {F}=Combat, {W}=Eau, {G}=Plante, {P}=Psy, {D}=Obscurité, {M}=Métal, {C}=Incolore.

4. SYNERGIES DE DECKLIST & CONDITIONS DE CARTE MORTE :
   - Cartes ou types indispensables dans la decklist pour rendre cette carte efficace (synergies).
   - Circonstances exactes où la carte devient totalement morte / injouable pendant la partie (ex: plus de cibles valides dans le deck, banc saturé, absence d'énergie).

5. PONDÉRATIONS STRATÉGIQUES PAR PHASE :
   - Valeur relative de la carte du Tour 1 au Tour 4+ (poids recommandés entre 0.0 et 2.0).

RÈGLE D'OR : Reste factuel, rigoureux et base-toi STRICTEMENT sur le texte officiel de la carte. N'invente JAMAIS de talent ou d'effet qui ne figure pas dans les données brutes."""


def build_reasoning_prompt(bundle: FetchedCardBundle) -> str:
    """Construit le prompt utilisateur pour l'étape de raisonnement."""
    identity = bundle.identity
    pstats = bundle.pokemon_stats

    payload: Dict[str, Any] = {
        "cardId": identity.cardId,
        "nameFr": identity.nameFr,
        "nameEn": identity.nameEn,
        "category": identity.category.value,
        "subCategory": identity.subCategory.value,
        "setId": identity.setId,
        "localId": identity.localId,
    }

    if pstats:
        payload["pokemonStats"] = {
            "hp": pstats.hp,
            "types": pstats.types,
            "stage": pstats.stage,
            "evolvesFrom": pstats.evolvesFrom,
            "rootBasicName": pstats.rootBasicName,
            "evolutionChain": pstats.evolutionChain,
            "retreatCost": pstats.retreatCost,
            "weaknesses": pstats.weaknesses,
            "resistances": pstats.resistances,
            "prizeCardsGiven": pstats.prizeCardsGiven,
            "isRuleBox": pstats.isRuleBox,
            "hasAbility": pstats.hasAbility,
        }

    if bundle.raw_fr.get("abilities"):
        payload["abilitiesFr"] = bundle.raw_fr.get("abilities")
    if bundle.raw_en and bundle.raw_en.get("abilities"):
        payload["abilitiesEn"] = bundle.raw_en.get("abilities")
    if bundle.raw_fr.get("attacks"):
        payload["attacksFr"] = bundle.raw_fr.get("attacks")
    if bundle.raw_en and bundle.raw_en.get("attacks"):
        payload["attacksEn"] = bundle.raw_en.get("attacks")
    if bundle.raw_fr.get("effect"):
        payload["effectFr"] = bundle.raw_fr.get("effect")
    if bundle.raw_en and bundle.raw_en.get("effect"):
        payload["effectEn"] = bundle.raw_en.get("effect")

    return (
        f"Analyse en profondeur la carte Pokémon TCG '{identity.nameFr}' ({identity.cardId}) "
        "selon la méthode en 5 points spécifiée.\n\n"
        "DONNÉES OFFICIELLES TCGDEX :\n"
        f"```json\n{json.dumps(payload, ensure_ascii=False, indent=2)}\n```\n\n"
        "Rédige une fiche d'analyse technique complète expliquant comment la carte fonctionne "
        "et tout ce dont nous avons besoin pour la compiler en modèle formel de simulation."
    )


class ReasoningRecord(BaseModel):
    """Enregistrement persisté de l'analyse textuelle d'une carte."""

    cardId: str = Field(description="Identifiant unique de la carte (ex: sv08.5-001)")
    nameFr: str = Field(description="Nom français de la carte")
    nameEn: Optional[str] = Field(default=None, description="Nom anglais")
    modelRepoId: str = Field(description="Identifiant du modèle de raisonnement utilisé")
    modelBackend: str = Field(description="Backend utilisé (mlx ou llama_cpp)")
    reasoningText: str = Field(description="Texte complet d'explication généré par l'IA")
    createdAtIso: str = Field(description="Horodatage ISO de création")
    completionTokens: Optional[int] = Field(default=None, description="Tokens générés")
    tokensPerSecond: Optional[float] = Field(default=None, description="Débit moyen en tokens/s")
    generationDurationSeconds: Optional[float] = Field(default=None, description="Durée de génération en secondes")


def get_reasoning_texts_dir(data_dir: Path) -> Path:
    """Retourne et crée si nécessaire le dossier `data/reasoning_texts/`."""
    reason_dir = data_dir / "reasoning_texts"
    reason_dir.mkdir(parents=True, exist_ok=True)
    return reason_dir


def save_reasoning_record(record: ReasoningRecord, data_dir: Path) -> Path:
    """Sauvegarde le résultat de raisonnement dans `data/reasoning_texts/{card_id}.json`."""
    out_dir = get_reasoning_texts_dir(data_dir)
    file_path = out_dir / f"{record.cardId}.json"
    file_path.write_text(
        json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return file_path


def load_reasoning_record(card_id: str, data_dir: Path) -> Optional[ReasoningRecord]:
    """Charge l'analyse de raisonnement existante pour une carte, si présente."""
    out_dir = get_reasoning_texts_dir(data_dir)
    file_path = out_dir / f"{card_id}.json"
    if not file_path.exists():
        return None
    try:
        data = json.loads(file_path.read_text(encoding="utf-8"))
        return ReasoningRecord.model_validate(data)
    except Exception:
        return None


def has_reasoning_record(card_id: str, data_dir: Path) -> bool:
    """Vérifie si une analyse de raisonnement valide existe pour la carte."""
    return load_reasoning_record(card_id, data_dir) is not None


class ReasoningEngine:
    """Moteur dédié à l'exécution de la Passe 1 (Génération de raisonnement textuel)."""

    def __init__(
        self,
        model: Optional[str] = None,
        intensity: Optional[Union[IntensityMode, str]] = None,
        backend: Optional[str] = None,
        hf_token: Optional[str] = None,
    ) -> None:
        load_env_file()
        self.intensity = normalize_intensity_mode(intensity or os.environ.get("INTENSITY_MODE"))
        raw_b = (backend or os.environ.get("LOCAL_BACKEND") or "mlx").strip().lower()
        self.backend = "mlx" if raw_b == "mlx" else "llama_cpp"
        self.hf_token = hf_token or os.environ.get("HF_TOKEN") or os.environ.get("HUGGING_FACE_HUB_TOKEN")

        self.repo_id = resolve_model_for_configuration(
            pipeline_mode=PipelineMode.two_pass,
            intensity=self.intensity,
            phase=PipelinePhase.reason,
            backend=self.backend,
            explicit_model=model,
        )

        self._model = None
        self._tokenizer = None
        self._llm = None

    def load_model_in_memory(self) -> None:
        """Charge le modèle de raisonnement en mémoire unifiée (Apple MLX ou llama.cpp)."""
        if self.backend == "mlx":
            if self._model is not None and self._tokenizer is not None:
                return
            import mlx_lm
            self._model, self._tokenizer = mlx_lm.load(
                self.repo_id,
                tokenizer_config={"trust_remote_code": True},
            )
        else:
            if self._llm is not None:
                return
            from llama_cpp import Llama
            from compiler.llm_engine import resolve_gguf_from_spec
            r_id, f_name, local_p = resolve_gguf_from_spec(self.repo_id, hf_token=self.hf_token)
            if local_p is not None and local_p.exists():
                m_path = str(local_p)
            else:
                from huggingface_hub import hf_hub_download
                m_path = hf_hub_download(repo_id=r_id, filename=f_name, token=self.hf_token)

            self._llm = Llama(
                model_path=m_path,
                n_ctx=16384,
                n_gpu_layers=-1,
                verbose=False,
            )

    def generate_reasoning(
        self,
        bundle: FetchedCardBundle,
        max_tokens: int = 4096,
        temperature: float = 0.6,
        on_token: Optional[Callable[[int, float], None]] = None,
    ) -> ReasoningRecord:
        """Génère l'analyse de raisonnement textuelle complète pour une carte Pokémon."""
        if is_basic_energy(bundle):
            # Synthèse instantanée pour les énergies de base
            text = (
                f"### ANALYSE DE CARTE ÉNERGIE DE BASE : {bundle.identity.nameFr}\n"
                f"- Catégorie : ENERGY (BASIC_ENERGY)\n"
                "- Fonction : Fournit 1 énergie du type correspondant lorsqu'elle est attachée à un Pokémon.\n"
                "- Règle : Règle standard de 1 attachement d'énergie par tour depuis la main.\n"
                "- Compilation formelle : Traitée par court-circuit déterministe."
            )
            return ReasoningRecord(
                cardId=bundle.card_id,
                nameFr=bundle.identity.nameFr,
                nameEn=bundle.identity.nameEn,
                modelRepoId="static_engine",
                modelBackend="static",
                reasoningText=text,
                createdAtIso=datetime.now(timezone.utc).isoformat(),
                completionTokens=0,
                tokensPerSecond=0.0,
                generationDurationSeconds=0.0,
            )

        self.load_model_in_memory()

        user_prompt = build_reasoning_prompt(bundle)
        messages = [
            {"role": "system", "content": REASONING_SYSTEM_PROMPT},
            {"role": "user", "content": user_prompt},
        ]

        t0 = time.perf_counter()
        accumulated_text: List[str] = []
        token_count = 0
        live_tps = 0.0
        first_token_time: Optional[float] = None
        last_token_time: Optional[float] = None
        window_start_time: Optional[float] = None
        window_start_tokens = 0
        last_cb_time = 0.0

        if self.backend == "mlx":
            import mlx_lm
            from mlx_lm.sample_utils import make_sampler

            try:
                prompt_text = self._tokenizer.apply_chat_template(
                    messages, tokenize=False, add_generation_prompt=True
                )
            except Exception:
                prompt_text = f"System: {REASONING_SYSTEM_PROMPT}\nUser: {user_prompt}\nAssistant:"

            sampler = make_sampler(temp=temperature)
            gen_stream = mlx_lm.stream_generate(
                self._model,
                self._tokenizer,
                prompt=prompt_text,
                max_tokens=max_tokens,
                sampler=sampler,
            )

            for chunk in gen_stream:
                if chunk.text:
                    accumulated_text.append(chunk.text)
                token_count = chunk.generation_tokens
                now = time.perf_counter()

                if first_token_time is None and token_count > 0:
                    first_token_time = now
                    window_start_time = now
                    window_start_tokens = token_count
                last_token_time = now

                if window_start_time is not None:
                    window_elapsed = now - window_start_time
                    if window_elapsed >= 1.0:
                        delta_tokens = max(0, token_count - window_start_tokens)
                        live_tps = round(delta_tokens / max(0.0001, window_elapsed), 1)
                        window_start_time = now
                        window_start_tokens = token_count

                if on_token:
                    if (now - last_cb_time >= 0.05) or (token_count == 2 and last_cb_time == 0.0):
                        on_token(token_count, live_tps)
                        last_cb_time = now

        else:
            # llama.cpp stream
            stream_gen = self._llm.create_chat_completion(
                messages=messages,
                max_tokens=max_tokens,
                temperature=temperature,
                stream=True,
            )
            for chunk in stream_gen:
                delta = chunk.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content") or ""
                if content:
                    accumulated_text.append(content)
                    token_count += 1
                now = time.perf_counter()

                if first_token_time is None and token_count > 0:
                    first_token_time = now
                    window_start_time = now
                    window_start_tokens = token_count
                last_token_time = now

                if window_start_time is not None:
                    window_elapsed = now - window_start_time
                    if window_elapsed >= 1.0:
                        delta_tokens = max(0, token_count - window_start_tokens)
                        live_tps = round(delta_tokens / max(0.0001, window_elapsed), 1)
                        window_start_time = now
                        window_start_tokens = token_count

                if on_token:
                    if (now - last_cb_time >= 0.05) or (token_count == 2 and last_cb_time == 0.0):
                        on_token(token_count, live_tps)
                        last_cb_time = now

        total_elapsed = max(0.001, round(time.perf_counter() - t0, 3))
        raw_output = "".join(accumulated_text)

        final_tps = live_tps
        if first_token_time is not None and token_count > 1:
            gen_elapsed = max(0.0001, (last_token_time or time.perf_counter()) - first_token_time)
            final_tps = round((token_count - 1) / gen_elapsed, 1)

        if on_token and token_count > 0:
            on_token(token_count, final_tps)

        return ReasoningRecord(
            cardId=bundle.card_id,
            nameFr=bundle.identity.nameFr,
            nameEn=bundle.identity.nameEn,
            modelRepoId=self.repo_id,
            modelBackend=self.backend,
            reasoningText=raw_output,
            createdAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=token_count,
            tokensPerSecond=final_tps,
            generationDurationSeconds=total_elapsed,
        )

    def close(self) -> None:
        """Libère rigoureusement le modèle et toute la mémoire associée."""
        self._model = None
        self._tokenizer = None
        self._llm = None

        import gc
        gc.collect()

        if self.backend == "mlx":
            try:
                import mlx.core as mx
                if hasattr(mx, "clear_cache"):
                    mx.clear_cache()
                elif hasattr(mx, "metal") and hasattr(mx.metal, "clear_cache"):
                    mx.metal.clear_cache()
            except Exception:
                pass
