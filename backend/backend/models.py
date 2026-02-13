"""
SQLAlchemy database models
"""
from sqlalchemy import Column, String, Integer, Boolean, DECIMAL, TIMESTAMP, ForeignKey, Text, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from pgvector.sqlalchemy import Vector
import uuid
from datetime import datetime, timezone
from typing import Optional
from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    full_name = Column(String(255))
    is_admin = Column(Boolean, default=False, nullable=False)
    preferred_model = Column(String(50), default="moondream", nullable=False)
    auto_analyze = Column(Boolean, default=True, nullable=False)
    remote_ollama_enabled = Column(Boolean, default=False, nullable=False)
    remote_ollama_url = Column(String(255), default="http://localhost:11434")
    remote_ollama_model = Column(String(50), default="moondream")
    text_model = Column(String(100), default="llama3.2:latest")
    text_use_remote = Column(Boolean, default=False, nullable=False)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    photos = relationship("Photo", back_populates="user", cascade="all, delete-orphan")
    collections = relationship("Collection", back_populates="user", cascade="all, delete-orphan")


class Photo(Base):
    __tablename__ = "photos"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # File paths
    original_path = Column(String(512), nullable=False)
    thumbnail_128_path = Column(String(512))
    thumbnail_512_path = Column(String(512))

    # Timestamps
    taken_at = Column(TIMESTAMP(timezone=True), nullable=False, index=True)
    uploaded_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    analysis_started_at = Column(TIMESTAMP(timezone=True))
    analyzed_at = Column(TIMESTAMP(timezone=True))
    analysis_duration_seconds = Column(Integer)  # Total time to complete analysis

    # Location
    latitude = Column(DECIMAL(10, 8))
    longitude = Column(DECIMAL(11, 8))
    location_name = Column(String(255))

    # Quick filters
    has_text = Column(Boolean, default=False)
    has_faces = Column(Boolean, default=False)
    is_food = Column(Boolean, default=False)
    is_document = Column(Boolean, default=False)

    # Metadata
    exif_data = Column(JSONB)
    file_size = Column(Integer)
    width = Column(Integer)
    height = Column(Integer)

    # Face detection
    faces_detected_at = Column(TIMESTAMP(timezone=True))
    face_detection_status = Column(String(20), default="pending", index=True)  # pending, processing, completed, failed, no_faces, skipped

    # Soft delete
    deleted_at = Column(TIMESTAMP(timezone=True), index=True)

    # Relationships
    user = relationship("User", back_populates="photos")
    analysis = relationship("PhotoAnalysis", back_populates="photo", uselist=False, cascade="all, delete-orphan")
    faces = relationship("Face", back_populates="photo", cascade="all, delete-orphan")

    @property
    def elapsed_time_seconds(self) -> Optional[int]:
        """Calculate elapsed analysis time in seconds"""
        if not self.analysis_started_at:
            return None

        if self.analyzed_at and self.analysis_duration_seconds:
            return self.analysis_duration_seconds

        if not self.analyzed_at and self.analysis_started_at:
            elapsed = (datetime.now(timezone.utc) - self.analysis_started_at).total_seconds()
            return int(elapsed)

        return None


class PhotoAnalysis(Base):
    __tablename__ = "photo_analysis"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    photo_id = Column(UUID(as_uuid=True), ForeignKey("photos.id", ondelete="CASCADE"), unique=True, nullable=False)

    # Vision AI output
    description_full = Column(Text, nullable=False)
    description_short = Column(String(200))

    # Extracted content
    extracted_text = Column(Text)
    detected_objects = Column(ARRAY(Text))
    detected_faces = Column(Integer, default=0)

    # Classification
    scene_category = Column(String(50))
    scene_subcategory = Column(String(50))

    # Tags
    tags = Column(ARRAY(Text))

    # Structured data
    structured_data = Column(JSONB)

    # Embeddings (pgvector)
    # Note: embedding column definito manualmente in init.sql

    # Prompt e risposta raw (per tracciabilità)
    prompt_used = Column(Text)
    raw_response = Column(Text)

    # Metadata
    model_version = Column(String(50))
    processing_time_ms = Column(Integer)
    confidence_score = Column(DECIMAL(3, 2))
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Relationships
    photo = relationship("Photo", back_populates="analysis")


class SearchHistory(Base):
    __tablename__ = "search_history"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), index=True)

    query_text = Column(Text, nullable=False)
    # query_embedding column defined in init.sql

    # Results
    results_count = Column(Integer)
    top_photo_id = Column(UUID(as_uuid=True), ForeignKey("photos.id"))
    clicked_photo_id = Column(UUID(as_uuid=True), ForeignKey("photos.id"))

    # User feedback
    was_relevant = Column(Boolean)

    search_time_ms = Column(Integer)
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class Collection(Base):
    __tablename__ = "collections"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    name = Column(String(255), nullable=False)
    description = Column(Text)

    # Auto-collection rules
    is_smart = Column(Boolean, default=False)
    rules = Column(JSONB)

    # Visual
    cover_photo_id = Column(UUID(as_uuid=True), ForeignKey("photos.id"))
    color_theme = Column(String(7))

    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    user = relationship("User", back_populates="collections")


# ============================================================================
# FACE RECOGNITION MODELS
# ============================================================================

class Person(Base):
    """Identified person (cluster of faces)"""
    __tablename__ = "persons"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Person information
    name = Column(String(255))  # NULL if not yet labeled
    notes = Column(Text)

    # Representative face for display
    representative_face_id = Column(UUID(as_uuid=True), ForeignKey("faces.id", ondelete="SET NULL"))

    # Statistics
    photo_count = Column(Integer, default=0)
    first_seen_at = Column(TIMESTAMP(timezone=True))
    last_seen_at = Column(TIMESTAMP(timezone=True))

    # Clustering metadata
    cluster_confidence = Column(DECIMAL(3, 2), default=0.80)
    is_verified = Column(Boolean, default=False)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationships
    faces = relationship("Face", back_populates="person", foreign_keys="Face.person_id")
    representative_face = relationship("Face", foreign_keys=[representative_face_id], post_update=True)


class Face(Base):
    """Individual detected face in a photo"""
    __tablename__ = "faces"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    photo_id = Column(UUID(as_uuid=True), ForeignKey("photos.id", ondelete="CASCADE"), nullable=False)
    person_id = Column(UUID(as_uuid=True), ForeignKey("persons.id", ondelete="SET NULL"))

    # Bounding box coordinates (pixel coordinates in original image)
    bbox_x = Column(Integer, nullable=False)
    bbox_y = Column(Integer, nullable=False)
    bbox_width = Column(Integer, nullable=False)
    bbox_height = Column(Integer, nullable=False)

    # Face embedding vector (InsightFace buffalo_l 512-dimensional, cosine similarity)
    # nullable=True per volti aggiunti manualmente (senza embedding)
    embedding = Column(Vector(512))

    # Detection quality
    detection_confidence = Column(DECIMAL(3, 2), default=0.90)
    face_quality_score = Column(DECIMAL(3, 2))

    # Clustering (temporary, for auto-grouping)
    cluster_id = Column(Integer)
    cluster_distance = Column(DECIMAL(5, 4))

    # Soft delete for GDPR
    deleted_at = Column(TIMESTAMP(timezone=True))

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Relationships
    photo = relationship("Photo", back_populates="faces")
    person = relationship("Person", back_populates="faces", foreign_keys=[person_id])
    labels = relationship("FaceLabel", back_populates="face", cascade="all, delete-orphan")


class FaceLabel(Base):
    """Labeling history for audit trail"""
    __tablename__ = "face_labels"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    face_id = Column(UUID(as_uuid=True), ForeignKey("faces.id", ondelete="CASCADE"), nullable=False)
    person_id = Column(UUID(as_uuid=True), ForeignKey("persons.id", ondelete="CASCADE"), nullable=False)
    labeled_by_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)

    # Label metadata
    label_type = Column(String(20), nullable=False)  # 'manual', 'auto', 'suggestion'
    confidence = Column(DECIMAL(3, 2), default=1.00)

    # Timestamp
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())

    # Relationships
    face = relationship("Face", back_populates="labels")


class FaceRecognitionConsent(Base):
    """GDPR compliance for face recognition"""
    __tablename__ = "face_recognition_consent"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)

    # Consent status
    consent_given = Column(Boolean, nullable=False, default=False)
    consent_date = Column(TIMESTAMP(timezone=True))
    consent_ip = Column(String(45))  # IPv4 or IPv6

    # Revocation
    revoked_at = Column(TIMESTAMP(timezone=True))
    revoked_reason = Column(Text)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


# ============================================================================
# PROMPT TEMPLATES (Configurable AI Prompts)
# ============================================================================

# ============================================================================
# MEMORY SYSTEM MODELS
# ============================================================================

class MemoryIndex(Base):
    """Indice semantico globale per ricerca conversazionale"""
    __tablename__ = "memory_index"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    # Tipo entita' indicizzata
    entity_type = Column(String(50), nullable=False)  # 'face', 'place', 'object', 'text', 'date', 'event'
    entity_id = Column(UUID(as_uuid=True))  # FK a foto/persona/ecc

    # Contenuto testuale indicizzato
    content = Column(Text, nullable=False)

    # Embedding semantico (sentence-transformers 384-dim)
    # Definito in init-complete.sql: embedding vector(384)

    # Metadata aggiuntivi
    extra_metadata = Column("metadata", JSONB)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class MemoryConversation(Base):
    """Conversazioni Q&A memorizzate"""
    __tablename__ = "memory_conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    question = Column(Text, nullable=False)
    answer = Column(Text, nullable=False)

    # Contesto: foto/persone coinvolte
    context = Column(JSONB)

    # Feedback utente
    feedback = Column(String(20))  # 'positive', 'negative', 'corrected'

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())


class MemoryDirective(Base):
    """Direttive personali (estratte o manuali)"""
    __tablename__ = "memory_directives"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    directive = Column(Text, nullable=False)
    source = Column(String(20), nullable=False, default="manual")  # 'auto', 'manual'
    confidence = Column(DECIMAL(3, 2), default=1.00)
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())


class PromptTemplate(Base):
    """Configurable AI prompt templates for photo analysis"""
    __tablename__ = "prompt_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Template identification
    name = Column(String(100), unique=True, nullable=False)
    description = Column(Text)

    # Prompt content (supports {variable} placeholders)
    prompt_text = Column(Text, nullable=False)

    # Flags
    is_default = Column(Boolean, default=False, nullable=False)
    is_active = Column(Boolean, default=True, nullable=False)

    # Timestamps
    created_at = Column(TIMESTAMP(timezone=True), server_default=func.now())
    updated_at = Column(TIMESTAMP(timezone=True), server_default=func.now(), onupdate=func.now())
