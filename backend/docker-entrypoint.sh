#!/bin/sh
set -e

# ==============================================================================
# Entrypoint Docker pour Pokémon TCG Backend (Optimisé Coolify)
# ==============================================================================

# 1. Exécution automatique des migrations SQL au démarrage (si DATABASE_URL est défini)
if [ "$AUTO_MIGRATE" != "false" ] && [ -n "$DATABASE_URL" ]; then
  echo "==> [Coolify Entrypoint] Vérification de PostgreSQL et application des migrations..."
  MAX_RETRIES=${MIGRATION_MAX_RETRIES:-30}
  RETRY_INTERVAL=${MIGRATION_RETRY_INTERVAL:-2}
  COUNT=0

  until node dist/db/migrate.js || [ "$COUNT" -ge "$MAX_RETRIES" ]; do
    COUNT=$((COUNT + 1))
    echo "==> [Coolify Entrypoint] Base indisponible, nouvelle tentative dans ${RETRY_INTERVAL}s... ($COUNT/$MAX_RETRIES)"
    sleep "$RETRY_INTERVAL"
  done

  if [ "$COUNT" -ge "$MAX_RETRIES" ]; then
    echo "==> [Coolify Entrypoint] ERREUR : Impossible d'appliquer les migrations après $MAX_RETRIES tentatives."
    exit 1
  fi
  echo "==> [Coolify Entrypoint] Migrations SQL appliquées avec succès."
fi

# 2. Amorçage automatique optionnel si AUTO_SEED=true
if [ "$AUTO_SEED" = "true" ] && [ -n "$DATABASE_URL" ]; then
  echo "==> [Coolify Entrypoint] AUTO_SEED=true détecté : amorçage des cartes et decks..."
  node dist/scripts/seedCards.js || echo "==> [Coolify Entrypoint] seedCards ignoré ou catalogue non trouvé."
  node dist/scripts/seedMetaDecks.js || echo "==> [Coolify Entrypoint] seedMetaDecks ignoré."
fi

# 3. Exécution de la commande principale (ex: node dist/server.js)
exec "$@"
