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
import signal
import socket
import subprocess
import sys
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


def strip_ansi_codes(text: str) -> str:
    """Supprime les séquences d'échappement ANSI (couleurs, curseur, styles de terminal)."""
    return re.sub(r"\x1b\[[0-9;]*[a-zA-Z]|\x1b\([a-zA-Z]|\x1b\][^\x07\x1b]*(\x07|\x1b\\)", "", text)


# Modèle puissant configuré par défaut en mode normal pour la machine distante (GPU dédié)
# Utilise la nomenclature standard LM Studio (kebab-case)
DEFAULT_REMOTE_NORMAL_MODEL = "qwen2.5-coder-32b-instruct"

LM_STUDIO_TIER_MODELS: Dict[ModelTier, str] = {
    ModelTier.qwen3: "qwen2.5-coder-32b-instruct",
    ModelTier.max: "qwen2.5-coder-32b-instruct",
    ModelTier.fast: "qwen2.5-coder-7b-instruct",
}


def extract_json_payload(text: str) -> str:
    """Extrait et nettoie le JSON généré par le LLM (retrait balises <think> et markdown fences)."""
    if not text:
        return ""
    text = text.strip()
    # Retrait des balises de réflexion type <think>...</think>
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()

    # Si le bloc est entouré de blocs markdown ```json ... ``` ou ``` ... ```
    md_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", text)
    candidate = md_match.group(1).strip() if md_match else text

    # Recherche du premier '{' et du dernier '}' pour isoler l'objet JSON racine
    first_brace = candidate.find("{")
    last_brace = candidate.rfind("}")
    if first_brace != -1 and last_brace != -1 and last_brace > first_brace:
        return candidate[first_brace : last_brace + 1].strip()

    return candidate


def parse_lms_ls_output(stdout: str) -> List[str]:
    """Extrait la liste des identifiants de modèles téléchargés depuis la sortie de `lms ls` ou `lms ps`."""
    if not stdout:
        return []

    cleaned = strip_ansi_codes(stdout).strip()
    models: List[str] = []

    # 1. Tentative de décodage JSON (ex: lms ls --json ou GET /v1/models)
    try:
        data = json.loads(cleaned)
        items: List[Any] = []
        if isinstance(data, list):
            items = data
        elif isinstance(data, dict):
            for key in ["data", "models", "items", "llms"]:
                if key in data and isinstance(data[key], list):
                    items = data[key]
                    break
        for item in items:
            if isinstance(item, dict):
                for k in ["modelKey", "id", "name", "path", "model"]:
                    val = item.get(k)
                    if val and isinstance(val, str) and val.strip() and val.strip() not in models:
                        models.append(val.strip())
                        break
            elif isinstance(item, str) and item.strip() and item.strip() not in models:
                models.append(item.strip())
        if models:
            return models
    except Exception:
        pass

    # 2. Analyse ligne par ligne du format texte (tableaux ASCII, listes avec puces, etc.)
    noise_words = {
        "NAME", "MODEL", "ID", "IDENTIFIER", "SIZE", "FORMAT", "STATUS",
        "PATH", "TYPE", "LLMS", "EMBEDDING", "MODELS", "YOU", "HAVE",
        "TOTAL", "INSTALLED", "AVAILABLE", "LOADED", "RUN", "NOTE", "TIP",
    }

    for line in cleaned.splitlines():
        line_clean = line.strip()
        if not line_clean or line_clean.startswith(("─", "═", "+", "┌", "└", "├", "┬", "┴", "┼")):
            continue

        # Retrait des bordures de tableaux
        if line_clean.startswith("│") and line_clean.endswith("│"):
            line_clean = line_clean[1:-1].strip()

        # Retrait des puces, tirets et séparateurs initiaux
        line_clean = re.sub(r"^[•\*\-\+\>\│\|\s]+", "", line_clean).strip()
        line_clean = line_clean.replace("│", " ").replace("|", " ").strip()
        if not line_clean:
            continue

        lower_line = line_clean.lower()
        if any(lower_line.startswith(prefix) for prefix in [
            "you have", "total:", "models:", "llms", "embedding models",
            "loaded models", "available models", "installed models",
            "to load a model", "use 'lms load", "run 'lms"
        ]):
            continue

        parts = line_clean.split()
        if not parts:
            continue

        candidate = parts[0].strip("(),:;'\"")
        # Retrait des annotations entre parenthèses
        candidate = re.sub(r"\(.*?\)", "", candidate).strip()

        if not candidate or candidate.upper() in noise_words:
            continue

        if candidate not in models:
            models.append(candidate)

    return models


def find_best_model_candidate(candidates: List[str], target: Optional[str]) -> Optional[str]:
    """Sélectionne le meilleur modèle parmi les candidats disponibles selon le palier et le modèle cible."""
    if not candidates:
        return None
    if not target:
        return candidates[0]

    t_clean = strip_ansi_codes(target).strip()
    t_l = t_clean.lower()

    # 1. Correspondance exacte ou insensible à la casse
    for c in candidates:
        if c == t_clean or c.lower() == t_l:
            return c

    # 2. Correspondance sous-chaîne normalisée
    t_norm = re.sub(r"[^a-zA-Z0-9]", "", t_l)
    for c in candidates:
        c_norm = re.sub(r"[^a-zA-Z0-9]", "", c.lower())
        if t_norm in c_norm or c_norm in t_norm:
            return c

    # 3. Famille Qwen (priorité élevée car modèle de référence du compilateur)
    is_qwen_target = any(q in t_l for q in ["qwen", "qwen3.8", "qwen3", "qwen2.5", "qwen2"])
    qwen_cands = [c for c in candidates if "qwen" in c.lower()]
    if is_qwen_target and qwen_cands:
        # Recherche par taille demandée
        if any(s in t_l for s in ["27b", "30b", "32b"]):
            for pref in ["32b", "30b", "27b", "28b", "14b", "7b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c
        elif "14b" in t_l:
            for pref in ["14b", "12b", "16b", "7b", "32b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c
        elif any(s in t_l for s in ["7b", "8b"]):
            for pref in ["7b", "8b", "9b", "14b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c
        # Préférer les modèles 'coder'
        for c in qwen_cands:
            if "coder" in c.lower():
                return c
        return qwen_cands[0]

    # 4. Correspondance par taille de modèle demandée (familles génériques)
    if any(s in t_l for s in ["27b", "30b", "32b"]):
        for preferred in ["32b", "30b", "27b", "28b", "14b", "7b"]:
            for c in candidates:
                if preferred in c.lower():
                    return c
    elif "14b" in t_l:
        for preferred in ["14b", "12b", "16b", "7b"]:
            for c in candidates:
                if preferred in c.lower():
                    return c
    elif any(s in t_l for s in ["7b", "8b"]):
        for preferred in ["7b", "8b", "9b", "14b"]:
            for c in candidates:
                if preferred in c.lower():
                    return c

    # 5. Autres familles de modèles (Llama, DeepSeek, Mistral, Gemma, Phi)
    for family in ["llama", "deepseek", "mistral", "gemma", "phi"]:
        if family in t_l:
            for c in candidates:
                if family in c.lower():
                    return c

    return None


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
        self._register_signal_handlers()

    def _register_signal_handlers(self) -> None:
        """Enregistre des handlers de signaux (SIGINT, SIGTERM) pour décharger le modèle en cas d'interruption manuelle."""
        try:
            prev_sigint = signal.getsignal(signal.SIGINT)
            prev_sigterm = signal.getsignal(signal.SIGTERM)

            def _handler(sig, frame):
                self.close()
                if sig == signal.SIGINT and callable(prev_sigint) and prev_sigint not in {signal.SIG_DFL, signal.SIG_IGN}:
                    prev_sigint(sig, frame)
                elif sig == signal.SIGTERM and callable(prev_sigterm) and prev_sigterm not in {signal.SIG_DFL, signal.SIG_IGN}:
                    prev_sigterm(sig, frame)
                sys.exit(130 if sig == signal.SIGINT else 143)

            signal.signal(signal.SIGINT, _handler)
            signal.signal(signal.SIGTERM, _handler)
        except Exception:
            pass

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
        # Export PATH pour garantir que `lms` est trouvé même en session SSH non interactive
        full_remote_cmd = (
            'export PATH="$HOME/.cache/lm-studio/bin:$HOME/.lmstudio/bin:$HOME/.local/bin:/usr/local/bin:$PATH"; '
            f"{remote_command}"
        )
        cmd.append(full_remote_cmd)
        env = self._get_ssh_env()
        proc = subprocess.run(
            cmd,
            env=env,
            capture_output=True,
            text=True,
            stdin=subprocess.DEVNULL,
            timeout=60.0,
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

    def _get_remote_available_models(self) -> List[str]:
        """Détecte l'ensemble des modèles disponibles sur la machine distante (lms ls, json, fs gguf, REST)."""
        models: List[str] = []

        # 1. Tentative via `lms ls --json`
        code, out, _ = self._run_ssh_command(f"{self.cli_path} ls --json")
        if code == 0 and out.strip():
            for m in parse_lms_ls_output(out):
                if m and m not in models:
                    models.append(m)

        # 2. Tentative via `lms ls` standard (tableau ou liste)
        if not models:
            code, out, _ = self._run_ssh_command(f"{self.cli_path} ls")
            if code == 0 and out.strip():
                for m in parse_lms_ls_output(out):
                    if m and m not in models:
                        models.append(m)

        # 3. Détection directe dans les répertoires de modèles LM Studio (~/.cache/lm-studio/models et ~/.lmstudio/models)
        find_cmd = 'find ~/.cache/lm-studio/models ~/.lmstudio/models -type f -name "*.gguf" 2>/dev/null'
        code, out, _ = self._run_ssh_command(find_cmd)
        if code == 0 and out.strip():
            for line in out.strip().splitlines():
                line = line.strip()
                if not line or not line.endswith(".gguf"):
                    continue
                # Ex: /path/to/models/publisher/repo/model.gguf -> "publisher/repo"
                m_match = re.search(r"/models/(.+?)/[^/]+\.gguf$", line)
                if m_match:
                    rel_key = m_match.group(1)
                    if rel_key and rel_key not in models:
                        models.append(rel_key)
                stem = Path(line).stem
                if stem and stem not in models:
                    models.append(stem)

        # 4. Interrogation REST via curl sur la machine distante si LM Studio tourne déjà
        curl_cmd = f"curl -s http://127.0.0.1:{self.remote_port}/v1/models"
        code, out, _ = self._run_ssh_command(curl_cmd)
        if code == 0 and out.strip():
            try:
                data = json.loads(out)
                items = data.get("data", []) if isinstance(data, dict) else []
                for item in items:
                    mid = item.get("id") if isinstance(item, dict) else None
                    if mid and mid not in models:
                        models.append(mid)
            except Exception:
                pass

        return models

    def _get_local_available_models(self) -> List[str]:
        """Détecte l'ensemble des modèles disponibles sur la machine locale."""
        models: List[str] = []
        try:
            res = subprocess.run([self.cli_path, "ls", "--json"], capture_output=True, text=True, check=False)
            if res.returncode == 0 and res.stdout.strip():
                for m in parse_lms_ls_output(res.stdout):
                    if m and m not in models:
                        models.append(m)
        except Exception:
            pass

        if not models:
            try:
                res = subprocess.run([self.cli_path, "ls"], capture_output=True, text=True, check=False)
                if res.returncode == 0 and res.stdout.strip():
                    for m in parse_lms_ls_output(res.stdout):
                        if m and m not in models:
                            models.append(m)
            except Exception:
                pass

        # Recherche de fichiers .gguf dans ~/.cache/lm-studio/models et ~/.lmstudio/models
        for base_dir in [Path.home() / ".cache" / "lm-studio" / "models", Path.home() / ".lmstudio" / "models"]:
            if base_dir.exists():
                for p in base_dir.rglob("*.gguf"):
                    try:
                        rel = str(p.parent.relative_to(base_dir))
                        if rel and rel != "." and rel not in models:
                            models.append(rel)
                    except Exception:
                        pass
                    if p.stem and p.stem not in models:
                        models.append(p.stem)

        return models

    def _load_remote_model_via_cli(self) -> None:
        """Charge un modèle sur la machine distante via `lms load`."""
        if not self.ssh_host:
            return
        downloaded = self._get_remote_available_models()
        target_name = self.model_name or DEFAULT_REMOTE_NORMAL_MODEL
        best_cand = find_best_model_candidate(downloaded, target_name)
        model_to_load = best_cand or (downloaded[0] if downloaded else target_name)

        if not model_to_load:
            return

        load_cmd = f"{self.cli_path} load {model_to_load} --gpu max -y"
        load_code, _, load_err = self._run_ssh_command(load_cmd)
        if load_code != 0 and ("--gpu" in load_err.lower() or "unknown option" in load_err.lower()):
            load_cmd = f"{self.cli_path} load {model_to_load} -y"
            load_code, _, load_err = self._run_ssh_command(load_cmd)

        if load_code != 0:
            avail_msg = f" Modèles disponibles détectés sur {self.ssh_target} : {', '.join(downloaded)}." if downloaded else " Aucun modèle téléchargé détecté."
            raise RuntimeError(
                f"Échec du chargement du modèle '{model_to_load}' dans LM Studio sur {self.ssh_target} (code {load_code}) : {load_err.strip()}.\n"
                f"{avail_msg}\n"
                f"Vérifiez le nom configuré dans LM_STUDIO_MODEL ou téléchargez un modèle via `lms get qwen2.5-coder-32b-instruct`."
            )
        self.model_name = model_to_load

    def _load_local_model_via_cli(self) -> None:
        """Charge un modèle sur la machine locale via `lms load`."""
        try:
            downloaded = self._get_local_available_models()
            target_name = self.model_name or DEFAULT_REMOTE_NORMAL_MODEL
            best_cand = find_best_model_candidate(downloaded, target_name)
            model_to_load = best_cand or (downloaded[0] if downloaded else target_name)
            if model_to_load:
                subprocess.run([self.cli_path, "load", model_to_load, "--gpu", "max", "-y"], check=False)
                self.model_name = model_to_load
        except Exception:
            pass

    def _ensure_remote_lm_studio(self) -> None:
        """Vérifie l'état de LM Studio sur la machine distante, décharge les modèles non requis et charge le modèle requis."""
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
            code, _, start_err = self._run_ssh_command(start_cmd)
            if code != 0:
                raise RuntimeError(f"Échec du démarrage du serveur LM Studio distant ({start_cmd}) : {start_err}")
            time.sleep(2.0)

        # 3. Déchargement des modèles non requis et chargement du modèle requis
        target_name = self.model_name or DEFAULT_REMOTE_NORMAL_MODEL

        # Inspection de l'état actuel de LM Studio via `lms ps`
        ps_code, ps_out, _ = self._run_ssh_command(f"{self.cli_path} ps")
        running_models = parse_lms_ls_output(ps_out) if ps_code == 0 else []

        # Vérifie si le modèle requis est déjà en mémoire
        matched_running = find_best_model_candidate(running_models, target_name) if running_models else None

        if running_models and not matched_running:
            # Des modèles non requis sont actuellement chargés : on les décharge
            self._run_ssh_command(f"{self.cli_path} unload --all")
            time.sleep(1.5)
            running_models = []

        if matched_running:
            self.model_name = matched_running
            return

        # 4. Chargement du modèle requis
        self._load_remote_model_via_cli()

        # 5. Attente active de confirmation en VRAM
        for _ in range(25):
            time.sleep(1.0)
            ps_c, ps_o, _ = self._run_ssh_command(f"{self.cli_path} ps")
            if ps_c == 0:
                cur_running = parse_lms_ls_output(ps_o)
                if cur_running:
                    self.model_name = cur_running[0]
                    break

    def _ensure_local_lm_studio(self) -> None:
        """Vérifie l'état de LM Studio sur la machine locale, décharge les modèles non requis et charge le modèle requis."""
        if self.ssh_host or not self.auto_start:
            return

        try:
            res = subprocess.run([self.cli_path, "status"], capture_output=True, text=True)
            if res.returncode == 0 and "running" not in res.stdout.lower() and "port" not in res.stdout.lower():
                subprocess.run([self.cli_path, "server", "start", "--port", str(self.remote_port)], check=False)
                time.sleep(1.5)

            target_name = self.model_name or DEFAULT_REMOTE_NORMAL_MODEL
            ps_res = subprocess.run([self.cli_path, "ps"], capture_output=True, text=True)
            running_models = parse_lms_ls_output(ps_res.stdout) if ps_res.returncode == 0 else []

            matched_running = find_best_model_candidate(running_models, target_name) if running_models else None

            if running_models and not matched_running:
                subprocess.run([self.cli_path, "unload", "--all"], capture_output=True, text=True, check=False)
                time.sleep(1.0)
                running_models = []

            if matched_running:
                self.model_name = matched_running
                return

            self._load_local_model_via_cli()
            time.sleep(1.5)
        except Exception:
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
        root_url = self.api_base_url.rsplit("/v1", 1)[0]
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(models_url)
                resp.raise_for_status()
                data = resp.json()
                models_list = data.get("data", [])
                active_ids = [m.get("id") for m in models_list if isinstance(m, dict) and m.get("id")] if isinstance(models_list, list) else []

                target_name = self.model_name or DEFAULT_REMOTE_NORMAL_MODEL
                matched = find_best_model_candidate(active_ids, target_name) if active_ids else None

                # Si des modèles non requis sont actifs, on les décharge
                if active_ids and not matched:
                    self.unload_model()
                    time.sleep(1.5)
                    active_ids = []

                # Si aucun modèle n'est chargé, on déclenche le chargement
                if not active_ids:
                    # 1. Tentative REST si disponible
                    rest_loaded = False
                    for load_ep in [f"{root_url}/api/v1/models/load", f"{root_url}/api/v0/model/load"]:
                        try:
                            l_resp = client.post(load_ep, json={"model": target_name, "echo_load_config": False}, timeout=30.0)
                            if l_resp.is_success:
                                rest_loaded = True
                                break
                        except Exception:
                            pass

                    # 2. Si REST échoue, tentative CLI avec découverte intelligente
                    if not rest_loaded:
                        if self.ssh_host:
                            self._load_remote_model_via_cli()
                        else:
                            self._load_local_model_via_cli()

                    # 3. Attente active de confirmation
                    for _ in range(25):
                        time.sleep(1.0)
                        try:
                            p_resp = client.get(models_url)
                            if p_resp.is_success:
                                p_data = p_resp.json().get("data", [])
                                p_ids = [m.get("id") for m in p_data if isinstance(m, dict) and m.get("id")]
                                if p_ids:
                                    active_ids = p_ids
                                    break
                        except Exception:
                            pass

                if not active_ids:
                    effective_target = self.model_name or target_name
                    raise RuntimeError(
                        f"Aucun modèle n'est chargé dans LM Studio sur {self.api_base_url}.\n"
                        f"Veuillez charger le modèle '{effective_target}' en mémoire via :\n"
                        f"  lms load {effective_target} --gpu max -y\n"
                        f"ou depuis l'interface LM Studio."
                    )

                self.model_name = find_best_model_candidate(active_ids, target_name) or active_ids[0]

        except Exception as exc:
            self.close()
            target_desc = f"{self.ssh_target} (via tunnel {self.api_base_url})" if self.ssh_host else self.api_base_url
            if isinstance(exc, RuntimeError):
                raise
            raise ConnectionError(
                f"Impossible de joindre ou d'initialiser l'API LM Studio sur {target_desc} : {exc}\n"
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
                    current_max_tokens = min(current_max_tokens + 1024, 8192)

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

                # Cascade de formats : json_schema -> json_object -> none (prompt direct)
                formats_to_try: List[str] = []
                if self._use_json_schema_format:
                    formats_to_try.append("json_schema")
                formats_to_try.extend(["json_object", "none"])

                data: Optional[Dict[str, Any]] = None
                call_err: Optional[Exception] = None

                for fmt in formats_to_try:
                    if fmt == "json_schema":
                        payload["response_format"] = {
                            "type": "json_schema",
                            "json_schema": {
                                "name": "LLMCompiledCardPart",
                                "schema": self._json_schema,
                            },
                        }
                    elif fmt == "json_object":
                        payload["response_format"] = {"type": "json_object"}
                    else:
                        payload.pop("response_format", None)

                    try:
                        resp = client.post(chat_url, json=payload)
                    except httpx.RequestError as net_err:
                        call_err = net_err
                        break

                    if resp.is_success:
                        data = resp.json()
                        if fmt != "json_schema":
                            self._use_json_schema_format = False
                        break

                    # Analyse détaillée de l'erreur HTTP retournée par LM Studio
                    err_msg = ""
                    try:
                        err_json = resp.json()
                        err_obj = err_json.get("error", {})
                        if isinstance(err_obj, dict):
                            err_msg = err_obj.get("message") or str(err_obj)
                        else:
                            err_msg = str(err_obj)
                    except Exception:
                        err_msg = resp.text

                    call_err = RuntimeError(
                        f"Erreur LM Studio (HTTP {resp.status_code}) : {err_msg or resp.text}"
                    )

                    # 1. Gestion du modèle non trouvé ou non chargé
                    if resp.status_code == 400 and any(
                        w in err_msg.lower() for w in ["model", "not loaded", "not found"]
                    ):
                        try:
                            models_resp = client.get(f"{self.api_base_url}/models")
                            if models_resp.is_success:
                                m_list = models_resp.json().get("data", [])
                                active_m = [
                                    m.get("id")
                                    for m in m_list
                                    if isinstance(m, dict) and m.get("id")
                                ]
                                if active_m and payload.get("model") != active_m[0]:
                                    payload["model"] = active_m[0]
                                    self.model_name = active_m[0]
                                    model_to_request = active_m[0]
                                    retry_resp = client.post(chat_url, json=payload)
                                    if retry_resp.is_success:
                                        data = retry_resp.json()
                                        break
                        except Exception:
                            pass

                    # 2. Gestion du dépassement de la fenêtre de contexte / tokens
                    if resp.status_code == 400 and any(
                        w in err_msg.lower()
                        for w in ["token", "context", "length", "exceed", "n_ctx", "maximum"]
                    ):
                        if payload["max_tokens"] > 1536:
                            payload["max_tokens"] = 1536
                            current_max_tokens = 1536
                            retry_resp = client.post(chat_url, json=payload)
                            if retry_resp.is_success:
                                data = retry_resp.json()
                                break

                    # 3. Si 400 causé par response_format : on continue sur le format de repli suivant
                    if resp.status_code == 400:
                        continue

                    # Pour toute autre erreur non-400 (500, 401, etc.)
                    break

                if data is None:
                    last_error = call_err or RuntimeError("Réponse vide ou indisponible de LM Studio")
                    if attempt < max_retries:
                        time.sleep(1.0)
                        continue
                    raise RuntimeError(f"Erreur de communication avec LM Studio : {last_error}") from last_error

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

                cleaned_json = extract_json_payload(raw_content)

                try:
                    compiled_part = LLMCompiledCardPart.model_validate_json(cleaned_json)
                    break
                except Exception as val_err:
                    last_error = val_err
                    try:
                        raw_dict = json.loads(cleaned_json)
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

    def unload_model(self) -> None:
        """Décharge les modèles de la mémoire LM Studio (RAM / VRAM) pour libérer les ressources du GPU."""
        try:
            # 1. Tentative de déchargement via l'API REST si le serveur est accessible
            root_url = self.api_base_url.rsplit("/v1", 1)[0]
            for ep in [f"{root_url}/api/v1/models/unload", f"{root_url}/api/v0/model/unload"]:
                try:
                    with httpx.Client(timeout=4.0) as client:
                        client.post(ep, json={"model": self.model_name or ""})
                except Exception:
                    pass

            # 2. Déchargement garanti via CLI `lms unload --all` (SSH distant ou local)
            if self.ssh_host:
                self._run_ssh_command(f"{self.cli_path} unload --all")
            else:
                try:
                    subprocess.run([self.cli_path, "unload", "--all"], capture_output=True, text=True, check=False)
                except Exception:
                    pass
        except Exception:
            pass

    def close(self) -> None:
        """Ferme proprement le compilateur : décharge le modèle d'abord, puis ferme le tunnel SSH et nettoie."""
        # 1. Déchargement impératif du modèle en premier
        self.unload_model()

        # 2. Fermeture du tunnel SSH
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

        # 3. Nettoyage du fichier askpass temporaire
        if self._askpass_file and os.path.exists(self._askpass_file):
            try:
                os.unlink(self._askpass_file)
            except Exception:
                pass
            self._askpass_file = None

        self._ready = False
