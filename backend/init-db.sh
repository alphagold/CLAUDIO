#!/bin/bash
set -e

echo "🔧 Inizializzazione database PhotoMemory..."

# Esegui tutte le migrations in ordine
echo "📋 Esecuzione migrations..."

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Migration 001: Schema iniziale
    $(cat /docker-entrypoint-initdb.d/migrations/001_init.sql)

    -- Migration 002: User preferences
    $(cat /docker-entrypoint-initdb.d/migrations/002_add_user_preferences.sql)

    -- Migration 003: Remote Ollama
    $(cat /docker-entrypoint-initdb.d/migrations/003_add_remote_ollama.sql)

    -- Migration 004: Face Recognition
    $(cat /docker-entrypoint-initdb.d/migrations/004_add_face_recognition.sql)

    -- Migration 005: Prompt Templates
    $(cat /docker-entrypoint-initdb.d/migrations/005_add_prompt_templates.sql)

    -- Migration 005 Fix: Prompt Template Fix
    $(cat /docker-entrypoint-initdb.d/migrations/005_fix_prompt_template.sql)

    -- Crea utente test di default (password: test123)
    INSERT INTO users (email, hashed_password, is_admin, preferred_model, auto_analyze)
    VALUES (
        'test@example.com',
        '\$2b\$12\$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
        false,
        'moondream',
        true
    )
    ON CONFLICT (email) DO NOTHING;

    -- Verifica tabelle create
    SELECT 'Tabelle create:' as status;
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

    -- Verifica utenti
    SELECT 'Utenti creati:' as status;
    SELECT email, is_admin FROM users;

    -- Verifica prompt templates
    SELECT 'Prompt templates:' as status;
    SELECT name, is_default FROM prompt_templates;

EOSQL

echo "✅ Database inizializzato correttamente!"
