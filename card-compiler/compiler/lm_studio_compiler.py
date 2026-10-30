"""Fournisseur LLM pour LM Studio (local ou distant via tunnel SSH).

Ce module permet d'exécuter l'inférence du compilateur de cartes Pokémon TCG
sur une machine distante équipée de LM Studio et pilotée via `lms` (LM Studio CLI),
tout en conservant l'intégralité des données, caches et fichiers générés
(`data/compiled_cards/`, `data/cards_database.json`) sur la machine locale.
"""

from __future__ import annotations

import atexit
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import httpx

from compiler import load_env_file
from compiler.llm_engine import ModelTier
from compiler.post_processor import sanitize_and_enrich_card
from compiler.schemas import (
    CompilationMetadata,
    EngineCardModel,
    LLMCompiledCardPart,
)
from compiler.static_cards import build_basic_energy_model, is_basic_energy
from compiler.tcgdex_fetcher import FetchedCardBundle


def find_available_port(start_port: int = 12345, max_attempts: int = 50) -> int:
    """Trouve un port TCP local disponible pour le tunnel SSH."""
    for port in range(start_port, start_port + max_attempts):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return start_port


def _find_sshpass() -> Optional[str]:
    """Recherche l'exécutable `sshpass` dans le PATH ou les répertoires standards macOS / Linux."""
    found = shutil.which("sshpass")
    if found:
        return found
    for fallback in [
        "/opt/homebrew/bin/sshpass",
        "/usr/local/bin/sshpass",
        "/usr/bin/sshpass",
    ]:
        if os.path.isfile(fallback) and os.access(fallback, os.X_OK):
            return fallback
    return None


# Modèle puissant configuré par défaut en mode normal pour la machine distante (GPU dédié)
DEFAULT_REMOTE_NORMAL_MODEL = "Qwen3.8-27B"

LM_STUDIO_TIER_MODELS: Dict[ModelTier, str] = {
    ModelTier.qwen3: "Qwen3.8-27B",
    ModelTier.max: "Qwen3-30B-A3B",
    ModelTier.fast: "Qwen2.5-Coder-7B-Instruct",
}


class LMStudioCardCompiler:
    """Compilateur de cartes s'appuyant sur l'API OpenAI-compatible de LM Studio (local ou via SSH)."""

    def __init__(
        self,
        ssh_host: Optional[str] = None,
        ssh_port: Optional[int] = None,
        ssh_user: Optional[str] = None,
        ssh_key_path: Optional[str] = None,
        ssh_password: Optional[str] = None,
        remote_port: Optional[int] = None,
        local_port: Optional[int] = None,
        use_tunnel: Optional[bool] = None,
        model_name: Optional[str] = None,
        cli_path: Optional[str] = None,
        auto_start: Optional[bool] = None,
        timeout_seconds: float = 180.0,
        tier: ModelTier = ModelTier.qwen3,
    ) -> None:
        load_env_file()

        self.tier = tier

        # 1. Configuration SSH
        self.ssh_host = ssh_host or os.environ.get("SSH_HOST") or None
        self.ssh_port = int(ssh_port or os.environ.get("SSH_PORT") or 22)
        self.ssh_user = ssh_user or os.environ.get("SSH_USER") or None
        self.ssh_key_path = ssh_key_path or os.environ.get("SSH_KEY_PATH") or None
        self.ssh_password = ssh_password or os.environ.get("SSH_PASSWORD") or None
        self._askpass_file: Optional[str] = None

        # 2. Configuration LM Studio
        self.remote_port = int(remote_port or os.environ.get("LM_STUDIO_PORT") or 1234)
        configured_local_port = int(local_port or os.environ.get("LM_STUDIO_LOCAL_PORT") or 12345)
        self.local_port = find_available_port(configured_local_port)

        env_tunnel = os.environ.get("LM_STUDIO_USE_TUNNEL", "true").lower() in {"1", "true", "yes"}
        self.use_tunnel = use_tunnel if use_tunnel is not None else (env_tunnel if self.ssh_host else False)

        env_model = os.environ.get("LM_STUDIO_MODEL")
        if model_name:
            self.model_name = model_name
        elif env_model:
            self.model_name = env_model
        elif self.ssh_host:
            # Sur machine distante : modèle plus puissant en mode normal (Qwen3.8-27B)
            self.model_name = LM_STUDIO_TIER_MODELS.get(self.tier, DEFAULT_REMOTE_NORMAL_MODEL)
        else:
            self.model_name = LM_STUDIO_TIER_MODELS.get(self.tier, DEFAULT_REMOTE_NORMAL_MODEL)

        self.cli_path = cli_path or os.environ.get("LM_STUDIO_CLI_PATH") or "lms"
        env_auto = os.environ.get("LM_STUDIO_AUTO_START", "true").lower() in {"1", "true", "yes"}
        self.auto_start = auto_start if auto_start is not None else env_auto

        self.timeout_seconds = timeout_seconds
        self._tunnel_proc: Optional[subprocess.Popen] = None
        self._json_schema: Dict[str, Any] = LLMCompiledCardPart.model_json_schema()
        self._use_json_schema_format: bool = True
        self._ready: bool = False

        # Détermination de l'URL de base REST
        if self.ssh_host and self.use_tunnel:
            self.api_base_url = f"http://127.0.0.1:{self.local_port}/v1"
        elif self.ssh_host:
            self.api_base_url = f"http://{self.ssh_host}:{self.remote_port}/v1"
        else:
            self.api_base_url = f"http://127.0.0.1:{self.remote_port}/v1"

        self.hf_token: Optional[str] = None
        atexit.register(self.close)

    @property
    def ssh_target(self) -> str:
        """Cible SSH au format user@host:port."""
        if not self.ssh_host:
            return "localhost"
        user_prefix = f"{self.ssh_user}@" if self.ssh_user else ""
        port_suffix = f":{self.ssh_port}" if self.ssh_port != 22 else ""
        return f"{user_prefix}{self.ssh_host}{port_suffix}"

    @property
    def repo_id(self) -> str:
        return "LM_STUDIO_REMOTE" if self.ssh_host else "LM_STUDIO_LOCAL"

    @property
    def filename(self) -> str:
        model_label = self.model_name or "active_model"
        if self.ssh_host:
            return f"{model_label} (SSH {self.ssh_target})"
        return f"{model_label} ({self.api_base_url})"

    def _ensure_askpass_script(self) -> Optional[str]:
        """Crée un script temporaire compatible SSH_ASKPASS pour transmettre le mot de passe sans TTY."""
        if not self.ssh_password:
            return None
        if self._askpass_file and os.path.exists(self._askpass_file):
            return self._askpass_file
        fd, path = tempfile.mkstemp(prefix="ssh_askpass_", suffix=".py")
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write("#!/usr/bin/env python3\n")
            f.write("import os, sys\n")
            f.write("sys.stdout.write(os.environ.get('SSHPASS', ''))\n")
            f.write("sys.stdout.flush()\n")
        os.chmod(path, 0o700)
        self._askpass_file = path
        return path

    def _get_ssh_env(self) -> Dict[str, str]:
        """Prépare l'environnement pour les commandes SSH et tunnels."""
        env = os.environ.copy()
        if self.ssh_password:
            env["SSHPASS"] = self.ssh_password
            if not _find_sshpass():
                askpass = self._ensure_askpass_script()
                if askpass:
                    env["SSH_ASKPASS"] = askpass
                    env["SSH_ASKPASS_REQUIRE"] = "force"
                    env["DISPLAY"] = env.get("DISPLAY", ":0")
        return env

    def _build_ssh_base_command(self) -> List[str]:
        """Construit la liste des arguments standard pour exécuter une commande SSH."""
        cmd: List[str] = []
        sshpass_bin = _find_sshpass() if self.ssh_password else None
        if self.ssh_password and sshpass_bin:
            cmd.extend([sshpass_bin, "-e"])

        cmd.extend([
            "ssh",
            "-o", "BatchMode=no" if self.ssh_password else "BatchMode=yes",
            "-o", "ConnectTimeout=8",
            "-o", "StrictHostKeyChecking=accept-new",
        ])
        if self.ssh_password:
            cmd.extend(["-o", "PreferredAuthentications=password,keyboard-interactive,publickey"])
            if not self.ssh_key_path:
                cmd.extend(["-o", "PubkeyAuthentication=no"])

        if self.ssh_port != 22:
            cmd.extend(["-p", str(self.ssh_port)])
        if self.ssh_key_path:
            cmd.extend(["-i", os.path.expanduser(self.ssh_key_path)])

        target = f"{self.ssh_user}@{self.ssh_host}" if self.ssh_user else self.ssh_host
        cmd.append(target)
        return cmd

    def _run_ssh_command(self, remote_command: str) -> Tuple[int, str, str]:
        """Exécute une commande distante via SSH et retourne (code_retour, stdout, stderr)."""
        cmd = self._build_ssh_base_command()
        cmd.append(remote_command)
        env = self._get_ssh_env()
        proc = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
        )
        return proc.returncode, proc.stdout, proc.stderr

    def _start_ssh_tunnel(self) -> None:
        """Établit un tunnel SSH sécurisé transférant `127.0.0.1:{local_port}` vers `127.0.0.1:{remote_port}`."""
        if self._tunnel_proc is not None and self._tunnel_proc.poll() is None:
            return

        cmd: List[str] = []
        sshpass_bin = _find_sshpass() if self.ssh_password else None
        if self.ssh_password and sshpass_bin:
            cmd.extend([sshpass_bin, "-e"])

        cmd.extend([
            "ssh",
            "-N",
            "-L", f"{self.local_port}:127.0.0.1:{self.remote_port}",
            "-o", "ExitOnForwardFailure=yes",
            "-o", "ServerAliveInterval=30",
            "-o", "ServerAliveCountMax=3",
            "-o", "StrictHostKeyChecking=accept-new",
            "-o", "ConnectTimeout=10",
            "-o", "BatchMode=no" if self.ssh_password else "BatchMode=yes",
        ])
        if self.ssh_password:
            cmd.extend(["-o", "PreferredAuthentications=password,keyboard-interactive,publickey"])
            if not self.ssh_key_path:
                cmd.extend(["-o", "PubkeyAuthentication=no"])

        if self.ssh_port != 22:
            cmd.extend(["-p", str(self.ssh_port)])
        if self.ssh_key_path:
            cmd.extend(["-i", os.path.expanduser(self.ssh_key_path)])

        target = f"{self.ssh_user}@{self.ssh_host}" if self.ssh_user else self.ssh_host
        cmd.append(target)

        env = self._get_ssh_env()
        self._tunnel_proc = subprocess.Popen(
            cmd,
            env=env,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
        )

        # Attente active de la disponibilité du port local
        t0 = time.perf_counter()
        tunnel_ok = False
        while time.perf_counter() - t0 < 8.0:
            if self._tunnel_proc.poll() is not None:
                _, err = self._tunnel_proc.communicate()
                err_msg = err.decode(errors="replace") if isinstance(err, bytes) else str(err)
                raise ConnectionError(
                    f"Impossible d'établir le tunnel SSH vers {self.ssh_target} : {err_msg.strip()}"
                )
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.settimeout(0.4)
                if s.connect_ex(("127.0.0.1", self.local_port)) == 0:
                    tunnel_ok = True
                    break
            time.sleep(0.3)

        if not tunnel_ok:
            self.close()
            raise TimeoutError(
                f"Le tunnel SSH vers {self.ssh_target} n'a pas répondu sur le port local {self.local_port}."
            )

    def _ensure_remote_lm_studio(self) -> None:
        """Vérifie l'état de LM Studio sur la machine distante et démarre le serveur/modèle si nécessaire."""
        if not self.ssh_host or not self.auto_start:
            return

        # 1. Vérification de connectivité SSH basique
        code, _, stderr = self._run_ssh_command("echo OK")
        if code != 0:
            hint = ""
            if "Permission denied" in stderr:
                if self.ssh_password and not _find_sshpass():
                    hint = "\nAstuce : Pour la connexion SSH par mot de passe, 'sshpass' est recommandé (brew install sshpass)."
                elif not self.ssh_password:
                    hint = "\nAstuce : Si le serveur distant requiert un mot de passe, configurez SSH_PASSWORD dans .env ou utilisez l'option --ssh-password."
            raise ConnectionError(
                f"Connexion SSH échouée vers {self.ssh_target} (code {code}) : {stderr.strip()}{hint}"
            )

        # 2. Vérification du statut via `lms status`
        code, stdout, _ = self._run_ssh_command(f"{self.cli_path} status")
        server_running = code == 0 and ("running" in stdout.lower() or "server: on" in stdout.lower() or "port" in stdout.lower())

        if not server_running:
            # Démarrage du serveur LM Studio
            start_cmd = f"{self.cli_path} server start --port {self.remote_port}"
            self._run_ssh_command(start_cmd)
            time.sleep(1.5)

        # 3. Chargement du modèle si spécifié et absent de `lms ps`
        if self.model_name:
            code, ps_out, _ = self._run_ssh_command(f"{self.cli_path} ps")
            model_already_loaded = False
            if code == 0 and ps_out.strip():
                low_ps = ps_out.lower()
                target_keys = [self.model_name.lower()]
                if "27b" in self.model_name.lower():
                    target_keys.extend(["27b", "qwen3.8", "qwen3.8-27b", "qwen2.5-27b"])
                if any(k in low_ps for k in target_keys):
                    model_already_loaded = True

            if not model_already_loaded:
                # 1. Tentative de chargement direct avec offload GPU maximal
                load_code, _, _ = self._run_ssh_command(f"{self.cli_path} load {self.model_name} --gpu max")
                if load_code != 0:
                    # 2. Si le nom exact échoue, inspection des modèles téléchargés via `lms ls`
                    ls_code, ls_out, _ = self._run_ssh_command(f"{self.cli_path} ls")
                    if ls_code == 0:
                        candidates: List[str] = []
                        for line in ls_out.splitlines():
                            line_clean = line.strip()
                            if not line_clean or line_clean.startswith("─") or "NAME" in line_clean:
                                continue
                            parts = line_clean.split()
                            if parts:
                                cand_name = parts[0]
                                if (
                                    "27b" in cand_name.lower()
                                    or "qwen3.8" in cand_name.lower()
                                    or "qwen" in cand_name.lower()
                                ):
                                    candidates.append(cand_name)
                        if candidates:
                            best_cand = candidates[0]
                            for c in candidates:
                                if "27b" in c.lower() or "qwen3.8" in c.lower():
                                    best_cand = c
                                    break
                            self._run_ssh_command(f"{self.cli_path} load {best_cand} --gpu max")
                            self.model_name = best_cand
                time.sleep(2.0)

    def _ensure_local_lm_studio(self) -> None:
        """Vérifie l'état de LM Studio sur la machine locale si aucun hôte SSH n'est configuré."""
        if self.ssh_host or not self.auto_start:
            return

        try:
            res = subprocess.run([self.cli_path, "status"], capture_output=True, text=True)
            if res.returncode == 0 and "running" not in res.stdout.lower() and "port" not in res.stdout.lower():
                subprocess.run([self.cli_path, "server", "start", "--port", str(self.remote_port)], check=False)
                time.sleep(1.0)
            if self.model_name:
                subprocess.run([self.cli_path, "load", self.model_name, "--gpu", "max"], check=False)
        except Exception:
            # Si le binaire `lms` n'est pas dans le PATH local, on tente l'accès direct via HTTP REST
            pass

    def load_model_in_memory(self) -> None:
        """Initialise la connexion SSH, établit le tunnel et valide la disponibilité du serveur LM Studio."""
        if self._ready:
            return

        # 1. Gestion de la machine distante ou locale via LM Studio CLI
        if self.ssh_host:
            self._ensure_remote_lm_studio()
            if self.use_tunnel:
                self._start_ssh_tunnel()
        else:
            self._ensure_local_lm_studio()

        # 2. Vérification HTTP directe de l'API REST de LM Studio
        models_url = f"{self.api_base_url}/models"
        try:
            with httpx.Client(timeout=10.0) as client:
                resp = client.get(models_url)
                resp.raise_for_status()
                data = resp.json()
                models_list = data.get("data", [])
                if models_list and isinstance(models_list, list):
                    active_ids = [m.get("id") for m in models_list if isinstance(m, dict) and m.get("id")]
                    if active_ids:
                        matched = None
                        if self.model_name:
                            target_l = self.model_name.lower()
                            for act_id in active_ids:
                                act_l = act_id.lower()
                                if (
                                    target_l in act_l
                                    or ("27b" in target_l and "27b" in act_l)
                                    or ("qwen3.8" in target_l and "qwen3.8" in act_l)
                                ):
                                    matched = act_id
                                    break
                        self.model_name = matched or self.model_name or active_ids[0]
        except Exception as exc:
            self.close()
            target_desc = f"{self.ssh_target} (via tunnel {self.api_base_url})" if self.ssh_host else self.api_base_url
            raise ConnectionError(
                f"Impossible de joindre l'API LM Studio sur {target_desc} : {exc}\n"
                f"Assurez-vous que LM Studio est démarré avec le serveur local activé sur le port {self.remote_port}."
            ) from exc

        self._ready = True

    def compile_card(
        self,
        bundle: FetchedCardBundle,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        max_retries: int = 2,
    ) -> EngineCardModel:
        """Compile une carte Pokémon TCG via LM Studio (remote SSH / local REST) avec format contraint."""
        from compiler.llm_engine import SYSTEM_PROMPT, build_user_prompt, enforce_ptcg_invariants

        # Court-circuit déterministe pour les Énergies de Base (0 token, 0s)
        if is_basic_energy(bundle):
            return build_basic_energy_model(bundle)

        self.load_model_in_memory()
        user_prompt = build_user_prompt(bundle)
        current_max_tokens = max_tokens
        last_error: Optional[Exception] = None
        compiled_part: Optional[LLMCompiledCardPart] = None
        elapsed: float = 0.0

        chat_url = f"{self.api_base_url}/chat/completions"
        model_to_request = self.model_name or "default"

        with httpx.Client(timeout=self.timeout_seconds) as client:
            for attempt in range(max_retries + 1):
                if attempt > 0:
                    current_max_tokens += 2048

                t0 = time.perf_counter()

                # Construction du payload OpenAI-compatible pour LM Studio
                payload: Dict[str, Any] = {
                    "model": model_to_request,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_prompt},
                    ],
                    "temperature": temperature,
                    "max_tokens": current_max_tokens,
                }

                # Tentative avec structured output `json_schema` (spécification OpenAI / LM Studio récent)
                if self._use_json_schema_format:
                    payload["response_format"] = {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "LLMCompiledCardPart",
                            "strict": True,
                            "schema": self._json_schema,
                        },
                    }
                else:
                    payload["response_format"] = {"type": "json_object"}

                try:
                    resp = client.post(chat_url, json=payload)
                    if resp.status_code == 400 and self._use_json_schema_format:
                        # Fallback automatique sur json_object si la version de LM Studio ne supporte pas json_schema
                        self._use_json_schema_format = False
                        payload["response_format"] = {"type": "json_object"}
                        resp = client.post(chat_url, json=payload)

                    resp.raise_for_status()
                    data = resp.json()
                except Exception as req_err:
                    last_error = req_err
                    if attempt < max_retries:
                        time.sleep(1.0)
                        continue
                    raise RuntimeError(f"Erreur de communication avec LM Studio : {req_err}") from req_err

                elapsed = round(time.perf_counter() - t0, 3)
                choices = data.get("choices") or []
                if not choices:
                    raise RuntimeError(f"Réponse vide reçue de LM Studio : {data}")

                choice = choices[0]
                finish_reason = choice.get("finish_reason")
                raw_content = choice.get("message", {}).get("content", "")

                # Troncation de tokens détectée
                if finish_reason == "length" and attempt < max_retries:
                    continue

                try:
                    compiled_part = LLMCompiledCardPart.model_validate_json(raw_content)
                    break
                except Exception as val_err:
                    last_error = val_err
                    try:
                        raw_dict = json.loads(raw_content)
                        if isinstance(raw_dict, dict):
                            strat = raw_dict.get("strategicEvaluator")
                            if isinstance(strat, dict):
                                weights = strat.get("turnPhaseWeights")
                                if isinstance(weights, dict):
                                    for k in ["turn1", "turn2", "turn3", "turn4Plus"]:
                                        if k in weights:
                                            try:
                                                weights[k] = max(0.0, min(2.0, float(weights[k])))
                                            except Exception:
                                                pass
                            compiled_part = LLMCompiledCardPart.model_validate(raw_dict)
                            break
                    except Exception:
                        pass

                    err_str = str(val_err).lower()
                    if ("eof" in err_str or "expecting value" in err_str or finish_reason == "length") and attempt < max_retries:
                        continue
            else:
                raise last_error or RuntimeError(f"Échec de validation de la carte {bundle.card_id} via LM Studio")

        assert compiled_part is not None
        compiled_part = enforce_ptcg_invariants(compiled_part, bundle)

        metadata = CompilationMetadata(
            modelRepoId=self.repo_id,
            modelFilename=self.filename,
            compilationTimeSeconds=elapsed,
            compiledAtIso=datetime.now(timezone.utc).isoformat(),
        )

        engine_card = EngineCardModel(
            cardId=bundle.card_id,
            identity=bundle.identity,
            pokemonStats=bundle.pokemon_stats,
            category=compiled_part.category,
            subCategory=compiled_part.subCategory,
            playableActions=compiled_part.playableActions,
            strategicEvaluator=compiled_part.strategicEvaluator,
            compilationMetadata=metadata,
        )

        engine_card = sanitize_and_enrich_card(bundle, engine_card)
        return engine_card

    def close(self) -> None:
        """Ferme proprement le tunnel SSH et libère les processus et fichiers associés."""
        if self._tunnel_proc is not None:
            try:
                self._tunnel_proc.terminate()
                self._tunnel_proc.wait(timeout=1.5)
            except Exception:
                try:
                    self._tunnel_proc.kill()
                except Exception:
                    pass
            finally:
                self._tunnel_proc = None
        if self._askpass_file and os.path.exists(self._askpass_file):
            try:
                os.unlink(self._askpass_file)
            except Exception:
                pass
            self._askpass_file = None
        self._ready = False
