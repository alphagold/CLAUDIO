-- Migration: Aggiunge colonna text_model alla tabella users
-- Per selezionare modello Ollama separato per memoria e diario (non vision)
-- Eseguire su DB esistente: docker exec -it photomemory-postgres psql -U photomemory -d photomemory -f /docker-entrypoint-initdb.d/migration-text-model.sql

ALTER TABLE users ADD COLUMN IF NOT EXISTS text_model VARCHAR(100) DEFAULT 'llama3.2:latest';
