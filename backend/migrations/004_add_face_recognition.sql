-- Migration 004: Face Recognition System
-- Adds complete face detection, recognition, and person management

-- Enable uuid extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================================================
-- PERSONS TABLE: Identified people (clusters of faces)
-- ============================================================================
CREATE TABLE persons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,

    -- Person information
    name VARCHAR(255),  -- NULL if not yet labeled
    notes TEXT,

    -- Representative face for display
    representative_face_id UUID,  -- FK added after faces table creation

    -- Statistics
    photo_count INTEGER DEFAULT 0,
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,

    -- Clustering metadata
    cluster_confidence DECIMAL(3, 2) DEFAULT 0.80,
    is_verified BOOLEAN DEFAULT FALSE,  -- Manual verification flag

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- FACES TABLE: Individual detected faces in photos
-- ============================================================================
CREATE TABLE faces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE NOT NULL,
    person_id UUID REFERENCES persons(id) ON DELETE SET NULL,

    -- Bounding box coordinates (pixel coordinates in original image)
    bbox_x INTEGER NOT NULL,
    bbox_y INTEGER NOT NULL,
    bbox_width INTEGER NOT NULL,
    bbox_height INTEGER NOT NULL,

    -- Face embedding vector (dlib 128-dimensional encoding)
    embedding vector(128) NOT NULL,

    -- Detection quality
    detection_confidence DECIMAL(3, 2) DEFAULT 0.90,
    face_quality_score DECIMAL(3, 2),  -- Sharpness, lighting, angle

    -- Clustering (temporary, for auto-grouping)
    cluster_id INTEGER,
    cluster_distance DECIMAL(5, 4),  -- Distance to cluster centroid

    -- Soft delete for GDPR
    deleted_at TIMESTAMPTZ,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add FK constraint for representative_face_id (after faces table exists)
ALTER TABLE persons
    ADD CONSTRAINT fk_persons_representative_face
    FOREIGN KEY (representative_face_id)
    REFERENCES faces(id) ON DELETE SET NULL;

-- ============================================================================
-- FACE_LABELS TABLE: Labeling history for audit trail
-- ============================================================================
CREATE TABLE face_labels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    face_id UUID REFERENCES faces(id) ON DELETE CASCADE NOT NULL,
    person_id UUID REFERENCES persons(id) ON DELETE CASCADE NOT NULL,
    labeled_by_user_id UUID REFERENCES users(id) NOT NULL,

    -- Label metadata
    label_type VARCHAR(20) NOT NULL,  -- 'manual', 'auto', 'suggestion'
    confidence DECIMAL(3, 2) DEFAULT 1.00,

    -- Timestamp
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- FACE_RECOGNITION_CONSENT TABLE: GDPR compliance
-- ============================================================================
CREATE TABLE face_recognition_consent (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,

    -- Consent status
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    consent_date TIMESTAMPTZ,
    consent_ip VARCHAR(45),  -- IPv4 or IPv6

    -- Revocation
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,

    -- Timestamps
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================================
-- INDEXES: Performance optimization
-- ============================================================================

-- HNSW index for fast similarity search on embeddings
CREATE INDEX idx_faces_embedding ON faces
    USING hnsw (embedding vector_cosine_ops);

-- Face lookups
CREATE INDEX idx_faces_photo ON faces(photo_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_faces_person ON faces(person_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_faces_cluster ON faces(cluster_id) WHERE cluster_id IS NOT NULL AND person_id IS NULL;

-- Person lookups
CREATE INDEX idx_persons_user ON persons(user_id);
CREATE INDEX idx_persons_name ON persons(name) WHERE name IS NOT NULL;

-- Label audit
CREATE INDEX idx_face_labels_face ON face_labels(face_id);
CREATE INDEX idx_face_labels_person ON face_labels(person_id);

-- Consent lookup
-- Already have primary key on user_id

-- ============================================================================
-- ALTER PHOTOS TABLE: Add face detection status
-- ============================================================================
ALTER TABLE photos ADD COLUMN faces_detected_at TIMESTAMPTZ;
ALTER TABLE photos ADD COLUMN face_detection_status VARCHAR(20) DEFAULT 'pending';

-- face_detection_status values:
-- 'pending'    - Not yet processed
-- 'processing' - Currently detecting faces
-- 'completed'  - Detection completed
-- 'failed'     - Detection failed
-- 'no_faces'   - No faces detected
-- 'skipped'    - User has no consent

CREATE INDEX idx_photos_face_detection_status ON photos(face_detection_status)
    WHERE face_detection_status IN ('pending', 'processing');

-- ============================================================================
-- TRIGGERS: Auto-update timestamps
-- ============================================================================

-- Update persons.updated_at on change
CREATE OR REPLACE FUNCTION update_persons_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_persons_updated_at
    BEFORE UPDATE ON persons
    FOR EACH ROW
    EXECUTE FUNCTION update_persons_updated_at();

-- Update persons.photo_count when faces are added/removed
CREATE OR REPLACE FUNCTION update_person_photo_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.person_id IS NOT NULL THEN
        UPDATE persons
        SET photo_count = (
            SELECT COUNT(DISTINCT photo_id)
            FROM faces
            WHERE person_id = NEW.person_id AND deleted_at IS NULL
        ),
        last_seen_at = (
            SELECT MAX(p.upload_date)
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            WHERE f.person_id = NEW.person_id AND f.deleted_at IS NULL
        )
        WHERE id = NEW.person_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.person_id != OLD.person_id THEN
        -- Update old person
        IF OLD.person_id IS NOT NULL THEN
            UPDATE persons
            SET photo_count = (
                SELECT COUNT(DISTINCT photo_id)
                FROM faces
                WHERE person_id = OLD.person_id AND deleted_at IS NULL
            )
            WHERE id = OLD.person_id;
        END IF;
        -- Update new person
        IF NEW.person_id IS NOT NULL THEN
            UPDATE persons
            SET photo_count = (
                SELECT COUNT(DISTINCT photo_id)
                FROM faces
                WHERE person_id = NEW.person_id AND deleted_at IS NULL
            ),
            last_seen_at = (
                SELECT MAX(p.upload_date)
                FROM faces f
                JOIN photos p ON f.photo_id = p.id
                WHERE f.person_id = NEW.person_id AND f.deleted_at IS NULL
            )
            WHERE id = NEW.person_id;
        END IF;
    ELSIF TG_OP = 'DELETE' AND OLD.person_id IS NOT NULL THEN
        UPDATE persons
        SET photo_count = (
            SELECT COUNT(DISTINCT photo_id)
            FROM faces
            WHERE person_id = OLD.person_id AND deleted_at IS NULL
        )
        WHERE id = OLD.person_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_person_photo_count
    AFTER INSERT OR UPDATE OR DELETE ON faces
    FOR EACH ROW
    EXECUTE FUNCTION update_person_photo_count();

-- ============================================================================
-- COMMENTS: Documentation
-- ============================================================================

COMMENT ON TABLE persons IS 'Identified people from face clustering';
COMMENT ON TABLE faces IS 'Individual face detections with 128-dim embeddings';
COMMENT ON TABLE face_labels IS 'Audit trail for face labeling actions';
COMMENT ON TABLE face_recognition_consent IS 'GDPR consent tracking';

COMMENT ON COLUMN faces.embedding IS 'dlib 128-dimensional face encoding for similarity matching';
COMMENT ON COLUMN faces.cluster_id IS 'Temporary cluster assignment from DBSCAN, NULL after manual labeling';
COMMENT ON COLUMN persons.representative_face_id IS 'Best quality face to represent this person';
COMMENT ON COLUMN persons.cluster_confidence IS 'DBSCAN clustering confidence score';
