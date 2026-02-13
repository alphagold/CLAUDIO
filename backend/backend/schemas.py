"""
Pydantic schemas for API request/response validation
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List
from datetime import datetime
from uuid import UUID


# User schemas
class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None


class UserCreate(UserBase):
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class UserResponse(UserBase):
    id: UUID
    is_admin: bool = False
    created_at: datetime

    class Config:
        from_attributes = True


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# Photo schemas
class PhotoBase(BaseModel):
    taken_at: datetime
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_name: Optional[str] = None


class PhotoCreate(PhotoBase):
    pass


class PhotoAnalysisResponse(BaseModel):
    description_full: str
    description_short: Optional[str]
    extracted_text: Optional[str]
    detected_objects: Optional[List[str]]
    detected_faces: int = 0
    scene_category: Optional[str]
    scene_subcategory: Optional[str]
    tags: Optional[List[str]]
    prompt_used: Optional[str] = None
    raw_response: Optional[str] = None
    model_version: Optional[str]
    processing_time_ms: Optional[int]
    confidence_score: Optional[float]

    class Config:
        from_attributes = True


class PhotoResponse(PhotoBase):
    id: UUID
    user_id: UUID
    original_path: str
    thumbnail_128_path: Optional[str]
    thumbnail_512_path: Optional[str]
    uploaded_at: datetime
    analysis_started_at: Optional[datetime]
    analyzed_at: Optional[datetime]
    analysis_duration_seconds: Optional[int]
    elapsed_time_seconds: Optional[int] = None  # Calculated elapsed time
    has_text: bool
    has_faces: bool
    is_food: bool
    is_document: bool
    file_size: Optional[int]
    width: Optional[int]
    height: Optional[int]
    face_detection_status: Optional[str] = None
    faces_detected_at: Optional[datetime] = None
    analysis: Optional[PhotoAnalysisResponse] = None

    class Config:
        from_attributes = True


class PhotosListResponse(BaseModel):
    photos: List[PhotoResponse]
    total: int
    skip: int
    limit: int


# Search schemas
class SearchQuery(BaseModel):
    query: str = Field(..., min_length=1, max_length=500)
    limit: int = Field(default=20, ge=1, le=100)
    offset: int = Field(default=0, ge=0)


class SearchResult(BaseModel):
    photo: PhotoResponse
    relevance_score: float
    match_type: str  # "text", "semantic", "tag", "object"


class SearchResponse(BaseModel):
    query: str
    total_results: int
    results: List[SearchResult]
    search_time_ms: int
    answer: Optional[str] = None  # Natural language answer


# Health check
class HealthResponse(BaseModel):
    status: str
    version: str
    timestamp: datetime
    services: dict
