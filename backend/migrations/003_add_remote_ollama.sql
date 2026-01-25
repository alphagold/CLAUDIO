-- Migration: Add remote Ollama server configuration to users table
-- Date: 2026-01-25

ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_ollama_enabled BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_ollama_url VARCHAR(255) DEFAULT 'http://localhost:11434';
ALTER TABLE users ADD COLUMN IF NOT EXISTS remote_ollama_model VARCHAR(50) DEFAULT 'moondream';

-- Update existing users to have default values
UPDATE users SET remote_ollama_enabled = FALSE WHERE remote_ollama_enabled IS NULL;
UPDATE users SET remote_ollama_url = 'http://localhost:11434' WHERE remote_ollama_url IS NULL;
UPDATE users SET remote_ollama_model = 'moondream' WHERE remote_ollama_model IS NULL;
