-- Migration: dlib 128-dim L2 → InsightFace 512-dim cosine
-- Data: 2026-02-12
-- ESEGUIRE SUL SERVER ESISTENTE PRIMA DI RIAVVIARE I CONTAINER
--
-- Uso:
--   docker exec -it photomemory-postgres psql -U photomemory -d photomemory -f /tmp/migration-insightface.sql
--
-- Oppure copiare prima nel container:
--   docker cp migration-insightface.sql photomemory-postgres:/tmp/
--   docker exec -it photomemory-postgres psql -U photomemory -d photomemory -f /tmp/migration-insightface.sql

BEGIN;

-- 1. Rimuovi indice L2 vecchio
DROP INDEX IF EXISTS idx_faces_embedding_l2;

-- 2. Invalida tutti gli embedding (incompatibili 128-dim → 512-dim)
UPDATE faces SET embedding = NULL;

-- 3. Cambia dimensione embedding da 128 a 512
ALTER TABLE faces ALTER COLUMN embedding TYPE vector(512);

-- 4. Crea nuovo indice cosine
CREATE INDEX IF NOT EXISTS idx_faces_embedding_cosine
    ON faces USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1);

-- 5. Reset face detection status → ri-analizza tutte le foto
UPDATE photos SET face_detection_status = 'pending', faces_detected_at = NULL
    WHERE face_detection_status IN ('completed', 'no_faces', 'failed');

-- 6. Reset cluster assignments (verranno ricalcolati)
UPDATE faces SET cluster_id = NULL, cluster_distance = NULL;

COMMIT;

-- Verifica
SELECT 'Migration completata!' AS status;
SELECT column_name, udt_name
FROM information_schema.columns
WHERE table_name = 'faces' AND column_name = 'embedding';
