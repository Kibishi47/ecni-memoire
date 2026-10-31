# Pokémon TCG Card Compiler (`card-compiler`)

Outil CLI autonome d'extraction et de compilation de cartes Pokémon TCG. Il interroge l'API **TCGdex**, charge un LLM local en mémoire via `llama-cpp-python` (accélération GPU Apple Metal M4 + **Constrained Decoding GBNF** natif via Pydantic V2) ou se connecte à un serveur **LM Studio** distant / local via son API REST OpenAI-compatible (directe par IP ou via tunnel SSH sécurisé). Il génère des modèles JSON déterministes et validés (`EngineCardModel`) conservés 100 % localement.

## Architecture & Caractéristiques

- **Deux Moteurs d'Inférence LLM au Choix** :
  - **Local Apple Metal (`local`)** : Chargement direct du modèle GGUF en RAM/VRAM unifiée via `llama-cpp-python` (`n_gpu_layers=-1`, Metal M4 natif, 0 démon externe).
  - **LM Studio (`lm_studio`)** : Connexion à un serveur LM Studio distant ou local via son API REST standard (`/v1/chat/completions`), soit en accès direct par IP/Port, soit au travers d'un tunnel SSH automatisé. Les modèles déjà chargés dans LM Studio sont auto-détectés.
- **Débit Réel (Streaming SSE & Tokens/sec effectifs)** : Affichage dynamique du débit d'inférence en direct dans la barre de progression Rich (`t/s` et tokens générés) et récapitulatif dans le tableau final. Le débit en tokens/sec est mesuré rigoureusement à partir de l'émission du premier token (hors délai TTFT / évaluation du prompt) pour refléter la véritable vitesse de décodage du modèle.
- **Contrôle Fin du Thinking & Raisonnement (`--thinking`, `--no-think`)** : Prise en charge universelle des modèles raisonnants (DeepSeek-R1, Qwen 2.5 / 3.8, QwQ). Permet de spécifier un niveau de réflexion (`--thinking low|medium|high|<tokens>`) ou `null` pour le désactiver. Si le modèle ne gère que les booléens (`enable_thinking`), `null` vaut `false` et tout autre niveau vaut `true`. Pour les modèles supportant `reasoning_effort`, le niveau est directement injecté avec les balises d'inhibition adaptées.
- **Normalisation Robuste des Enums & Auto-Guérison** : Validateurs Pydantic V2 pré-évaluation (`mode="before"`) avec dictionnaire de synonymes et correspondance floue (`difflib`) pour normaliser automatiquement les primitives (`EffectPrimitive`), motifs de carte morte (`DeadCardReason`), rôles stratégiques et timings sans plantage.
- **Court-circuit Déterministe des Énergies de Base** : Compilation instantanée (0 token, 0.00s) pour les Énergies de base.
- **Résolution de lignée d'évolution** : Calcul automatique du Pokémon de base racine (`rootBasicName`, `evolvesFrom`, `evolutionChain`) via l'index TCGdex pour alimenter les synergies et conditions de cartes mortes (ex. *Super Bonbon*).
- **Cache disque & Reprise sur lot** : Les réponses brutes TCGdex (`FR` + secours `EN`) sont mises en cache dans `data/raw_tcgdex/`, et les cartes compilées sont sauvegardées individuellement dans `data/compiled_cards/{id}.json` et consolidées dans `data/cards_database.json`.

## Structure du Projet

```text
card-compiler/
├── requirements.txt         # llama-cpp-python, huggingface-hub, httpx, pydantic>=2.9, typer, rich
├── setup_mac_metal.sh       # Installation et compilation Metal (CMAKE_ARGS="-DGGML_METAL=on")
├── .env.example             # Modèle de configuration d'environnement (LLM, hôte, SSH, provider)
├── README.md
├── data/
│   ├── raw_tcgdex/          # Cache JSON brut de TCGdex (.json) + _cards_index.json
│   ├── compiled_cards/      # 1 fichier JSON compilé par carte (.json)
│   └── cards_database.json  # Fichier consolidé regroupant toutes les cartes compilées
├── compiler/
│   ├── __init__.py
│   ├── schemas.py           # Tous les Enums stricts et modèles Pydantic V2 avec normaliseurs
│   ├── tcgdex_fetcher.py    # Client TCGdex (SDK officiel ou REST httpx) + cache disque + lignées
│   ├── llm_engine.py        # Moteur local Metal llama.cpp + Prompt Système PTCG + CoT GBNF
│   ├── lm_studio_compiler.py# Provider LM Studio (REST direct ou tunnel SSH, streaming t/s)
│   ├── post_processor.py    # Enrichissement déterministe et règles d'invariants PTCG
│   ├── static_cards.py      # Court-circuit déterministe pour Énergies de Base
│   └── cli.py               # Interface CLI Typer (run/compile, count, remaining, sync, inspect, stats)
└── tests/                   # Suite de tests unitaires (60 tests automatisés)
```

## Installation (Apple Silicon M4 / Metal)

```bash
chmod +x setup_mac_metal.sh
./setup_mac_metal.sh
source .venv/bin/activate
# Créer le fichier .env à partir de l'exemple
cp .env.example .env
```

---

## Configuration de LM Studio (`.env`)

Pour utiliser LM Studio sur une machine distante (ou locale) :

```dotenv
# 1. Fournisseur LLM
LLM_PROVIDER=lm_studio

# 2. Connexion Directe par IP Publique et Port (Recommandé)
LM_STUDIO_HOST=192.168.1.50      # Laissez vide pour localhost (127.0.0.1)
LM_STUDIO_PORT=1234
# Laissez VIDE pour utiliser automatiquement le modèle actuellement chargé dans LM Studio
LM_STUDIO_MODEL=

# Niveau de thinking pour les modèles raisonnants (DeepSeek, Qwen, QwQ) :
# 'null' (ou LM_STUDIO_DISABLE_THINKING=true) : Désactive le thinking (booléen -> false, reasoning_effort -> none)
# 'low', 'medium', 'high' : Active le thinking avec ce niveau d'effort (booléen -> true, reasoning_effort -> niveau)
LM_STUDIO_THINKING=
LM_STUDIO_DISABLE_THINKING=false

# 3. Tunnel SSH (Requis uniquement si le port 1234 n'est pas ouvert publiquement)
LM_STUDIO_USE_TUNNEL=false
SSH_HOST=
SSH_PORT=22
SSH_USER=
SSH_KEY_PATH=
SSH_PASSWORD=
LM_STUDIO_LOCAL_PORT=12345
```

---

## Guide des Commandes CLI

### 1. Compiler des Cartes (`run` / `compile`)

```bash
# Compilation du jeu de 11 cartes stratégiques de référence (mode test par défaut)
python -m compiler.cli run

# Compilation d'une ou plusieurs cartes spécifiques par identifiant TCGdex
python -m compiler.cli run --ids sv06.5-001,sv04-125

# Compilation via LM Studio (API REST)
python -m compiler.cli run --llm-provider lm_studio --ids sv06.5-001

# Désactiver le thinking / raisonnement pour LM Studio (gain de temps et économie de tokens)
python -m compiler.cli run --llm-provider lm_studio --ids sv06.5-001 --no-think
# ou équivalent via niveau 'null' :
python -m compiler.cli run --llm-provider lm_studio --ids sv06.5-001 --thinking null

# Définir un niveau d'effort de thinking ('low', 'medium', 'high' ou nombre de tokens)
python -m compiler.cli run --llm-provider lm_studio --ids sv06.5-001 --thinking low

# Compilation du format Standard complet (avec reprise sur cache)
python -m compiler.cli run --standard --limit 50

# Forcer la recompilation complète en écrasant les fichiers existants
python -m compiler.cli run --ids sv03-125 --force
```

**Options disponibles sur `run` (alias `compile`) :**
- `--mode test|standard` (`-m`) : Mode d'exécution (`test` : 11 cartes de référence, `standard` : format Standard).
- `--test` / `--standard` : Raccourcis pour forcer le mode test ou standard.
- `--ids <ID1,ID2>` : Liste d'identifiants TCGdex séparés par des virgules (ex: `sv06.5-001,sv03-125`).
- `--llm-provider local|lm_studio` (`-lp`) : Moteur LLM (`local` Apple Metal ou `lm_studio` REST).
- `--thinking <niveau>` (`-tk`) : Niveau de réflexion/thinking pour modèles raisonnants (`null` pour désactiver, ou `low`, `medium`, `high`, nombre de tokens). Si le modèle gère uniquement un booléen (`enable_thinking`), `null` vaut `false` et toute autre valeur vaut `true`.
- `--no-think` / `--disable-thinking` : Raccourci pour désactiver le mode réflexion/thinking (équivalent à `--thinking null`).
- `--tier qwen3|max|fast` (`-t`) : Palier de modèle en mode local (`qwen3` 14B Q6_K, `max` 30B/32B, `fast` 7B).
- `--fast` : Raccourci pour `--tier fast`.
- `--provider sdk|rest` (`-p`) : Fournisseur d'accès TCGdex (`sdk` : tcgdex-sdk officiel, `rest` : API HTTP directe).
- `--force` : Recompile même si la carte est déjà présente dans `data/compiled_cards/`.
- `--limit <N>` : Limite le nombre de cartes à traiter en mode standard.
- `--hf-token <TOKEN>` : Jeton Hugging Face pour accélérer les téléchargements de modèles GGUF.
- `--ssh-password <PWD>` : Mot de passe SSH (si connexion sans clé publique).
- `--prompt-ssh-password` : Demande le mot de passe SSH de façon masquée dans le terminal.

---

### 2. Connaître le Nombre de Cartes Restant à Compiler (`remaining`)

Affiche le statut global et le nombre de cartes restantes à compiler, avec la progression et la ventilation détaillée par extension :

```bash
# Vue synthétique globale
python -m compiler.cli remaining

# Filtrer sur une extension précise (ex: Mascarade Crépusculaire sv06, Fable Nébuleuse sv06.5)
python -m compiler.cli remaining --set sv06.5

# Afficher la liste complète des identifiants manquants
python -m compiler.cli remaining --set sv06.5 --details

# Mode discret pour scripts bash (affiche uniquement l'entier restant)
python -m compiler.cli remaining -q
```

**Options disponibles sur `remaining` (alias `todo`, `left`, `pending`, `a-compiler`) :**
- `--set <CODE>` (`-s`) : Filtre sur une extension (ex: `sv01`, `sv06.5`, `sve`).
- `--details` (`-d`) : Affiche la liste des identifiants manquants.
- `--quiet` (`-q`) : Affiche uniquement le nombre entier restant.
- `--mode standard|test|all` (`-m`) : Périmètre de calcul (défaut : `standard`).

---

### 3. Synchroniser la Base Globale Consolidée (`sync`)

Vérifie que toutes les cartes compilées présentes dans `data/compiled_cards/` figurent bien dans `data/cards_database.json`, et y ajoute automatiquement les cartes manquantes :

```bash
# Vérification et synchronisation automatique
python -m compiler.cli sync

# Afficher le détail des cartes ajoutées ou mises à jour
python -m compiler.cli sync --details

# Simuler la synchronisation sans écrire sur le disque
python -m compiler.cli sync --dry-run

# Forcer la réécriture des cartes déjà présentes si leur version disque a changé
python -m compiler.cli sync --update
```

**Options disponibles sur `sync` (alias `sync-database`, `sync-db`, `check-database`) :**
- `--details` (`-d`) : Affiche le tableau détaillé des cartes traitées.
- `--dry-run` (`-n`) : Simulation en lecture seule.
- `--update` (`-u`) : Met à jour les cartes existantes en cas de modification.
- `--db-path` (`-p`) : Chemin personnalisé vers un fichier JSON consolidé.

---

### 4. Compter les Cartes Compilées (`count`)

```bash
# Compteur global et ventilation par catégorie (Pokémon, Dresseurs, Énergies)
python -m compiler.cli count

# Afficher la liste de toutes les cartes compilées
python -m compiler.cli count --details

# Nombre seul pour scripts bash
python -m compiler.cli count --quiet
```

---

### 5. Inspecter le Modèle Compilé d'une Carte (`inspect`)

Affiche avec coloration syntaxique le JSON généré (`EngineCardModel`) pour une carte :

```bash
python -m compiler.cli inspect sv06.5-001
python -m compiler.cli inspect sv04-125
```

---

### 6. Statistiques & Validation d'Intégrité (`stats` / `validate`)

Valide l'ensemble des fichiers compilés contre les schémas Pydantic V2 et affiche la distribution des rôles stratégiques, des primitives d'effets et des métriques de temps :

```bash
python -m compiler.cli stats
```

---

## Exécution des Tests Unitaires

Le projet inclut une suite complète de 60 tests automatisés couvrant les validateurs de schémas, les normalisations d'enums, le streaming de débit, LM Studio (REST et tunnel SSH), les replis défensifs et le pipeline CLI :

```bash
PYTHONPATH=card-compiler python3 -m unittest discover -s card-compiler/tests -p "test_*.py"
```
