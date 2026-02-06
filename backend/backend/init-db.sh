#!/bin/bash
set -e

echo "🔧 Inizializzazione database PhotoMemory..."
echo "📋 Creazione schema completo..."

# Esegui lo schema completo in un unico file
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f /docker-entrypoint-initdb.d/init-complete.sql

echo "✅ Database inizializzato correttamente!"
