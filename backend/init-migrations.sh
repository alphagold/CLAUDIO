#!/bin/bash
set -e

# Variabili database da environment
PGHOST="postgres"
PGUSER="photomemory"
PGPASSWORD="photomemory123"
PGDATABASE="photomemory"

export PGHOST PGUSER PGPASSWORD PGDATABASE

echo "🔄 Attendo PostgreSQL..."
until psql -c '\q' 2>/dev/null; do
  echo "  PostgreSQL non ancora pronto, attendo..."
  sleep 2
done

echo "✅ PostgreSQL pronto!"

echo "📋 Esecuzione migrations..."

# Esegui tutte le migrations in ordine
for migration in /app/migrations/*.sql; do
  if [ -f "$migration" ]; then
    echo "  - Esecuzione $(basename $migration)..."
    psql -f "$migration" || echo "  ⚠️ Warning: $(basename $migration) già applicata o errore"
  fi
done

echo "✅ Migrations completate!"

echo "👤 Creazione admin user..."
psql -c "INSERT INTO users (email, hashed_password, is_admin, preferred_model, auto_analyze)
VALUES (
  'admin@photomemory.local',
  '\$2b\$12\$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5oi4GXW3nz7Om',
  true,
  'qwen3-vl-clean:latest',
  true
)
ON CONFLICT (email) DO NOTHING;" 2>/dev/null && echo "✅ Admin user: admin@photomemory.local / password" || echo "  ℹ️ Admin user già esistente"

# Avvia l'applicazione FastAPI
echo "🚀 Avvio FastAPI..."
cd /app
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
