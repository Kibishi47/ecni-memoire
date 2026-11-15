# ==============================================================================
# Makefile — Écosystème Monorepo Olydor (https://olydor.app)
# Usage : make <cible> (ex: make help, make test, make deploy-local)
# ==============================================================================

SHELL := /bin/sh
.DEFAULT_GOAL := help

PNPM := pnpm
COMPOSE := docker compose --project-directory . -f docker/docker-compose.yml
COMPILER_DIR := tools/card-compiler
COMPILER_PYTHON := $(shell if [ -x "$(COMPILER_DIR)/.venv/bin/python" ]; then echo ".venv/bin/python"; else echo "python3"; fi)
NAMEGEN_DIR := tools/name-generator

.PHONY: help install build build-libs typecheck check clean \
        test test-engine test-ui test-api test-web test-insight test-arena \
        test-compiler test-name-generator test-all \
        dev dev-api dev-web dev-insight dev-arena \
        db-up db-migrate db-seed db-seed-cards db-seed-decks sync-cards \
        docker-build deploy-local up down restart logs ps

help: ## Affiche l'aide et la liste des commandes disponibles
	@echo ""
	@echo "Olydor Monorepo — Commandes disponibles :"
	@echo "------------------------------------------"
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  \033[36m%-22s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)
	@echo ""

# --- Installation & Build -----------------------------------------------------

install: ## Installe toutes les dépendances pnpm du monorepo
	$(PNPM) install

build-libs: ## Compile uniquement les packages partagés (@olydor/types, @olydor/engine, @olydor/ui)
	$(PNPM) --filter @olydor/types build
	$(PNPM) --filter @olydor/engine build
	$(PNPM) --filter @olydor/ui build

build: ## Compile l'ensemble du monorepo (packages + apps)
	$(PNPM) build

typecheck: build-libs ## Vérifie le typage TypeScript / Vue / Nuxt sur tout le monorepo
	$(PNPM) -r --filter './apps/*' prepare
	$(PNPM) typecheck

check: build typecheck test ## Exécute la suite complète de validation (build + typecheck + test)

clean: ## Supprime les artefacts de build (.nuxt, .output, dist, *.tsbuildinfo)
	rm -rf packages/*/dist packages/*/*.tsbuildinfo \
	       apps/*/dist apps/*/*.tsbuildinfo apps/*/.nuxt apps/*/.output \
	       .turbo .cache

# --- Tests Automatisés --------------------------------------------------------

test: build-libs ## Exécute tous les tests TypeScript/Vitest du monorepo (séquentiel par workspace)
	$(PNPM) test

test-engine: ## Tests unitaires du moteur @olydor/engine
	$(PNPM) --filter @olydor/engine test

test-ui: ## Tests unitaires du design system @olydor/ui
	$(PNPM) --filter @olydor/ui test

test-api: ## Tests d'intégration de l'API @olydor/api
	$(PNPM) --filter @olydor/api test

test-web: ## Tests du hub SSR @olydor/web
	$(PNPM) --filter @olydor/web test

test-insight: ## Tests du simulateur @olydor/insight
	$(PNPM) --filter @olydor/insight test

test-arena: ## Tests de l'arène Coming Soon @olydor/arena
	$(PNPM) --filter @olydor/arena test

test-compiler: ## Tests unitaires Python du compilateur de cartes (tools/card-compiler)
	cd $(COMPILER_DIR) && $(COMPILER_PYTHON) -m unittest discover -s tests -q

test-name-generator: ## Tests unitaires Python du générateur de nom (tools/name-generator)
	cd $(NAMEGEN_DIR) && python3 -m unittest discover -s tests -v

test-all: test test-compiler test-name-generator ## Exécute TOUS les tests (monorepo TS + outils Python)

# --- Développement Local (Sans Docker pour les apps) --------------------------

dev: build-libs ## Démarre les 4 applications en parallèle en mode dev (ports 3000..3003)
	$(PNPM) -r --parallel --filter './apps/*' dev

dev-api: build-libs ## Démarre uniquement l'API @olydor/api (http://localhost:3000)
	$(PNPM) dev:api

dev-web: build-libs ## Démarre uniquement le Hub @olydor/web (http://localhost:3001)
	$(PNPM) dev:web

dev-insight: build-libs ## Démarre uniquement le Simulateur @olydor/insight (http://localhost:3002)
	$(PNPM) dev:insight

dev-arena: build-libs ## Démarre uniquement l'Arène @olydor/arena (http://localhost:3003)
	$(PNPM) dev:arena

# --- Base de Données & Catalogue Cartes ---------------------------------------

db-up: ## Démarre uniquement le conteneur PostgreSQL local via Docker Compose
	$(COMPOSE) up -d postgres

db-migrate: ## Applique les migrations SQL PostgreSQL sur DATABASE_URL
	$(PNPM) --filter @olydor/api db:migrate

db-seed-cards: ## Peuple la table PostgreSQL 'cards' depuis tools/card-compiler/data/cards_database.json
	$(PNPM) --filter @olydor/api seed:cards

db-seed-decks: ## Peuple la table PostgreSQL 'meta_decks'
	$(PNPM) --filter @olydor/api seed:meta-decks

db-seed: db-seed-cards db-seed-decks ## Synchronise toutes les cartes et decks méta dans PostgreSQL

sync-cards: ## Régénère/synchronise tools/card-compiler/data/cards_database.json (local, non suivi par Git)
	cd $(COMPILER_DIR) && $(COMPILER_PYTHON) main.py sync

# --- Déploiement Local Docker Compose -----------------------------------------

docker-build: ## Construit toutes les images Docker (api, web, insight, arena)
	$(COMPOSE) build

deploy-local: ## Construit et lance toute la stack Olydor en arrière-plan (PostgreSQL + 4 services)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "Écosystème Olydor démarré en local :"
	@echo "  - API     : http://localhost:3000/health"
	@echo "  - Hub Web : http://localhost:3001"
	@echo "  - Insight : http://localhost:3002"
	@echo "  - Arena   : http://localhost:3003"
	@echo ""

up: ## Construit et lance toute la stack Docker Compose au premier plan
	$(COMPOSE) up --build

down: ## Arrête et supprime les conteneurs Docker locaux (conserve les volumes PostgreSQL)
	$(COMPOSE) down

restart: ## Redémarre les conteneurs Docker de la stack Olydor
	$(COMPOSE) restart

logs: ## Suit les logs en direct de toute la stack Docker
	$(COMPOSE) logs -f

ps: ## Affiche l'état des conteneurs Docker de la stack Olydor
	$(COMPOSE) ps
