-- PhotoMemory Database - Schema Completo
-- Versione: 1.0
-- Data: 2026-02-06

-- Abilita pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    is_admin BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    preferred_model VARCHAR(50) DEFAULT 'moondream' NOT NULL,
    auto_analyze BOOLEAN DEFAULT TRUE NOT NULL,
    remote_ollama_enabled BOOLEAN DEFAULT FALSE NOT NULL,
    remote_ollama_url VARCHAR(255),
    remote_ollama_model VARCHAR(100)
);

-- Photos table
CREATE TABLE IF NOT EXISTS photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    original_path TEXT NOT NULL,
    file_size BIGINT,
    mime_type VARCHAR(100),
    width INTEGER,
    height INTEGER,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    taken_at TIMESTAMP,
    camera_make VARCHAR(100),
    camera_model VARCHAR(100),
    iso INTEGER,
    aperture VARCHAR(20),
    shutter_speed VARCHAR(20),
    focal_length VARCHAR(20),
    gps_latitude DECIMAL(10, 8),
    gps_longitude DECIMAL(11, 8),
    location_name VARCHAR(255),
    analyzed_at TIMESTAMP,
    analysis_started_at TIMESTAMP,
    analysis_duration_seconds INTEGER
);

-- Photo Analysis table
CREATE TABLE IF NOT EXISTS photo_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    description_full TEXT,
    description_brief TEXT,
    detected_objects TEXT[],
    detected_faces INTEGER DEFAULT 0,
    scene_category VARCHAR(50),
    tags TEXT[],
    confidence_score DECIMAL(3, 2),
    model_version VARCHAR(50),
    extracted_text TEXT,
    embedding vector(384),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Albums table
CREATE TABLE IF NOT EXISTS albums (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    cover_photo_id UUID REFERENCES photos(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Album Photos junction table
CREATE TABLE IF NOT EXISTS album_photos (
    album_id UUID REFERENCES albums(id) ON DELETE CASCADE,
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (album_id, photo_id)
);

-- Face Recognition Consent table
CREATE TABLE IF NOT EXISTS face_recognition_consent (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    consent_given BOOLEAN NOT NULL DEFAULT FALSE,
    consent_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Persons table
CREATE TABLE IF NOT EXISTS persons (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(user_id, name)
);

-- Faces table
CREATE TABLE IF NOT EXISTS faces (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    person_id UUID REFERENCES persons(id) ON DELETE SET NULL,
    bbox_x INTEGER NOT NULL,
    bbox_y INTEGER NOT NULL,
    bbox_width INTEGER NOT NULL,
    bbox_height INTEGER NOT NULL,
    embedding vector(128) NOT NULL,
    detection_confidence DECIMAL(3, 2),
    face_quality_score DECIMAL(3, 2),
    cluster_id INTEGER,
    cluster_distance DECIMAL(5, 4),
    deleted_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Face Labels table
CREATE TABLE IF NOT EXISTS face_labels (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    face_id UUID REFERENCES faces(id) ON DELETE CASCADE,
    person_id UUID REFERENCES persons(id) ON DELETE CASCADE,
    labeled_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    confidence DECIMAL(3, 2) DEFAULT 1.0,
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(face_id, person_id)
);

-- Prompt Templates table
CREATE TABLE IF NOT EXISTS prompt_templates (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    prompt_text TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_photos_user_id ON photos(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_uploaded_at ON photos(uploaded_at);
CREATE INDEX IF NOT EXISTS idx_photos_analyzed_at ON photos(analyzed_at);
CREATE INDEX IF NOT EXISTS idx_photo_analysis_photo_id ON photo_analysis(photo_id);
CREATE INDEX IF NOT EXISTS idx_album_photos_album_id ON album_photos(album_id);
CREATE INDEX IF NOT EXISTS idx_album_photos_photo_id ON album_photos(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_photo_id ON faces(photo_id);
CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
CREATE INDEX IF NOT EXISTS idx_faces_cluster_id ON faces(cluster_id);

-- Vector similarity search index
CREATE INDEX IF NOT EXISTS idx_embedding ON photo_analysis USING ivfflat (embedding vector_cosine_ops);

-- Insert default prompt templates
INSERT INTO prompt_templates (name, description, prompt_text, is_default, is_active)
VALUES
(
    'structured_detailed',
    'Prompt strutturato con sezioni MAIUSCOLE per analisi dettagliate (default)',
    'Analizza questa immagine in italiano e fornisci informazioni dettagliate.{location_hint}

Rispondi usando ESATTAMENTE questo formato:

DESCRIZIONE COMPLETA:
Scrivi 4-5 frasi che descrivono cosa vedi: soggetto principale, oggetti visibili, colori, atmosfera, se è interno o esterno, dettagli importanti.

OGGETTI IDENTIFICATI:
laptop, mouse, tastiera, tazza, libro, finestra, lampada, scrivania, sedia, telefono
(elenca 8-12 oggetti separati da virgola)

PERSONE E VOLTI:
2 persone
(oppure: Nessuna persona visibile)

TESTO VISIBILE:
Welcome to Italy
(oppure: Nessun testo)

CATEGORIA SCENA:
indoor
(scegli una: indoor, outdoor, food, document, people, nature, urban, vehicle, other)

TAG CHIAVE:
lavoro, tecnologia, ufficio, moderno, professionale
(5-8 tag separati da virgola)

CONFIDENZA ANALISI:
0.85
(numero da 0.0 a 1.0)

Importante: non ripetere queste istruzioni, rispondi solo con le informazioni richieste.',
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

-- Insert default test user (password: test123)
INSERT INTO users (email, hashed_password, is_admin, preferred_model, auto_analyze)
VALUES (
    'test@example.com',
    '$2b$12$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQoeG6Lruj3vjPGga31lW',
    false,
    'moondream',
    true
)
ON CONFLICT (email) DO NOTHING;

-- Verification queries
SELECT 'Tabelle create:' as status;
SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;

SELECT 'Utenti creati:' as status;
SELECT email, is_admin FROM users;

SELECT 'Prompt templates:' as status;
SELECT name, is_default FROM prompt_templates;
