# Outils Offline & CLI (`tools/`)

Ce dossier centralise tous les programmes offline et utilitaires en ligne de commande de l'écosystème **Olydor** :

- **`tools/card-compiler/`** : Compilateur hybride déterministe + LLM (Qwen2.5-Coder / MLX / llama.cpp) permettant de télécharger les données brutes depuis TCGdex et de compiler les modèles JSON stricts `EngineCardModel` des cartes du format Standard Pokémon TCG.
- **Futurs utilitaires** : Scrapers de tournois Limitless, générateurs de datasets d'entraînement pour Pythia, et scripts d'audit qualité.

## Utilisation rapide des outils

### Compilateur de cartes (`tools/card-compiler/`)

```bash
cd tools/card-compiler
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 main.py --help
```

> Les poids locaux (`.gguf`), environnements `.venv/`, fichiers bruts intermédiaires (`raw_tcgdex/*.json`, `compiled_cards/*.json`), bases JSON consolidées (`cards_database.json`) et exports (`output/`) sont exclus du suivi Git.
