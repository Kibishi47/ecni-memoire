# Pokémon TCG Card Compiler (`card-compiler`)

Compilateur et extracteur IA haute performance pour le Jeu de Cartes à Collectionner Pokémon (**Pokémon TCG - Format Standard**).

Il interroge l'API officielle **TCGdex**, charge des modèles d'IA locaux sur **Apple Silicon** (via **Apple MLX** natif ou **Metal llama.cpp** GBNF) ou se connecte à un serveur **LM Studio** distant. Il traduit chaque carte en un modèle formel déterministe, typé et validé par Pydantic V2 (`EngineCardModel`), prêt pour un moteur de simulation numérique.

---

## 🌟 Points Forts & Architecture

- **2 Modes de Travail au Choix** :
  - **Mode 1 (Single-Pass / Direct)** : L'IA produit directement le JSON formel à partir des données de la carte.
  - **Mode 2 (Two-Pass Découplé)** : Une IA de raisonnement approfondi (DeepSeek-R1) analyse d'abord les règles et génère un rapport textuel complet. Puis, l'IA 1 est **déchargée à 100 % de la mémoire**, et une IA de programmation (Qwen Coder) transforme ces analyses en JSON formel sans jamais saturer la RAM.
- **2 Paliers d'Intensité (`soft` et `intense`)** :
  - **`soft` (Par défaut, ~7-8 Go RAM)** : Conçu pour tourner confortablement en journée pendant que votre navigateur, IDE et autres applications sont ouverts.
  - **`intense` (~14-18 Go RAM)** : Conçu pour les sessions dédiées ou le mode nuit (AFK) avec les applications fermées.
- **Inférence Locale Apple Silicon Ultra-Rapide** :
  - **Apple MLX (`LOCAL_BACKEND=mlx`)** : Chargement direct en mémoire unifiée via `mlx-lm` avec streaming en temps réel (tokens/sec effectifs).
  - **Apple Metal GGUF (`LOCAL_BACKEND=llama_cpp`)** : Exécution locale Metal avec décodage contraint GBNF.
- **Support LM Studio Distant** : Connexion REST directe ou via tunnel SSH sécurisé avec parallélisation multi-slots.
- **Court-circuit Déterministe des Énergies de Base** : Compilation instantanée (0 token, 0.00s).
- **Reprise sur Cache Intelligente** : Les cartes et analyses déjà calculées ne sont jamais recalculées inutilement.

---

## 🔄 Comparatif des Modes de Travail

```mermaid
flowchart TD
    subgraph Mode1["Mode 1 : Inférence Directe (Single-Pass)"]
        A1["Données TCGdex"] --> B1["IA Générale (Qwen 2.5 Coder 14B/32B)"]
        B1 --> C1["Validation Pydantic V2"]
        C1 --> D1["JSON Formel (data/compiled_cards/)"]
    end

    subgraph Mode2["Mode 2 : Pipeline en 2 Étapes Découplées (Two-Pass)"]
        A2["Données TCGdex"] --> B2["Passe 1 : IA Raisonnement (DeepSeek-R1 Distill 14B)"]
        B2 --> C2["Analyses de Règles (data/reasoning_texts/)"]
        C2 --> D2["⚡ Déchargement strict de l'IA 1 (Libération RAM)"]
        D2 --> E2["Passe 2 : IA Coding (Qwen 2.5 Coder 7B/14B)"]
        E2 --> F2["Validation Pydantic V2"]
        F2 --> G2["JSON Formel (data/compiled_cards/)"]
    end
```

---

## 🎯 Matrice Officielle des Modèles

Le compilateur résout automatiquement le bon modèle selon vos choix de **Mode**, d'**Intensité** et de **Backend** :

| Mode | Étape / Phase | Intensité `soft` (Défaut - ~7-8 Go RAM) | Intensité `intense` (Mode AFK/Nuit - ~14-18 Go RAM) | Backend |
| :--- | :--- | :--- | :--- | :--- |
| **Mode 1** *(Direct)* | Passe Unique | `mlx-community/Qwen2.5-Coder-14B-Instruct-4bit` | `mlx-community/Qwen2.5-Coder-32B-Instruct-4bit` | **MLX** |
| **Mode 1** *(Direct)* | Passe Unique | `bartowski/Qwen2.5-Coder-14B-Instruct-GGUF` | `bartowski/Qwen2.5-Coder-32B-Instruct-GGUF` | **GGUF** |
| **Mode 2** *(Two-Pass)* | **Passe 1 : Raisonnement** | `mlx-community/DeepSeek-R1-Distill-Qwen-14B-4bit` | `mlx-community/DeepSeek-R1-Distill-Qwen-14B-8bit` | **MLX** |
| **Mode 2** *(Two-Pass)* | **Passe 1 : Raisonnement** | `bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF` *(Q4_K_M)* | `bartowski/DeepSeek-R1-Distill-Qwen-14B-GGUF` *(Q8_0)* | **GGUF** |
| **Mode 2** *(Two-Pass)* | **Passe 2 : Codage JSON** | `mlx-community/Qwen2.5-Coder-7B-Instruct-8bit` | `mlx-community/Qwen2.5-Coder-14B-Instruct-8bit` | **MLX** |
| **Mode 2** *(Two-Pass)* | **Passe 2 : Codage JSON** | `bartowski/Qwen2.5-Coder-7B-Instruct-GGUF` | `bartowski/Qwen2.5-Coder-14B-Instruct-GGUF` | **GGUF** |

> [!TIP]
> Tous les modèles en intensité **`soft`** consomment moins de **8 Go de mémoire unifiée**, garantissant une fluidité totale même sur un Mac avec 24 Go de RAM ayant déjà 16-17 Go utilisés par vos logiciels de travail.

---

## 📂 Structure du Répertoire

```text
card-compiler/
├── run_reasoning.py         # Script direct : Lance la Passe 1 (Raisonnement)
├── run_coding.py            # Script direct : Lance la Passe 2 (Codage JSON)
├── setup_mac_metal.sh       # Script d'installation automatique Metal & dépendances
├── requirements.txt         # Dépendances Python (mlx, llama-cpp-python, pydantic, typer, rich)
├── .env                     # Configuration active (modèle, mode, backend, intensité)
├── .env.example             # Modèle de configuration commenté
├── README.md                # Documentation complète
│
├── data/
│   ├── raw_tcgdex/          # Cache JSON brut des cartes téléchargées depuis TCGdex
│   ├── reasoning_texts/     # Analyses de règles générées en Passe 1 ({card_id}.json)
│   ├── compiled_cards/      # Modèles formels finaux compilés ({card_id}.json)
│   └── cards_database.json  # Base de données consolidée de toutes les cartes du jeu
│
├── compiler/
│   ├── models_config.py     # Matrice des modèles (soft/intense, single/two-pass, mlx/gguf)
│   ├── reasoning_engine.py  # Moteur de raisonnement expert PTCG (Passe 1)
│   ├── two_pass_pipeline.py # Orchestrateur Two-Pass avec libération stricte de mémoire
│   ├── mlx_engine.py        # Moteur Apple MLX natif safetensors
│   ├── llm_engine.py        # Moteur Apple Metal llama.cpp GGUF & prompts PTCG
│   ├── lm_studio_compiler.py# Moteur client LM Studio (REST direct ou tunnel SSH)
│   ├── schemas.py           # Schémas stricts Pydantic V2 & normalisation d'enums
│   ├── post_processor.py    # Enrichissement et règles d'invariants Pokémon TCG
│   ├── static_cards.py      # Court-circuit déterministe pour Énergies de Base
│   ├── tcgdex_fetcher.py    # Client TCGdex (SDK officiel ou REST httpx)
│   └── cli.py               # Interface CLI Typer unifiée
│
└── tests/                   # Suite complète de 96 tests unitaires automatisés
```

---

## 🚀 Installation Rapide (macOS Apple Silicon)

```bash
cd card-compiler

# 1. Rendre le script d'installation exécutable et le lancer
chmod +x setup_mac_metal.sh
./setup_mac_metal.sh

# 2. Activer l'environnement virtuel
source .venv/bin/activate

# 3. Créer votre fichier de configuration .env
cp .env.example .env
```

---

## ⚙️ Configuration (`.env`)

Éditez le fichier `.env` selon votre façon de travailler :

```dotenv
# Fournisseur LLM : 'local' (recommandé) ou 'lm_studio'
LLM_PROVIDER=local

# Mode de pipeline :
# - 'two_pass' : Double passe (1. Raisonnement approfondi -> 2. Codage JSON)
# - 'single'   : Passe directe (IA générale -> JSON immédiat)
PIPELINE_MODE=single

# Niveau d'intensité :
# - 'soft'    : ~7-8 Go RAM (sécurisé en journée avec navigateur/apps ouverts)
# - 'intense' : ~14-18 Go RAM (mode nuit / AFK avec apps fermées)
INTENSITY_MODE=soft

# Optimisation Apple Silicon : 'mlx' (natif, ultra-rapide) ou 'llama_cpp' (GGUF Metal)
LOCAL_BACKEND=mlx

# Phase par défaut en mode two_pass : 'all', 'reason', ou 'code'
PIPELINE_PHASE=all

# Gestion des erreurs : continuer sur la carte suivante sans interrompre le lot
CONTINUE_ON_ERROR=false

# Laissez ces champs VIDES pour que le compilateur choisisse automatiquement
# les meilleurs modèles selon PIPELINE_MODE et INTENSITY_MODE :
LLM_MODEL=
REASONING_MODEL=
CODING_MODEL=
```

---

## 📖 Guide d'Utilisation

### Option A : Le Mode Two-Pass (Recommandé pour une précision maximale)

#### Méthode 1 : En deux scripts séparés (Le contrôle total)
Vous pouvez lancer la génération des textes d'analyse, puis plus tard générer le JSON :

```bash
# Étape 1 : Générer les textes d'analyse de règles pour toutes les cartes cibles
# (Charge DeepSeek-R1, génère tous les textes dans data/reasoning_texts/, puis libère la mémoire)
python run_reasoning.py --ids sv08.5-001,sv04-125

# Étape 2 : Transformer ces analyses en JSON formel
# (Charge Qwen Coder, lit data/reasoning_texts/, compile dans data/compiled_cards/)
python run_coding.py --ids sv08.5-001,sv04-125
```

#### Méthode 2 : Via la CLI unifiée Typer
```bash
# Exécuter uniquement la Passe 1 (Raisonnement)
python -m compiler.cli reason --ids sv08.5-001

# Exécuter uniquement la Passe 2 (Codage JSON)
python -m compiler.cli code --ids sv08.5-001

# Enchaîner les 2 passes automatiquement avec libération mémoire intermédiaire garantie
python -m compiler.cli run --pipeline two_pass --phase all --ids sv08.5-001,sv04-125
```

---

### Option B : Le Mode Single-Pass (IA directe / Rapide)

```bash
# Compilation du lot test de référence (11 cartes stratégiques)
python -m compiler.cli run --pipeline single

# Compilation de cartes précises par identifiant TCGdex
python -m compiler.cli run --pipeline single --ids sv08.5-001,sv04-125,sv03-125

# Mode intense (pour les sessions de nuit / AFK)
python -m compiler.cli run --pipeline single --intensity intense --ids sv08.5-001
```

---

### Option C : Utilisation avec LM Studio (Machine Distante ou Déportée)

```bash
# Compilation via le serveur LM Studio actif
python -m compiler.cli run --llm-provider lm_studio --ids sv08.5-001

# Compilation multi-slots en parallèle (4 cartes traitées simultanément)
python -m compiler.cli run --llm-provider lm_studio -j 4 --standard --limit 50
```

---

## 🛠️ Outils de Maintenance & Suivi

La CLI intègre tous les outils nécessaires pour piloter l'avancement de votre base de données :

```bash
# 1. Connaître le nombre de cartes restantes à compiler
python -m compiler.cli remaining
python -m compiler.cli remaining --set sv08.5 --details

# 2. Compter les cartes déjà compilées sur le disque
python -m compiler.cli count
python -m compiler.cli count --details

# 3. Synchroniser la base de données consolidée data/cards_database.json
python -m compiler.cli sync
python -m compiler.cli sync --update

# 4. Inspecter visuellement le modèle JSON compilé d'une carte
python -m compiler.cli inspect sv08.5-001

# 5. Vérifier la conformité Pydantic V2 de toutes les cartes compilées
python -m compiler.cli stats
```

---

## 🧪 Tests Unitaires Automatisés

Le projet intègre une suite de **96 tests automatisés** validant l'ensemble de la chaîne :

```bash
PYTHONPATH=card-compiler python3 -m unittest discover -s card-compiler/tests -p "test_*.py"
```

---

## 💡 Résumé des Commandes Utiles

| Commande | Action |
| :--- | :--- |
| `python run_reasoning.py` | Exécute la Passe 1 (Raisonnement) et stocke dans `data/reasoning_texts/` |
| `python run_coding.py` | Exécute la Passe 2 (Codage JSON) et met à jour `cards_database.json` |
| `python -m compiler.cli reason` | Alias CLI pour la Passe 1 |
| `python -m compiler.cli code` | Alias CLI pour la Passe 2 |
| `python -m compiler.cli run` | Exécute le pipeline selon la configuration de votre `.env` |
| `python -m compiler.cli remaining` | Affiche les cartes restant à compiler |
| `python -m compiler.cli sync` | Synchronise `data/cards_database.json` |
| `python -m compiler.cli inspect <ID>` | Affiche le JSON d'une carte avec coloration syntaxique |
