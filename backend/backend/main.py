"""
Photo Memory - FastAPI Backend
Self-hosted AI-powered photo memory system
"""
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import shutil
import uuid
from pathlib import Path
import time

# Local imports
from config import settings
from database import get_db, engine, Base
from models import User, Photo, PhotoAnalysis, SearchHistory
import schemas
from vision import vision_client

# Security
from passlib.context import CryptContext
from jose import JWTError, jwt

# Create tables
Base.metadata.create_all(bind=engine)

# FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="Self-hosted AI-powered photo memory system"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, specify your domains
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# Upload directory
UPLOAD_DIR = Path("/app/uploads")
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================================
# AUTHENTICATION HELPERS
# ============================================================================

def hash_password(password: str) -> str:
    """Hash password with bcrypt"""
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password against hash"""
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(user_id: str) -> str:
    """Create JWT access token"""
    expire = datetime.utcnow() + timedelta(minutes=settings.JWT_EXPIRATION_MINUTES)
    to_encode = {
        "sub": str(user_id),
        "exp": expire
    }
    return jwt.encode(to_encode, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def get_current_user(
    token: str = Depends(lambda: None),  # Get from Authorization header
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user from JWT token"""
    # For now, return test user for simplicity
    # TODO: Implement proper JWT extraction from headers
    test_user = db.query(User).filter(User.email == "test@example.com").first()
    if not test_user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return test_user


# ============================================================================
# ROUTES - HEALTH & INFO
# ============================================================================

@app.get("/", response_model=dict)
async def root():
    """Root endpoint"""
    return {
        "app": settings.APP_NAME,
        "version": settings.VERSION,
        "status": "running"
    }


@app.get("/health", response_model=schemas.HealthResponse)
async def health_check(db: Session = Depends(get_db)):
    """Health check endpoint"""
    services = {
        "database": "ok",
        "ollama": "unknown",
    }

    # Test Ollama connection
    try:
        ollama_ok = await vision_client.test_connection()
        services["ollama"] = "ok" if ollama_ok else "error"
    except:
        services["ollama"] = "error"

    return {
        "status": "ok",
        "version": settings.VERSION,
        "timestamp": datetime.utcnow(),
        "services": services
    }


# ============================================================================
# ROUTES - AUTHENTICATION
# ============================================================================

@app.post("/api/auth/register", response_model=schemas.UserResponse)
async def register(user_data: schemas.UserCreate, db: Session = Depends(get_db)):
    """Register new user"""
    # Check if user exists
    existing = db.query(User).filter(User.email == user_data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Create user
    new_user = User(
        email=user_data.email,
        password_hash=hash_password(user_data.password),
        full_name=user_data.full_name
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return new_user


@app.post("/api/auth/login", response_model=schemas.Token)
async def login(credentials: schemas.UserLogin, db: Session = Depends(get_db)):
    """Login and get access token"""
    user = db.query(User).filter(User.email == credentials.email).first()
    if not user or not verify_password(credentials.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(user.id)
    return {"access_token": token, "token_type": "bearer"}


@app.get("/api/auth/me", response_model=schemas.UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user info"""
    return current_user


# ============================================================================
# ROUTES - PHOTOS
# ============================================================================

@app.post("/api/photos", response_model=schemas.PhotoResponse)
async def upload_photo(
    file: UploadFile = File(...),
    taken_at: Optional[str] = Form(None),
    latitude: Optional[float] = Form(None),
    longitude: Optional[float] = Form(None),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Upload new photo"""
    # Validate file
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in settings.ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"File type {file_ext} not allowed")

    # Generate unique ID
    photo_id = uuid.uuid4()

    # Save file
    file_path = UPLOAD_DIR / f"{photo_id}{file_ext}"
    with file_path.open("wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    # Parse timestamp
    if taken_at:
        try:
            taken_at_dt = datetime.fromisoformat(taken_at.replace('Z', '+00:00'))
        except:
            taken_at_dt = datetime.utcnow()
    else:
        taken_at_dt = datetime.utcnow()

    # Create photo record
    photo = Photo(
        id=photo_id,
        user_id=current_user.id,
        original_path=str(file_path),
        taken_at=taken_at_dt,
        latitude=latitude,
        longitude=longitude,
        file_size=file_path.stat().st_size,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)

    # Trigger analysis (async - in real implementation use Celery)
    # For now, analyze synchronously
    try:
        # Use detailed model (llama3.2-vision) for better JSON adherence and Italian descriptions
        analysis_result = await vision_client.analyze_photo(str(file_path), detailed=True)

        # Save analysis
        analysis = PhotoAnalysis(
            photo_id=photo.id,
            description_full=analysis_result["description_full"],
            description_short=analysis_result["description_short"],
            extracted_text=analysis_result.get("extracted_text"),
            detected_objects=analysis_result.get("detected_objects", []),
            detected_faces=analysis_result.get("detected_faces", 0),
            scene_category=analysis_result.get("scene_category"),
            scene_subcategory=analysis_result.get("scene_subcategory"),
            tags=analysis_result.get("tags", []),
            model_version=analysis_result.get("model_version"),
            processing_time_ms=analysis_result.get("processing_time_ms"),
            confidence_score=analysis_result.get("confidence_score"),
        )
        db.add(analysis)

        # Update photo flags
        photo.has_text = bool(analysis_result.get("extracted_text"))
        photo.is_food = analysis_result.get("scene_category") == "food"
        photo.is_document = analysis_result.get("scene_category") in ["document", "receipt"]
        photo.analyzed_at = datetime.utcnow()

        db.commit()
        db.refresh(photo)

    except Exception as e:
        print(f"Analysis failed: {e}")
        # Photo uploaded but not analyzed yet

    return photo


@app.get("/api/photos", response_model=List[schemas.PhotoResponse])
async def list_photos(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List user's photos"""
    photos = (
        db.query(Photo)
        .filter(Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .order_by(Photo.taken_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )
    return photos


@app.get("/api/photos/{photo_id}", response_model=schemas.PhotoResponse)
async def get_photo(
    photo_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get photo details"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")
    return photo


@app.get("/api/photos/{photo_id}/download")
async def download_photo(
    photo_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Download original photo"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    file_path = Path(photo.original_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file not found")

    return FileResponse(file_path)


@app.delete("/api/photos/{photo_id}")
async def delete_photo(
    photo_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete photo (soft delete)"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    photo.deleted_at = datetime.utcnow()
    db.commit()

    return {"message": "Photo deleted"}


# ============================================================================
# ROUTES - SEARCH
# ============================================================================

@app.post("/api/search", response_model=schemas.SearchResponse)
async def search_photos(
    query: schemas.SearchQuery,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Search photos with natural language"""
    start_time = time.time()

    # Simple text search for now (TODO: implement semantic search)
    search_text = f"%{query.query}%"

    photos = (
        db.query(Photo)
        .join(PhotoAnalysis)
        .filter(
            Photo.user_id == current_user.id,
            Photo.deleted_at.is_(None),
            (
                PhotoAnalysis.description_full.ilike(search_text) |
                PhotoAnalysis.extracted_text.ilike(search_text) |
                PhotoAnalysis.tags.op("&&")(query.query.split())
            )
        )
        .order_by(Photo.taken_at.desc())
        .limit(query.limit)
        .offset(query.offset)
        .all()
    )

    # Build results
    results = [
        schemas.SearchResult(
            photo=photo,
            relevance_score=0.9,  # TODO: calculate actual score
            match_type="text"
        )
        for photo in photos
    ]

    search_time_ms = int((time.time() - start_time) * 1000)

    # Log search
    search_log = SearchHistory(
        user_id=current_user.id,
        query_text=query.query,
        results_count=len(results),
        top_photo_id=photos[0].id if photos else None,
        search_time_ms=search_time_ms
    )
    db.add(search_log)
    db.commit()

    return {
        "query": query.query,
        "total_results": len(results),
        "results": results,
        "search_time_ms": search_time_ms,
        "answer": None  # TODO: generate natural language answer
    }


# ============================================================================
# RUN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
