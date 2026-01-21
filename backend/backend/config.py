"""
Configuration settings for Photo Memory backend
"""
from pydantic_settings import BaseSettings
from typing import Optional


class Settings(BaseSettings):
    # API Settings
    APP_NAME: str = "Photo Memory API"
    VERSION: str = "1.0.0"
    DEBUG: bool = True

    # Database
    DATABASE_URL: str = "postgresql://photomemory:photomemory123@postgres:5432/photomemory"

    # Redis
    REDIS_URL: str = "redis://redis:6379/0"

    # Ollama Vision AI
    OLLAMA_HOST: str = "http://ollama:11434"
    OLLAMA_MODEL_FAST: str = "moondream"  # 2B, veloce (1.7GB)
    OLLAMA_MODEL_DEEP: str = "llama3.2-vision"  # 11B, accurato (7.9GB) - use :11b tag if needed

    # MinIO Storage
    MINIO_ENDPOINT: str = "minio:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "photomemory"
    MINIO_SECURE: bool = False  # True in production con HTTPS

    # JWT Authentication
    JWT_SECRET: str = "change-this-secret-key-in-production"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRATION_MINUTES: int = 60 * 24 * 7  # 7 days

    # Embeddings
    EMBEDDING_MODEL: str = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
    EMBEDDING_DIMENSION: int = 384

    # File upload limits
    MAX_UPLOAD_SIZE: int = 50 * 1024 * 1024  # 50MB
    ALLOWED_EXTENSIONS: set = {".jpg", ".jpeg", ".png", ".heic", ".webp"}

    # Processing
    THUMBNAIL_SIZES: list = [128, 512]
    ANALYSIS_TIMEOUT: int = 300  # seconds (llama3.2-vision on CPU can take 2-4 minutes)

    class Config:
        env_file = ".env"


settings = Settings()
