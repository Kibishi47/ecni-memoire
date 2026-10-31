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
from typing import Any, Callable, Dict, List, Optional, Tuple

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


# Modèle Qwen3.8 27B configuré par défaut en mode normal pour la machine distante (GPU dédié)
# Utilise la dénomination officielle LM Studio : lmstudio-community/Qwen3.8-27B-GGUF
DEFAULT_REMOTE_NORMAL_MODEL = "lmstudio-community/Qwen3.8-27B-GGUF"

LM_STUDIO_TIER_MODELS: Dict[ModelTier, str] = {
    ModelTier.qwen3: "lmstudio-community/Qwen3.8-27B-GGUF",
    ModelTier.max: "lmstudio-community/Qwen3.8-27B-GGUF",
    ModelTier.fast: "qwen2.5-coder-7b-instruct",
}


def normalize_lm_studio_model_name(name: Optional[str]) -> str:
    """Normalise les identifiants vers le nom de dépôt officiel attendu par LM Studio."""
    if not name:
        return DEFAULT_REMOTE_NORMAL_MODEL
    name_clean = strip_ansi_codes(name).strip()
    nl = name_clean.lower().replace(" ", "").replace("_", "-")
    # Reconnaissance de toutes les variantes de Qwen3.8 27B
    if ("qwen3.8" in nl or "qwen38" in nl) and "27b" in nl:
        if not name_clean.startswith("lmstudio-community/") and not name_clean.endswith("-GGUF"):
            return "lmstudio-community/Qwen3.8-27B-GGUF"
    return name_clean


def extract_json_payload(text: str) -> str:
    """Extrait et nettoie le JSON généré par le LLM (retrait balises <think>, markdown fences, et isolation de l'objet JSON racine)."""
    if not text:
        return ""
    text = text.strip()

    # 1. Retrait des balises de réflexion fermées type <think>...</think>
    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", text).strip()

    # 2. Si un bloc <think> n'a pas été fermé (ex: modèle interrompu ou token limit)
    if "<think>" in cleaned:
        first_brace = cleaned.find("{")
        if first_brace != -1:
            cleaned = cleaned[first_brace:]
        else:
            cleaned = ""

    # 3. Extraction du bloc markdown ```json ... ``` ou ``` ... ```
    md_match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    candidate = md_match.group(1).strip() if md_match else cleaned

    # 4. Recherche de l'objet JSON racine délimité par premier '{' et dernier '}'
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
        # Priorité absolue pour Qwen3.8 27B si demandé
        if ("3.8" in t_l or "38" in t_l) and "27b" in t_l:
            for c in qwen_cands:
                cl = c.lower()
                if ("3.8" in cl or "38" in cl) and "27b" in cl:
                    return c
            for c in qwen_cands:
                cl = c.lower()
                if "3.8" in cl or "38" in cl:
                    return c

        # Recherche par taille demandée
        if "27b" in t_l:
            for pref in ["27b", "28b", "30b", "32b", "14b", "7b"]:
                for c in qwen_cands:
                    if pref in c.lower():
                        return c
        elif any(s in t_l for s in ["30b", "32b"]):
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
    """Compilateur de cartes s'appuyant sur l'API OpenAI-compatible de LM Studio (directe par IP/port ou via tunnel SSH)."""

    def __init__(
        self,
        api_base_url: Optional[str] = None,
        remote_host: Optional[str] = None,
        remote_port: Optional[int] = None,
        ssh_host: Optional[str] = None,
        ssh_port: Optional[int] = None,
        ssh_user: Optional[str] = None,
        ssh_key_path: Optional[str] = None,
        ssh_password: Optional[str] = None,
        local_port: Optional[int] = None,
        use_tunnel: Optional[bool] = None,
        model_name: Optional[str] = None,
        cli_path: Optional[str] = None,
        auto_start: Optional[bool] = None,
        timeout_seconds: float = 180.0,
        tier: ModelTier = ModelTier.qwen3,
        **kwargs: Any,
    ) -> None:
        load_env_file()

        self.tier = tier

        # 1. Résolution de l'URL REST LM Studio (Directe IP/port ou tunnel SSH)
        env_base_url = os.environ.get("LM_STUDIO_BASE_URL")
        explicit_url = api_base_url or env_base_url
        if explicit_url:
            cleaned_url = explicit_url.strip().rstrip("/")
            if not cleaned_url.endswith("/v1"):
                cleaned_url = f"{cleaned_url}/v1"
            self.api_base_url = cleaned_url
            self.remote_host = None
            self.remote_port = 1234
            self.ssh_host = None
            self.use_tunnel = False
        else:
            env_host = os.environ.get("LM_STUDIO_HOST") or os.environ.get("SSH_HOST") or None
            self.remote_host = remote_host or env_host
            self.remote_port = int(remote_port or os.environ.get("LM_STUDIO_PORT") or 1234)

            # Option tunnel SSH (uniquement si explicitement activé via LM_STUDIO_USE_TUNNEL=true)
            env_tunnel = os.environ.get("LM_STUDIO_USE_TUNNEL", "false").lower() in {"1", "true", "yes"}
            self.ssh_host = ssh_host or os.environ.get("SSH_HOST") or None
            self.use_tunnel = use_tunnel if use_tunnel is not None else (env_tunnel if self.ssh_host else False)

            if self.ssh_host and self.use_tunnel:
                configured_local_port = int(local_port or os.environ.get("LM_STUDIO_LOCAL_PORT") or 12345)
                self.local_port = find_available_port(configured_local_port)
                self.api_base_url = f"http://127.0.0.1:{self.local_port}/v1"
            elif self.remote_host:
                self.api_base_url = f"http://{self.remote_host}:{self.remote_port}/v1"
            else:
                self.api_base_url = f"http://127.0.0.1:{self.remote_port}/v1"

        # 2. Paramètres SSH optionnels
        self.ssh_port = int(ssh_port or os.environ.get("SSH_PORT") or 22)
        self.ssh_user = ssh_user or os.environ.get("SSH_USER") or None
        self.ssh_key_path = ssh_key_path or os.environ.get("SSH_KEY_PATH") or None
        self.ssh_password = ssh_password or os.environ.get("SSH_PASSWORD") or None
        self._askpass_file: Optional[str] = None
        self.local_port = getattr(self, "local_port", 12345)

        # 3. Modèle d'inférence
        env_model = os.environ.get("LM_STUDIO_MODEL")
        if model_name and model_name.strip():
            self.model_name = model_name.strip()
        elif env_model and env_model.strip():
            self.model_name = env_model.strip()
        else:
            self.model_name = None  # Auto-détecté depuis le modèle actuellement chargé sur le serveur

        self.cli_path = cli_path or os.environ.get("LM_STUDIO_CLI_PATH") or "lms"
        self.auto_start = False
        self.timeout_seconds = timeout_seconds
        self._tunnel_proc: Optional[subprocess.Popen] = None
        self._json_schema: Dict[str, Any] = LLMCompiledCardPart.model_json_schema()
        self._use_json_schema_format: bool = True
        self._ready: bool = False

        self.hf_token: Optional[str] = None
        atexit.register(self.close)
        self._register_signal_handlers()

    def _register_signal_handlers(self) -> None:
        """Enregistre des handlers de signaux (SIGINT, SIGTERM) pour fermer proprement le tunnel en cas d'interruption."""
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
        if self.ssh_host and self.use_tunnel:
            return "LM_STUDIO_SSH_TUNNEL"
        elif self.remote_host and self.remote_host not in {"127.0.0.1", "localhost"}:
            return "LM_STUDIO_REMOTE"
        return "LM_STUDIO"

    @property
    def filename(self) -> str:
        model_label = self.model_name or "active_server_model"
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

    def load_model_in_memory(self) -> None:
        """Établit le tunnel SSH si nécessaire et vérifie le modèle actuellement chargé sur le serveur LM Studio."""
        if self._ready:
            return

        # 1. Établissement du tunnel SSH sécurisé UNIQUEMENT si explicitement configuré
        if self.use_tunnel and self.ssh_host:
            self._start_ssh_tunnel()

        # 2. Vérification HTTP directe de l'API REST de LM Studio
        models_url = f"{self.api_base_url}/models"
        try:
            with httpx.Client(timeout=15.0) as client:
                resp = client.get(models_url)
                resp.raise_for_status()
                data = resp.json()
                models_list = data.get("data", [])
                active_ids = [
                    m.get("id")
                    for m in models_list
                    if isinstance(m, dict) and m.get("id")
                ] if isinstance(models_list, list) else []

                # Si aucun modèle n'est chargé, on arrête immédiatement avec un message clair
                if not active_ids:
                    raise RuntimeError(
                        f"Aucun modèle n'est actuellement chargé sur le serveur LM Studio ({self.api_base_url}).\n"
                        f"Veuillez charger le modèle de votre choix dans l'interface LM Studio avant de lancer le compilateur."
                    )

                # Si un modèle spécifique a été expressément demandé par l'utilisateur
                if self.model_name:
                    matched = find_best_model_candidate(active_ids, self.model_name)
                    if not matched:
                        raise RuntimeError(
                            f"Le modèle demandé '{self.model_name}' n'est pas chargé sur le serveur LM Studio.\n"
                            f"Modèle(s) actuellement actif(s) sur le serveur : {', '.join(active_ids)}.\n"
                            f"Veuillez charger '{self.model_name}' dans LM Studio ou laisser LM_STUDIO_MODEL vide pour utiliser automatiquement le modèle actif."
                        )
                    self.model_name = matched
                else:
                    # Utilisation directe du modèle actuellement chargé sur le serveur
                    self.model_name = active_ids[0]

        except Exception as exc:
            self.close()
            target_desc = f"{self.ssh_target} (via tunnel {self.api_base_url})" if self.ssh_host else self.api_base_url
            if isinstance(exc, RuntimeError):
                raise
            raise ConnectionError(
                f"Impossible de joindre le serveur LM Studio sur {target_desc} : {exc}\n"
                f"Assurez-vous que le serveur LM Studio est démarré et écoute sur le port {self.remote_port}."
            ) from exc

        self._ready = True

    def _send_completion_request(
        self,
        client: httpx.Client,
        chat_url: str,
        payload: Dict[str, Any],
        should_stream: bool,
        t0: float,
        on_token: Optional[Callable[[int, float], None]],
    ) -> Tuple[Optional[Dict[str, Any]], Optional[httpx.Response], Optional[Exception]]:
        """Envoie la requête de complétion à LM Studio soit en streaming SSE (temps réel), soit en POST direct."""
        if should_stream:
            payload["stream"] = True
            payload["stream_options"] = {"include_usage": True}
            try:
                with client.stream("POST", chat_url, json=payload) as resp:
                    if not resp.is_success:
                        resp.read()
                        return None, resp, None

                    accumulated_content: List[str] = []
                    accumulated_reasoning: List[str] = []
                    token_count = 0
                    last_cb_time = 0.0
                    usage_info: Dict[str, Any] = {}
                    finish_reason: Optional[str] = None

                    for line in resp.iter_lines():
                        if not line:
                            continue
                        line_str = line.strip()
                        if line_str.startswith("data: "):
                            line_str = line_str[6:].strip()
                        elif line_str.startswith("data:"):
                            line_str = line_str[5:].strip()
                        if line_str == "[DONE]":
                            break
                        try:
                            chunk = json.loads(line_str)
                        except Exception:
                            continue

                        if "usage" in chunk and chunk["usage"]:
                            usage_info = chunk["usage"]

                        choices = chunk.get("choices") or []
                        if choices:
                            c0 = choices[0]
                            if c0.get("finish_reason"):
                                finish_reason = c0["finish_reason"]
                            delta = c0.get("delta") or {}
                            d_content = delta.get("content") or ""
                            d_reasoning = delta.get("reasoning_content") or delta.get("reasoning") or ""
                            has_tok = False
                            if d_content:
                                accumulated_content.append(d_content)
                                has_tok = True
                            if d_reasoning:
                                accumulated_reasoning.append(d_reasoning)
                                has_tok = True

                            if has_tok:
                                token_count += 1
                                if on_token:
                                    now = time.perf_counter()
                                    if now - last_cb_time >= 0.05:
                                        live_elapsed = max(0.001, now - t0)
                                        live_tps = round(token_count / live_elapsed, 1)
                                        on_token(token_count, live_tps)
                                        last_cb_time = now

                    if on_token and token_count > 0:
                        final_elapsed = max(0.001, time.perf_counter() - t0)
                        final_tps = round(token_count / final_elapsed, 1)
                        on_token(token_count, final_tps)

                    content = "".join(accumulated_content).strip()
                    reasoning = "".join(accumulated_reasoning).strip()
                    if not content and reasoning:
                        content = reasoning

                    data = {
                        "choices": [
                            {
                                "message": {
                                    "content": content,
                                    "reasoning_content": reasoning,
                                },
                                "finish_reason": finish_reason or "stop",
                            }
                        ],
                        "usage": usage_info or {"completion_tokens": token_count},
                    }
                    return data, resp, None
            except (AttributeError, TypeError):
                # Fallback sur POST standard si le mock ou client ne supporte pas stream()
                pass
            except httpx.RequestError as net_err:
                return None, None, net_err

        # Mode non-streamé standard
        payload.pop("stream", None)
        payload.pop("stream_options", None)
        try:
            resp = client.post(chat_url, json=payload)
            if resp.is_success:
                return resp.json(), resp, None
            return None, resp, None
        except httpx.RequestError as net_err:
            return None, None, net_err

    def compile_card(
        self,
        bundle: FetchedCardBundle,
        temperature: float = 0.1,
        max_tokens: int = 4096,
        max_retries: int = 2,
        stream: Optional[bool] = None,
        on_token: Optional[Callable[[int, float], None]] = None,
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

        should_stream = stream if stream is not None else (on_token is not None)
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

                    data_candidate, resp, net_err = self._send_completion_request(
                        client, chat_url, payload, should_stream, t0, on_token
                    )
                    if net_err:
                        call_err = net_err
                        break

                    if data_candidate is not None:
                        choices = data_candidate.get("choices") or []
                        content = ""
                        if choices:
                            msg = choices[0].get("message") or {}
                            content = (msg.get("content") or choices[0].get("text") or "").strip()
                            reasoning = (msg.get("reasoning_content") or msg.get("reasoning") or "").strip()
                            if not content and reasoning:
                                cand_json = extract_json_payload(reasoning)
                                if cand_json.startswith("{") and cand_json.endswith("}"):
                                    content = cand_json
                                    if "message" in choices[0]:
                                        choices[0]["message"]["content"] = cand_json

                        cleaned_candidate = extract_json_payload(content)
                        if cleaned_candidate.startswith("{") and cleaned_candidate.endswith("}"):
                            data = data_candidate
                            if fmt != "json_schema":
                                self._use_json_schema_format = False
                            break
                        else:
                            # Le format actuel a produit une réponse vide ou sans JSON (conflit GBNF/thinking)
                            if fmt == "json_schema":
                                self._use_json_schema_format = False
                            continue

                    # Analyse détaillée de l'erreur HTTP retournée par LM Studio
                    assert resp is not None
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
                                    retry_data, retry_resp, _ = self._send_completion_request(
                                        client, chat_url, payload, should_stream, t0, on_token
                                    )
                                    if retry_data is not None:
                                        data = retry_data
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
                            retry_data, retry_resp, _ = self._send_completion_request(
                                client, chat_url, payload, should_stream, t0, on_token
                            )
                            if retry_data is not None:
                                data = retry_data
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

                elapsed = max(0.001, round(time.perf_counter() - t0, 3))
                choices = data.get("choices") or []
                if not choices:
                    raise RuntimeError(f"Réponse vide reçue de LM Studio : {data}")

                choice = choices[0]
                finish_reason = choice.get("finish_reason")
                msg = choice.get("message") or {}
                raw_content = (msg.get("content") or choice.get("text") or "").strip()
                if not raw_content and (msg.get("reasoning_content") or msg.get("reasoning")):
                    raw_content = (msg.get("reasoning_content") or msg.get("reasoning") or "").strip()

                # Troncation de tokens détectée
                if finish_reason == "length" and attempt < max_retries:
                    continue

                cleaned_json = extract_json_payload(raw_content)

                if not cleaned_json or not cleaned_json.startswith("{") or not cleaned_json.endswith("}"):
                    val_err = ValueError(
                        f"Le modèle LLM n'a pas retourné d'objet JSON valide pour la carte {bundle.card_id} "
                        f"(contenu brut : {raw_content[:200]!r})"
                    )
                    last_error = val_err
                    if attempt < max_retries:
                        continue
                    raise val_err

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

        # Calcul des métriques de débit (tokens par seconde)
        usage = data.get("usage") if isinstance(data, dict) else {}
        completion_tokens = usage.get("completion_tokens") if isinstance(usage, dict) else None
        tokens_per_second: Optional[float] = None
        if isinstance(completion_tokens, (int, float)) and completion_tokens > 0 and elapsed > 0:
            tokens_per_second = round(float(completion_tokens) / float(elapsed), 1)

        metadata = CompilationMetadata(
            modelRepoId=self.repo_id,
            modelFilename=self.filename,
            compilationTimeSeconds=elapsed,
            compiledAtIso=datetime.now(timezone.utc).isoformat(),
            completionTokens=int(completion_tokens) if isinstance(completion_tokens, (int, float)) else None,
            tokensPerSecond=tokens_per_second,
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
        """Conservé pour compatibilité d'interface (le client ne modifie pas les modèles d'un serveur partagé)."""
        pass

    def close(self) -> None:
        """Ferme proprement le compilateur : ferme le tunnel SSH et nettoie les fichiers temporaires."""
        # 1. Fermeture du tunnel SSH
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
