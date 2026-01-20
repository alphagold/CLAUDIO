-- PostgreSQL initialization script for Photo Memory

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "vector";

-- Users table
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    full_name VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users(email);

-- Photos table
CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    -- File paths
    original_path VARCHAR(512) NOT NULL,
    thumbnail_128_path VARCHAR(512),
    thumbnail_512_path VARCHAR(512),

    -- Timestamps
    taken_at TIMESTAMPTZ NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    analyzed_at TIMESTAMPTZ,

    -- Location
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_name VARCHAR(255),

    -- Quick filters
    has_text BOOLEAN DEFAULT FALSE,
    has_faces BOOLEAN DEFAULT FALSE,
    is_food BOOLEAN DEFAULT FALSE,
    is_document BOOLEAN DEFAULT FALSE,

    -- Metadata
    exif_data JSONB,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,

    -- Soft delete
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_photos_user_taken ON photos(user_id, taken_at DESC);
CREATE INDEX idx_photos_user_filters ON photos(user_id, is_food, is_document) WHERE deleted_at IS NULL;
CREATE INDEX idx_photos_location ON photos(latitude, longitude) WHERE latitude IS NOT NULL;

-- Photo analysis (Vision AI results)
CREATE TABLE photo_analysis (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE UNIQUE,

    -- Vision AI output
    description_full TEXT NOT NULL,
    description_short VARCHAR(200),

    -- Extracted content
    extracted_text TEXT,
    detected_objects TEXT[],
    detected_faces INTEGER DEFAULT 0,

    -- Classification
    scene_category VARCHAR(50),
    scene_subcategory VARCHAR(50),

    -- Tags
    tags TEXT[],

    -- Structured data (for receipts, documents)
    structured_data JSONB,

    -- Embeddings for semantic search
    embedding vector(384),

    -- Metadata
    model_version VARCHAR(50),
    processing_time_ms INTEGER,
    confidence_score DECIMAL(3, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_analysis_photo ON photo_analysis(photo_id);
CREATE INDEX idx_analysis_tags ON photo_analysis USING GIN(tags);
CREATE INDEX idx_analysis_objects ON photo_analysis USING GIN(detected_objects);
CREATE INDEX idx_analysis_category ON photo_analysis(scene_category, scene_subcategory);
CREATE INDEX idx_analysis_embedding ON photo_analysis USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Full-text search index
CREATE INDEX idx_analysis_text_search ON photo_analysis USING GIN(
    to_tsvector('english',
        COALESCE(description_full, '') || ' ' ||
        COALESCE(extracted_text, '') || ' ' ||
        COALESCE(array_to_string(tags, ' '), '')
    )
);

-- Search history (for analytics and learning)
CREATE TABLE search_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),

    query_text TEXT NOT NULL,
    query_embedding vector(384),

    -- Results
    results_count INTEGER,
    top_photo_id UUID REFERENCES photos(id),
    clicked_photo_id UUID REFERENCES photos(id),

    -- User feedback
    was_relevant BOOLEAN,

    search_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_search_user_time ON search_history(user_id, created_at DESC);

-- Collections (smart albums)
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id),

    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Auto-collection rules
    is_smart BOOLEAN DEFAULT FALSE,
    rules JSONB,

    -- Visual
    cover_photo_id UUID REFERENCES photos(id),
    color_theme VARCHAR(7),

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE collection_photos (
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (collection_id, photo_id)
);

CREATE INDEX idx_collection_user ON collections(user_id);
CREATE INDEX idx_collection_photos_photo ON collection_photos(photo_id);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply trigger to users
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Apply trigger to collections
CREATE TRIGGER update_collections_updated_at BEFORE UPDATE ON collections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create default test user (password: test123)
-- Hash generato con bcrypt per "test123"
INSERT INTO users (email, password_hash, full_name) VALUES
    ('test@example.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewY5NU7MvLRoQ9K2', 'Test User');

-- Done
SELECT 'Database initialized successfully!' as message;
