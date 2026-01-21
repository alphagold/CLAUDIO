"""
Photo Memory - FastAPI Backend
Self-hosted AI-powered photo memory system
"""
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta
from typing import List, Optional
import shutil
import uuid
from pathlib import Path
import time
import asyncio

# Local imports
from config import settings
from database import get_db, engine, Base, SessionLocal
from models import User, Photo, PhotoAnalysis, SearchHistory
import schemas
from vision import vision_client
import admin_routes

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

# OAuth2 scheme for JWT token extraction
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# Include admin routes (will be registered after get_current_user is defined)

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


def decode_token(token: str) -> str:
    """Decode JWT token and return user_id"""
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Get current authenticated user from JWT token"""
    user_id = decode_token(token)
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


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
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }


@app.get("/api/auth/me", response_model=schemas.UserResponse)
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user info"""
    return current_user


# ============================================================================
# BACKGROUND TASKS
# ============================================================================

async def analyze_photo_background(photo_id: uuid.UUID, file_path: str):
    """Analyze photo in background with Llama 3.2 Vision"""
    try:
        print(f"Starting background analysis for photo {photo_id} with Llama 3.2 Vision...")

        # Use detailed model (llama3.2-vision) for high-quality Italian descriptions
        analysis_result = await vision_client.analyze_photo(file_path, detailed=True)

        # Create new DB session for background task
        db = SessionLocal()
        try:
            # Get photo
            photo = db.query(Photo).filter(Photo.id == photo_id).first()
            if not photo:
                print(f"Photo {photo_id} not found")
                return

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
            print(f"Analysis completed for photo {photo_id}")

        finally:
            db.close()

    except Exception as e:
        print(f"Background analysis failed for photo {photo_id}: {e}")


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

    # Start background analysis with Llama 3.2 Vision (non-blocking)
    # User gets immediate response, analysis happens in background
    asyncio.create_task(analyze_photo_background(photo.id, str(file_path)))

    return photo


@app.get("/api/photos", response_model=schemas.PhotosListResponse)
async def list_photos(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List user's photos"""
    # Get total count
    total = (
        db.query(Photo)
        .filter(Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .count()
    )

    # Get photos
    photos = (
        db.query(Photo)
        .filter(Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .order_by(Photo.taken_at.desc())
        .limit(limit)
        .offset(offset)
        .all()
    )

    return {
        "photos": photos,
        "total": total,
        "skip": offset,
        "limit": limit
    }


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
# ADMIN ROUTES
# ============================================================================

# Update admin_routes to use our get_current_user
admin_routes.get_current_user_dependency = get_current_user
app.include_router(admin_routes.router)


# ============================================================================
# RUN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
