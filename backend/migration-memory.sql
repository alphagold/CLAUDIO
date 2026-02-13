-- Migration: Aggiunta tabelle memoria conversazionale (P4)
-- Eseguire su DB esistente dopo aggiornamento codice

BEGIN;

-- Memory Index (indice semantico globale)
CREATE TABLE IF NOT EXISTS memory_index (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    entity_type VARCHAR(50) NOT NULL,
    entity_id UUID,
    content TEXT NOT NULL,
    embedding vector(384),
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memory Conversations (Q&A memorizzate)
CREATE TABLE IF NOT EXISTS memory_conversations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    question TEXT NOT NULL,
    answer TEXT NOT NULL,
    context JSONB,
    feedback VARCHAR(20),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Memory Directives (direttive personali)
CREATE TABLE IF NOT EXISTS memory_directives (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE NOT NULL,
    directive TEXT NOT NULL,
    source VARCHAR(20) NOT NULL DEFAULT 'manual',
    confidence DECIMAL(3, 2) DEFAULT 1.00,
    is_active BOOLEAN DEFAULT TRUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_memory_index_user_id ON memory_index(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_index_entity_type ON memory_index(entity_type);
CREATE INDEX IF NOT EXISTS idx_memory_conversations_user_id ON memory_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_directives_user_id ON memory_directives(user_id);
CREATE INDEX IF NOT EXISTS idx_memory_directives_active ON memory_directives(user_id) WHERE is_active = TRUE;

COMMIT;
