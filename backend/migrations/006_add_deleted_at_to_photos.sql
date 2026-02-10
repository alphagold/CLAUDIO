-- Migration 006: Aggiunge colonna deleted_at alla tabella photos
-- Necessaria per soft-delete delle foto

ALTER TABLE photos
    ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Indice per query efficienti su foto non eliminate
CREATE INDEX IF NOT EXISTS idx_photos_user_filters
    ON photos(user_id, is_food, is_document)
    WHERE deleted_at IS NULL;
