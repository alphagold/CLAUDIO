-- Add user preferences for AI model and auto-analysis
-- Migration: 002_add_user_preferences.sql

ALTER TABLE users
ADD COLUMN IF NOT EXISTS preferred_model VARCHAR(50) DEFAULT 'moondream' NOT NULL,
ADD COLUMN IF NOT EXISTS auto_analyze BOOLEAN DEFAULT TRUE NOT NULL;

-- Update existing users to have default values
UPDATE users
SET preferred_model = 'moondream',
    auto_analyze = TRUE
WHERE preferred_model IS NULL OR auto_analyze IS NULL;
