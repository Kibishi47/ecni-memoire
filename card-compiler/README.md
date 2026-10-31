# Pokémon TCG Card Compiler (`card-compiler`)

Outil CLI autonome d'extraction et de compilation de cartes Pokémon TCG. Il interroge l'API **TCGdex**, charge directement un LLM local en mémoire via `llama-cpp-python` (accélération GPU Apple Metal M4 + **Constrained Decoding GBNF** natif via Pydantic V2) et génère les modèles JSON déterministes (`EngineCardModel`) sur le disque.

## Architecture & Caractéristiques

- **Zéro serveur / Zéro démon externe** : Aucun serveur FastAPI/Flask ni démon Ollama/LM Studio. Le modèle `.gguf` (`Qwen/Qwen2.5-Coder-14B-Instruct-GGUF` en `Q4_K_M` par défaut, ou `7B` avec `--fast`) est téléchargé automatiquement via `huggingface_hub` et chargé en RAM/VRAM avec `n_gpu_layers=-1`.
- **Constrained Decoding GBNF Natif** : Utilisation de `response_format={"type": "json_object", "schema": LLMCompiledCardPart.model_json_schema()}` pour garantir mathématiquement le respect des `Enum` fermés et du schéma Pydantic V2.
- **Résolution de lignée d'évolution** : Calcul automatique du Pokémon de base racine (`rootBasicName`, `evolvesFrom`) via l'API TCGdex pour alimenter les synergies et conditions de cartes mortes (ex. *Super Bonbon*).
- **Cache disque & Reprise sur lot** : Les réponses brutes TCGdex (`FR` + secours `EN`) sont mises en cache dans `data/raw_tcgdex/`, et les cartes compilées sont sauvegardées individuellement dans `data/compiled_cards/{id}.json` ainsi que consolidées dans `data/cards_database.json`.

## Structure du Projet

```text
card-compiler/
├── requirements.txt         # llama-cpp-python, huggingface-hub, httpx, pydantic>=2.9, typer, rich
├── setup_mac_metal.sh       # Installation et compilation Metal (CMAKE_ARGS="-DGGML_METAL=on")
├── README.md
├── data/
│   ├── raw_tcgdex/          # Cache JSON brut de TCGdex (.json) + _cards_index.json
│   ├── compiled_cards/      # 1 fichier JSON compilé par carte (.json)
│   └── cards_database.json  # Fichier consolidé regroupant toutes les cartes compilées
└── compiler/
    ├── __init__.py
    ├── schemas.py           # Tous les Enums stricts et modèles Pydantic V2
    ├── tcgdex_fetcher.py    # Client HTTP asynchrone + cache disque + résolveur de lignée d'évolution
    ├── llm_engine.py        # Chargement direct Llama() en RAM + Prompt Système PTCG + Constrained Decoding
    └── cli.py               # CLI Typer (commandes run/compile, inspect, stats/validate)
```

## Installation (Apple Silicon M4 / Metal)

```bash
chmod +x setup_mac_metal.sh
./setup_mac_metal.sh
source .venv/bin/activate
# Renseigne ton jeton Hugging Face dans .env (fichier ignoré par git)
cp .env.example .env
# Remplir HF_TOKEN=hf_... dans .env
```

## Utilisation du CLI

### 1. Compiler le jeu de 10 cartes stratégiques de référence (mode test par défaut)

```bash
python -m compiler.cli run --mode test
```

Options disponibles sur `run` (alias `compile`) :
- `--mode test` (défaut) : Compile les 10 cartes stratégiques de référence (`TEST_CARD_IDS`).
- `--mode standard` : Compile toutes les cartes légales au format Standard (`legal.standard == true`).
- `--ids sv04-125,sv03-125` : Compile uniquement la liste d'identifiants fournie.
- `--provider sdk|rest` (défaut : `sdk`) : Source des données TCGdex (SDK officiel `tcgdex-sdk` ou API REST `httpx`).
- `--llm-provider local|lm_studio` (défaut : `local`, ou configurable via `LLM_PROVIDER` dans `.env`) :
  - `local` : Moteur in-memory Apple Metal M4 local via `llama-cpp-python` (0 serveur externe).
  - `lm_studio` : Exécution sur LM Studio (local ou machine distante via SSH et tunnel sécurisé, pilotable avec `lms`). Les données et cartes générées restent 100 % locales sur votre machine.
- `--tier qwen3|max|fast` (défaut : `qwen3`) :
  - `qwen3` : `Qwen/Qwen3-14B-GGUF` (`Q6_K` / `Q5_K_M`, ~11-12 Go, sélection dynamique via `list_repo_files` et fallback automatique).
  - `max` : `Qwen/Qwen3-30B-A3B-GGUF` ou `Qwen/Qwen2.5-Coder-32B-Instruct-GGUF` (`Q4_K_M`, ~16-18.5 Go).
  - `fast` : `Qwen/Qwen2.5-Coder-7B-Instruct-GGUF` (`Q4_K_M`).
- `--hf-token <TOKEN>` : Jeton Hugging Face pour accélérer le téléchargement du modèle GGUF (peut aussi être configuré via `.env` ou `export HF_TOKEN="hf_..."`).
- `--fast` : Raccourci pour `--tier fast`.
- `--force` : Force la recompilation même si le fichier existe déjà dans `data/compiled_cards/`.

### 2. Exécution Distante sur Serveur GPU via SSH & LM Studio (`lms`)

Si vous disposez d'un serveur ou PC distant équipé d'un GPU plus puissant et de LM Studio avec son CLI `lms` :
1. Renseignez la configuration SSH dans votre fichier `.env` :
   ```bash
   LLM_PROVIDER=lm_studio
   SSH_HOST=ip_ou_domaine_serveur
   SSH_USER=ubuntu
   SSH_KEY_PATH=~/.ssh/id_ed25519
   LM_STUDIO_PORT=1234
   LM_STUDIO_LOCAL_PORT=12345
   LM_STUDIO_MODEL=qwen2.5-coder-14b-instruct
   LM_STUDIO_USE_TUNNEL=true
   LM_STUDIO_AUTO_START=true
   ```
2. Lancez la compilation depuis votre ordinateur :
   ```bash
   python -m compiler.cli run --llm-provider lm_studio
   ```
   *Un tunnel SSH sécurisé (`127.0.0.1:12345 -> 127.0.0.1:1234`) est ouvert automatiquement pendant le traitement, et **tous les fichiers générés restent stockés localement sur votre ordinateur** dans `data/compiled_cards/` sans nécessiter de transfert SFTP/rsync.*

### 3. Inspecter le modèle JSON d'une carte compilée

```bash
python -m compiler.cli inspect sv04-125
python -m compiler.cli inspect sv03-125
```

### 4. Compter les cartes compilées

```bash
python -m compiler.cli count
# Options : --details (-d) pour la liste complète, --quiet (-q) pour le nombre seul
```

### 5. Synchroniser le fichier global consolidé (`cards_database.json`)

Vérifie que toutes les cartes compilées dans `data/compiled_cards/` sont présentes dans le fichier JSON global (`data/cards_database.json`). Si des cartes sont manquantes, elles y sont automatiquement ajoutées :

```bash
python -m compiler.cli sync
```

Options disponibles sur `sync` (alias `sync-database`, `sync-db`, `check-database`) :
- `--details` (`-d`) : Affiche le tableau détaillé de toutes les cartes ajoutées.
- `--dry-run` (`-n`) : Simule la vérification sans écrire sur le disque.
- `--db-path` (`-p`) : Chemin alternatif vers un fichier JSON consolidé.
- `--update` (`-u`) : Met également à jour les cartes déjà existantes si leur version disque a changé.

### 6. Vérifier l'intégrité Pydantic et afficher les statistiques du corpus

```bash
python -m compiler.cli stats
```
