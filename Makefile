# ==============================================================================
# Makefile Racine — Délègue toutes les commandes vers ./olydor/Makefile
# Les dossiers historiques poc-* sont conservés intacts à la racine.
# ==============================================================================

.DEFAULT_GOAL := help

Makefile: ;

.PHONY: help
help:
	@$(MAKE) -C olydor help

%:
	@$(MAKE) -C olydor $@
