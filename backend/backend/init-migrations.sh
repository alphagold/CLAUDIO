#!/bin/bash
set -e

echo "🔄 Attendo PostgreSQL pronto..."

# Attendi che PostgreSQL sia disponibile e risponda
until curl -s postgres:5432 > /dev/null 2>&1 || nc -z postgres 5432; do
  echo "  PostgreSQL non ancora pronto, attendo 2 secondi..."
  sleep 2
done

echo "✅ PostgreSQL disponibile!"

# Attendi che il database sia effettivamente pronto per query
sleep 5

echo "🚀 Avvio FastAPI..."
cd /app
exec uvicorn main:app --host 0.0.0.0 --port 8000 --reload
