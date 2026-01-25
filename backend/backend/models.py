"""
SQLAlchemy database models
"""
from sqlalchemy import Column, String, Integer, Boolean, DECIMAL, TIMESTAMP, ForeignKey, Text, ARRAY
from sqlalchemy.dialects.postgresql import UUID, JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
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
    taken_at = Column(TIMESTAMP(timezone=True), nullable=False)
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

    # Soft delete
    deleted_at = Column(TIMESTAMP(timezone=True))

    # Relationships
    user = relationship("User", back_populates="photos")
    analysis = relationship("PhotoAnalysis", back_populates="photo", uselist=False, cascade="all, delete-orphan")

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
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"))

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
