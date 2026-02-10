-- Migration 007: Aggiunge colonne mancanti a face_recognition_consent
-- La tabella era stata creata con una versione precedente senza consent_ip

ALTER TABLE face_recognition_consent
    ADD COLUMN IF NOT EXISTS consent_ip VARCHAR(45),
    ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS revoked_reason TEXT;
