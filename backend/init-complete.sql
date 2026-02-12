-- PhotoMemory Database - Schema Completo
-- Versione: 2.0 - Allineato con SQLAlchemy models.py
-- Data: 2026-02-10

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    is_admin BOOLEAN DEFAULT FALSE NOT NULL,
    preferred_model VARCHAR(50) DEFAULT 'moondream' NOT NULL,
    auto_analyze BOOLEAN DEFAULT TRUE NOT NULL,
    remote_ollama_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    remote_ollama_url VARCHAR(255) DEFAULT 'http://localhost:11434',
    remote_ollama_model VARCHAR(50) DEFAULT 'moondream',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Photos
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,

    original_path VARCHAR(512) NOT NULL,
    thumbnail_128_path VARCHAR(512),
    thumbnail_512_path VARCHAR(512),

    taken_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    analysis_started_at TIMESTAMPTZ,
    analyzed_at TIMESTAMPTZ,
    analysis_duration_seconds INTEGER,

    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_name VARCHAR(255),

    has_text BOOLEAN DEFAULT FALSE,
    has_faces BOOLEAN DEFAULT FALSE,
    is_food BOOLEAN DEFAULT FALSE,
    is_document BOOLEAN DEFAULT FALSE,

    exif_data JSONB,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,

    faces_detected_at TIMESTAMPTZ,
    face_detection_status VARCHAR(20) DEFAULT 'pending',

    deleted_at TIMESTAMPTZ
);

-- Photo Analysis
CREATE TABLE IF NOT EXISTS photo_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photo_id UUID UNIQUE REFERENCES photos(id) ON DELETE CASCADE NOT NULL,

    description_full TEXT NOT NULL DEFAULT '',
    description_short VARCHAR(200),

    extracted_text TEXT,
    detected_objects TEXT[],
    detected_faces INTEGER DEFAULT 0,

    scene_category VARCHAR(50),
    scene_subcategory VARCHAR(50),

    tags TEXT[],
    structured_data JSONB,

    embedding vector(384),

    model_version VARCHAR(50),
    processing_time_ms INTEGER,
    confidence_score DECIMAL(3, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Collections
CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_smart BOOLEAN DEFAULT FALSE,
    rules JSONB,
    cover_photo_id UUID REFERENCES photos(id) ON DELETE SET NULL,
    color_theme VARCHAR(7),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Search History
CREATE TABLE IF NOT EXISTS search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),
    query_text TEXT NOT NULL,
    results_count INTEGER,
    top_photo_id UUID REFERENCES photos(id),
    clicked_photo_id UUID REFERENCES photos(id),
    was_relevant BOOLEAN,
    search_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Face Recognition Consent (user_id e' la PK, no id separato)
CREATE TABLE IF NOT EXISTS face_recognition_consent (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    consent_date TIMESTAMPTZ,
    consent_ip VARCHAR(45),
    revoked_at TIMESTAMPTZ,
    revoked_reason TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Persons
CREATE TABLE IF NOT EXISTS persons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    name VARCHAR(255),
    notes TEXT,
    representative_face_id UUID,
    photo_count INTEGER DEFAULT 0,
    first_seen_at TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ,
    cluster_confidence DECIMAL(3, 2) DEFAULT 0.80,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Faces
CREATE TABLE IF NOT EXISTS faces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE NOT NULL,
    person_id UUID REFERENCES persons(id) ON DELETE SET NULL,
    bbox_x INTEGER NOT NULL,
    bbox_y INTEGER NOT NULL,
    bbox_width INTEGER NOT NULL,
    bbox_height INTEGER NOT NULL,
    embedding vector(128) NOT NULL,
    detection_confidence DECIMAL(3, 2) DEFAULT 0.90,
    face_quality_score DECIMAL(3, 2),
    cluster_id INTEGER,
    cluster_distance DECIMAL(5, 4),
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- FK representative_face_id (aggiunto dopo faces)
ALTER TABLE persons ADD CONSTRAINT fk_persons_representative_face
    FOREIGN KEY (representative_face_id) REFERENCES faces(id) ON DELETE SET NULL
    DEFERRABLE INITIALLY DEFERRED;

-- Face Labels
CREATE TABLE IF NOT EXISTS face_labels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    face_id UUID REFERENCES faces(id) ON DELETE CASCADE NOT NULL,
    person_id UUID REFERENCES persons(id) ON DELETE CASCADE NOT NULL,
    labeled_by_user_id UUID REFERENCES users(id) NOT NULL,
    label_type VARCHAR(20) NOT NULL,
    confidence DECIMAL(3, 2) DEFAULT 1.00,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Prompt Templates
CREATE TABLE IF NOT EXISTS prompt_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    prompt_text TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_photos_taken_at ON photos(taken_at);
CREATE INDEX IF NOT EXISTS idx_photos_analyzed_at ON photos(analyzed_at);
CREATE INDEX IF NOT EXISTS idx_photos_deleted_at ON photos(deleted_at);
CREATE INDEX IF NOT EXISTS idx_photos_face_detection_status ON photos(face_detection_status);
CREATE INDEX IF NOT EXISTS idx_photos_not_deleted ON photos(user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_photo_analysis_photo_id ON photo_analysis(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
CREATE INDEX IF NOT EXISTS idx_faces_cluster_id ON faces(cluster_id);
CREATE INDEX IF NOT EXISTS idx_faces_not_deleted ON faces(photo_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id);
CREATE INDEX IF NOT EXISTS idx_prompt_templates_default ON prompt_templates(is_default) WHERE is_active = TRUE;

-- Vector similarity search index
CREATE INDEX IF NOT EXISTS idx_embedding ON photo_analysis USING ivfflat (embedding vector_cosine_ops);

-- Default prompt templates
INSERT INTO prompt_templates (name, description, prompt_text, is_default, is_active)
VALUES
(
    'simple_description',
    'Descrizione libera dettagliata - il parsing lo fa il backend (default)',
    'Descrivi in italiano questa immagine nel modo più dettagliato possibile.{location_hint} Descrivi solo ciò che è chiaramente visibile, senza ipotesi o supposizioni. Includi: oggetti principali, persone, colori, atmosfera, ambiente (interno o esterno). Se nell''immagine è presente testo leggibile (scritte, etichette, insegne, documenti), trascrivilo ESATTAMENTE mettendolo tra virgolette.',
    TRUE,
    TRUE
),
(
    'simple_natural',
    'Prompt semplice e naturale per descrizioni fluide',
    'Descrivi questa immagine in italiano in modo naturale e dettagliato.{location_hint}

Includi nella tua descrizione:
- Cosa vedi nell''immagine (scene generale, oggetti principali, persone se presenti)
- Colori dominanti e atmosfera
- Se è un ambiente interno o esterno
- Eventuali testi o scritte visibili

Scrivi in modo discorsivo e completo.',
    FALSE,
    TRUE
),
(
    'compact_json',
    'Prompt compatto per output JSON strutturato',
    'Analyze this image and provide a JSON response with: description (2-3 sentences), objects (array of 5-8 items), category (indoor/outdoor/food/document/people/nature/urban/vehicle/other), tags (array of 3-5 keywords).{location_hint}',
    FALSE,
    TRUE
)
ON CONFLICT (name) DO NOTHING;

-- Verifica
SELECT 'Tabelle create:' as status;
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
SELECT 'Prompt templates:' as status;
SELECT name, is_default FROM prompt_templates;
