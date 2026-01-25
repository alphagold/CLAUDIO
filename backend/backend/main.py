"""
Photo Memory - FastAPI Backend
Self-hosted AI-powered photo memory system
"""
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from datetime import datetime, timedelta, timezone
from typing import List, Optional
import shutil
import uuid
from pathlib import Path
import time
import asyncio
import httpx
import os
from PIL import Image
from PIL.ExifTags import TAGS

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
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.JWT_EXPIRATION_MINUTES)
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
    # Expire all cached objects to ensure we get fresh data from DB
    db.expire_all()
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    print(f"[AUTH] Loaded user {user.email} - auto_analyze: {user.auto_analyze}, preferred_model: {user.preferred_model}")
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
        "timestamp": datetime.now(timezone.utc),
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
# ANALYSIS QUEUE
# ============================================================================

# Global queue for photo analysis tasks
analysis_queue = asyncio.Queue()
analysis_worker_started = False
stop_all_requested = False

async def analysis_worker():
    """Worker that processes analysis tasks one at a time"""
    global stop_all_requested
    print("Analysis worker started")
    while True:
        try:
            # Check if stop all analyses was requested
            if stop_all_requested:
                print("Stop all analyses requested - clearing queue")
                cleared = 0
                # Clear the queue
                while not analysis_queue.empty():
                    try:
                        photo_id, file_path, model = analysis_queue.get_nowait()
                        analysis_queue.task_done()
                        # Reset photo state in DB
                        db = SessionLocal()
                        try:
                            photo = db.query(Photo).filter(Photo.id == photo_id).first()
                            if photo:
                                photo.analysis_started_at = None
                                db.commit()
                                cleared += 1
                        finally:
                            db.close()
                    except asyncio.QueueEmpty:
                        break

                print(f"Cleared {cleared} photos from queue")
                stop_all_requested = False
                continue

            photo_id, file_path, model = await analysis_queue.get()
            print(f"Processing analysis for photo {photo_id} (queue size: {analysis_queue.qsize()})")
            await analyze_photo_background(photo_id, file_path, model)
            analysis_queue.task_done()
        except Exception as e:
            print(f"Analysis worker error: {e}")
            # Continue processing next item
            analysis_queue.task_done()

def enqueue_analysis(photo_id: uuid.UUID, file_path: str, model: str = None):
    """Add photo to analysis queue"""
    global analysis_worker_started

    # Start worker if not already running
    if not analysis_worker_started:
        asyncio.create_task(analysis_worker())
        analysis_worker_started = True

    # Add to queue (non-blocking)
    try:
        analysis_queue.put_nowait((photo_id, file_path, model))
        print(f"Added photo {photo_id} to analysis queue (position: {analysis_queue.qsize()})")
    except asyncio.QueueFull:
        print(f"Analysis queue full! Skipping photo {photo_id}")


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def extract_exif_data(file_path: str) -> dict:
    """Extract EXIF metadata from image - comprehensive extraction"""
    exif_data = {}

    try:
        image = Image.open(file_path)

        # Always get dimensions
        try:
            exif_data['Width'] = image.width
            exif_data['Height'] = image.height
        except:
            pass

        # Try to extract EXIF
        try:
            exif = image.getexif()
            if exif:
                for tag_id, value in exif.items():
                    try:
                        tag_name = TAGS.get(tag_id, f"Tag{tag_id}")

                        # Convert value to JSON-serializable format
                        if value is None:
                            continue
                        elif isinstance(value, bytes):
                            # Try to decode as string
                            try:
                                exif_data[str(tag_name)] = value.decode('utf-8', errors='ignore').strip('\x00')
                            except:
                                # If fails, store as hex
                                exif_data[str(tag_name)] = value.hex()
                        elif isinstance(value, (str, int, float, bool)):
                            exif_data[str(tag_name)] = value
                        elif isinstance(value, tuple):
                            # Handle tuples (rational numbers, coordinates, etc.)
                            if len(value) == 2 and all(isinstance(x, int) for x in value):
                                # Rational number (e.g., 1/100 for exposure)
                                if value[1] != 0:
                                    exif_data[str(tag_name)] = f"{value[0]}/{value[1]}"
                                else:
                                    exif_data[str(tag_name)] = str(value[0])
                            else:
                                # Other tuples, convert to string
                                exif_data[str(tag_name)] = str(value)
                        elif isinstance(value, list):
                            # Convert list to string representation
                            exif_data[str(tag_name)] = str(value)
                        elif isinstance(value, dict):
                            # GPS data or other nested dicts - flatten
                            for sub_key, sub_value in value.items():
                                try:
                                    sub_tag_name = f"{tag_name}_{sub_key}"
                                    if isinstance(sub_value, (str, int, float)):
                                        exif_data[sub_tag_name] = sub_value
                                    elif isinstance(sub_value, tuple) and len(sub_value) == 2:
                                        exif_data[sub_tag_name] = f"{sub_value[0]}/{sub_value[1]}"
                                    else:
                                        exif_data[sub_tag_name] = str(sub_value)
                                except:
                                    pass
                        else:
                            # Last resort - convert to string
                            exif_data[str(tag_name)] = str(value)

                    except Exception as tag_error:
                        # Log but continue
                        print(f"Error processing tag {tag_name}: {tag_error}")
                        continue

                # Extract GPS info separately if available
                try:
                    gps_info = exif.get_ifd(0x8825)  # GPS IFD
                    if gps_info:
                        from PIL.ExifTags import GPSTAGS

                        # Store raw GPS data
                        for tag_id, value in gps_info.items():
                            tag_name = GPSTAGS.get(tag_id, f"GPS_{tag_id}")
                            try:
                                if isinstance(value, bytes):
                                    exif_data[tag_name] = value.decode('utf-8', errors='ignore')
                                elif isinstance(value, tuple):
                                    # GPS coordinates are often tuples of tuples
                                    if len(value) == 3 and all(isinstance(x, tuple) for x in value):
                                        # Convert DMS (degrees, minutes, seconds) to string
                                        exif_data[tag_name] = f"{value[0][0]}/{value[0][1]}° {value[1][0]}/{value[1][1]}' {value[2][0]}/{value[2][1]}\""
                                    elif len(value) == 2:
                                        exif_data[tag_name] = f"{value[0]}/{value[1]}"
                                    else:
                                        exif_data[tag_name] = str(value)
                                else:
                                    exif_data[tag_name] = str(value)
                            except:
                                exif_data[tag_name] = str(value)

                        # Convert GPS to decimal coordinates
                        def dms_to_decimal(dms_tuple, ref):
                            """Convert GPS DMS (degrees, minutes, seconds) to decimal"""
                            try:
                                # Handle IFDRational objects or plain floats
                                if hasattr(dms_tuple[0], 'numerator'):
                                    # IFDRational object with fractions
                                    degrees = float(dms_tuple[0].numerator) / float(dms_tuple[0].denominator)
                                    minutes = float(dms_tuple[1].numerator) / float(dms_tuple[1].denominator)
                                    seconds = float(dms_tuple[2].numerator) / float(dms_tuple[2].denominator)
                                elif isinstance(dms_tuple[0], tuple):
                                    # Tuple of (numerator, denominator)
                                    degrees = float(dms_tuple[0][0]) / float(dms_tuple[0][1])
                                    minutes = float(dms_tuple[1][0]) / float(dms_tuple[1][1])
                                    seconds = float(dms_tuple[2][0]) / float(dms_tuple[2][1])
                                else:
                                    # Already decimal values
                                    degrees = float(dms_tuple[0])
                                    minutes = float(dms_tuple[1])
                                    seconds = float(dms_tuple[2])

                                decimal = degrees + (minutes / 60) + (seconds / 3600)
                                if ref in ['S', 'W']:
                                    decimal = -decimal
                                return decimal
                            except Exception as e:
                                print(f"GPS conversion error: {e}")
                                return None

                        # Extract and convert latitude
                        gps_lat = gps_info.get(2)  # GPSLatitude
                        gps_lat_ref = gps_info.get(1)  # GPSLatitudeRef
                        if gps_lat and gps_lat_ref:
                            if isinstance(gps_lat_ref, bytes):
                                gps_lat_ref = gps_lat_ref.decode('utf-8')
                            lat_decimal = dms_to_decimal(gps_lat, gps_lat_ref)
                            if lat_decimal is not None:
                                exif_data['GPS_Latitude_Decimal'] = lat_decimal

                        # Extract and convert longitude
                        gps_lon = gps_info.get(4)  # GPSLongitude
                        gps_lon_ref = gps_info.get(3)  # GPSLongitudeRef
                        if gps_lon and gps_lon_ref:
                            if isinstance(gps_lon_ref, bytes):
                                gps_lon_ref = gps_lon_ref.decode('utf-8')
                            lon_decimal = dms_to_decimal(gps_lon, gps_lon_ref)
                            if lon_decimal is not None:
                                exif_data['GPS_Longitude_Decimal'] = lon_decimal

                except Exception as gps_error:
                    print(f"GPS extraction error: {gps_error}")

        except Exception as exif_error:
            print(f"EXIF extraction warning: {exif_error}")
            # Continue without EXIF, we at least have dimensions

        image.close()

    except Exception as e:
        print(f"Image processing error: {e}")
        # Return empty dict, upload can still continue

    # Sanitize EXIF data: remove null bytes that PostgreSQL can't handle
    def sanitize_value(value):
        """Remove null bytes from strings"""
        if isinstance(value, str):
            return value.replace('\x00', '').replace('\u0000', '')
        elif isinstance(value, dict):
            return {k: sanitize_value(v) for k, v in value.items()}
        elif isinstance(value, list):
            return [sanitize_value(item) for item in value]
        return value

    exif_data = sanitize_value(exif_data)

    return exif_data


async def reverse_geocode(latitude: float, longitude: float) -> Optional[str]:
    """Get location name from GPS coordinates using Nominatim (OpenStreetMap)"""
    try:
        # Nominatim requires delay between requests (1 req/sec)
        async with httpx.AsyncClient(timeout=5.0) as client:
            response = await client.get(
                "https://nominatim.openstreetmap.org/reverse",
                params={
                    "lat": latitude,
                    "lon": longitude,
                    "format": "json",
                    "zoom": 14,
                },
                headers={
                    "User-Agent": "PhotoMemory/1.0"
                }
            )

            if response.status_code == 200:
                data = response.json()
                address = data.get("address", {})

                # Build location string
                parts = []
                if city := (address.get("city") or address.get("town") or address.get("village")):
                    parts.append(city)
                if state := address.get("state"):
                    parts.append(state)
                if country := address.get("country"):
                    parts.append(country)

                return ", ".join(parts) if parts else None

            return None
    except Exception as e:
        print(f"Geocoding error (non-critical): {e}")
        return None


def calculate_elapsed_time(photo: Photo) -> Optional[int]:
    """Calculate elapsed analysis time in seconds"""
    if not photo.analysis_started_at:
        return None

    if photo.analyzed_at and photo.analysis_duration_seconds:
        return photo.analysis_duration_seconds

    if not photo.analyzed_at and photo.analysis_started_at:
        elapsed = (datetime.now(timezone.utc) - photo.analysis_started_at).total_seconds()
        return int(elapsed)

    return None


# ============================================================================
# BACKGROUND TASKS
# ============================================================================

async def analyze_photo_background(photo_id: uuid.UUID, file_path: str, model: str = None):
    """Analyze photo in background with Vision AI"""
    try:
        model_name = model or "llama3.2-vision"
        print(f"Starting background analysis for photo {photo_id} with {model_name}...")

        # Mark analysis start time immediately
        db = SessionLocal()
        try:
            photo = db.query(Photo).filter(Photo.id == photo_id).first()
            if not photo:
                print(f"Photo {photo_id} not found")
                return

            # Save analysis start timestamp
            photo.analysis_started_at = datetime.now(timezone.utc)
            db.commit()
            print(f"Analysis started at {photo.analysis_started_at} for photo {photo_id}")
        except Exception as e:
            print(f"Failed to mark analysis start: {e}")
        finally:
            db.close()

        # Analyze with specified model
        analysis_result = await vision_client.analyze_photo(file_path, model=model)

        # Create new DB session for background task
        db = SessionLocal()
        try:
            # Get photo
            photo = db.query(Photo).filter(Photo.id == photo_id).first()
            if not photo:
                print(f"Photo {photo_id} not found")
                return

            # Delete existing analysis if present
            existing_analysis = db.query(PhotoAnalysis).filter(PhotoAnalysis.photo_id == photo.id).first()
            if existing_analysis:
                db.delete(existing_analysis)
                db.flush()
                print(f"Deleted existing analysis for photo {photo_id}")

            # Save new analysis
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

            # Mark completion time and calculate duration
            analysis_end_time = datetime.now(timezone.utc)
            photo.analyzed_at = analysis_end_time

            # Calculate analysis duration if start time exists
            if photo.analysis_started_at:
                duration = (analysis_end_time - photo.analysis_started_at).total_seconds()
                photo.analysis_duration_seconds = int(duration)
                print(f"Analysis took {duration:.1f} seconds for photo {photo_id}")

            db.commit()
            print(f"Analysis completed for photo {photo_id}")

        finally:
            db.close()

    except Exception as e:
        print(f"Background analysis failed for photo {photo_id}: {e}")


# ============================================================================
# ROUTES - USER PROFILE & PREFERENCES
# ============================================================================

@app.get("/api/user/profile")
async def get_user_profile(
    current_user: User = Depends(get_current_user)
):
    """Get current user profile and preferences"""
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "full_name": current_user.full_name,
        "is_admin": current_user.is_admin,
        "preferred_model": current_user.preferred_model,
        "auto_analyze": current_user.auto_analyze,
        "created_at": current_user.created_at.isoformat()
    }


@app.patch("/api/user/preferences")
async def update_user_preferences(
    preferred_model: Optional[str] = None,
    auto_analyze: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user preferences for AI model and auto-analysis"""
    print(f"[PREFERENCES] Updating preferences for user {current_user.email}")
    print(f"[PREFERENCES] Before update - auto_analyze: {current_user.auto_analyze}, preferred_model: {current_user.preferred_model}")

    if preferred_model is not None:
        valid_models = ["moondream", "llava-phi3", "llama3.2-vision", "qwen3-vl:latest", "llava:latest"]
        if preferred_model not in valid_models:
            raise HTTPException(status_code=400, detail=f"Invalid model. Choose from: {', '.join(valid_models)}")
        current_user.preferred_model = preferred_model

    if auto_analyze is not None:
        current_user.auto_analyze = auto_analyze

    db.commit()
    db.refresh(current_user)

    print(f"[PREFERENCES] After update - auto_analyze: {current_user.auto_analyze}, preferred_model: {current_user.preferred_model}")

    return {
        "message": "Preferences updated successfully",
        "preferred_model": current_user.preferred_model,
        "auto_analyze": current_user.auto_analyze
    }


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
    """Upload new photo (uses user's preferred AI model)"""
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

    # Extract EXIF metadata (safe - never fails)
    try:
        exif_data = extract_exif_data(str(file_path))
    except Exception as e:
        print(f"EXIF extraction failed completely: {e}")
        exif_data = {}

    # Parse timestamp
    if taken_at:
        try:
            taken_at_dt = datetime.fromisoformat(taken_at.replace('Z', '+00:00'))
        except:
            taken_at_dt = datetime.now(timezone.utc)
    else:
        # Try to get date from EXIF
        taken_at_dt = datetime.now(timezone.utc)
        if exif_data:
            date_taken = exif_data.get('DateTimeOriginal') or exif_data.get('DateTime')
            if date_taken:
                try:
                    taken_at_dt = datetime.strptime(date_taken, '%Y:%m:%d %H:%M:%S')
                except:
                    pass  # Keep default utcnow

    # Get image dimensions
    width = exif_data.get('Width') if exif_data else None
    height = exif_data.get('Height') if exif_data else None

    # Get GPS coordinates from EXIF if not provided manually
    if not latitude and exif_data:
        latitude = exif_data.get('GPS_Latitude_Decimal')
    if not longitude and exif_data:
        longitude = exif_data.get('GPS_Longitude_Decimal')

    # Get location name from coordinates (non-blocking, can fail silently)
    location_name = None
    if latitude and longitude:
        try:
            location_name = await reverse_geocode(latitude, longitude)
        except Exception as e:
            print(f"Geocoding failed (non-critical): {e}")
            location_name = None

    # Create photo record
    photo = Photo(
        id=photo_id,
        user_id=current_user.id,
        original_path=str(file_path),
        taken_at=taken_at_dt,
        latitude=latitude,
        longitude=longitude,
        location_name=location_name,
        file_size=file_path.stat().st_size,
        width=width,
        height=height,
        exif_data=exif_data if exif_data else None,
    )
    db.add(photo)
    db.commit()
    db.refresh(photo)

    # Auto-analyze only if user preference is enabled
    # Refresh user from DB to get latest preferences
    db.refresh(current_user)

    print(f"[UPLOAD] User {current_user.email} - auto_analyze: {current_user.auto_analyze}, preferred_model: {current_user.preferred_model}")

    if current_user.auto_analyze:
        model = current_user.preferred_model or "moondream"
        print(f"[UPLOAD] Auto-analysis enabled, using model: {model}")
        # Add to analysis queue (processed one at a time)
        # User gets immediate response, analysis happens in background
        enqueue_analysis(photo.id, str(file_path), model)
    else:
        print(f"[UPLOAD] Auto-analysis disabled, skipping analysis")

    return photo


@app.get("/api/photos/queue-status")
async def get_queue_status(
    current_user: User = Depends(get_current_user)
):
    """Get analysis queue status"""
    return {
        "queue_size": analysis_queue.qsize(),
        "worker_running": analysis_worker_started
    }


@app.get("/api/photos", response_model=schemas.PhotosListResponse)
async def list_photos(
    limit: int = 50,
    offset: int = 0,
    q: Optional[str] = None,  # Search query
    scene_category: Optional[str] = None,  # Category filter
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """List user's photos with optional search and filters"""
    # Base query
    query = db.query(Photo).filter(
        Photo.user_id == current_user.id,
        Photo.deleted_at.is_(None)
    )

    # Apply search filter
    if q:
        search_text = f"%{q}%"
        query = query.join(PhotoAnalysis).filter(
            (PhotoAnalysis.description_full.ilike(search_text)) |
            (PhotoAnalysis.description_short.ilike(search_text)) |
            (PhotoAnalysis.extracted_text.ilike(search_text))
        )

    # Apply category filter
    if scene_category:
        query = query.join(PhotoAnalysis).filter(
            PhotoAnalysis.scene_category == scene_category
        )

    # Get total count
    total = query.count()

    # Get photos
    photos = query.order_by(Photo.taken_at.desc()).limit(limit).offset(offset).all()

    return {
        "photos": photos,
        "total": total,
        "skip": offset,
        "limit": limit
    }


@app.get("/api/photos/tags/all")
async def get_all_tags(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get all unique tags from user's analyzed photos"""
    # Get all photo analyses for user
    analyses = db.query(PhotoAnalysis).join(Photo).filter(
        Photo.user_id == current_user.id,
        Photo.deleted_at.is_(None),
        PhotoAnalysis.tags.isnot(None)
    ).all()

    # Collect all unique tags
    tags_set = set()
    for analysis in analyses:
        if analysis.tags:
            tags_set.update(analysis.tags)

    # Sort alphabetically
    tags_list = sorted(list(tags_set))

    return {"tags": tags_list, "count": len(tags_list)}


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


@app.get("/api/photos/{photo_id}/file")
async def get_photo_file(
    photo_id: uuid.UUID,
    db: Session = Depends(get_db)
):
    """Get photo file for display (no auth required for self-hosted use)"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    file_path = Path(photo.original_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file not found")

    return FileResponse(file_path)


@app.get("/api/photos/{photo_id}/thumbnail")
async def get_photo_thumbnail(
    photo_id: uuid.UUID,
    size: int = 512,
    db: Session = Depends(get_db)
):
    """Get photo thumbnail (no auth required for self-hosted use)"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Try to get thumbnail, fallback to original
    thumbnail_path = None
    if size <= 128 and photo.thumbnail_128_path:
        thumbnail_path = Path(photo.thumbnail_128_path)
    elif photo.thumbnail_512_path:
        thumbnail_path = Path(photo.thumbnail_512_path)

    # Use thumbnail if exists, otherwise use original
    if thumbnail_path and thumbnail_path.exists():
        return FileResponse(thumbnail_path)

    file_path = Path(photo.original_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Photo file not found")

    return FileResponse(file_path)


@app.post("/api/photos/{photo_id}/reanalyze")
async def reanalyze_photo(
    photo_id: uuid.UUID,
    model: str = "llama3.2-vision",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reanalyze photo with vision AI (choose model: moondream, llava-phi3 or llama3.2-vision)"""
    # Validate model
    valid_models = ["moondream", "llava-phi3", "llama3.2-vision", "qwen3-vl:latest", "llava:latest"]
    if model not in valid_models:
        raise HTTPException(status_code=400, detail=f"Invalid model. Choose from: {', '.join(valid_models)}")

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

    # Reset analysis timestamps for reanalysis
    photo.analyzed_at = None
    photo.analysis_started_at = None
    photo.analysis_duration_seconds = None
    db.commit()

    # Add to analysis queue with specified model
    enqueue_analysis(photo.id, str(file_path), model)

    return {
        "message": "Reanalysis started",
        "photo_id": str(photo.id),
        "model": model,
        "queue_position": analysis_queue.qsize()
    }


@app.post("/api/photos/bulk-analyze")
async def bulk_analyze_photos(
    photo_ids: list[uuid.UUID],
    model: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Analyze or reanalyze multiple photos at once"""
    # Use user's preferred model if not specified
    selected_model = model or current_user.preferred_model or "moondream"

    # Validate model
    valid_models = ["moondream", "llava-phi3", "llama3.2-vision", "qwen3-vl:latest", "llava:latest"]
    if selected_model not in valid_models:
        raise HTTPException(status_code=400, detail=f"Invalid model. Choose from: {', '.join(valid_models)}")

    # Verify all photos belong to user
    photos = db.query(Photo).filter(
        Photo.id.in_(photo_ids),
        Photo.user_id == current_user.id,
        Photo.deleted_at.is_(None)
    ).all()

    if len(photos) != len(photo_ids):
        raise HTTPException(status_code=404, detail="Some photos not found")

    # Queue all photos for analysis
    queued_count = 0
    for photo in photos:
        file_path = Path(photo.original_path)
        if not file_path.exists():
            continue

        # Reset analysis timestamps for reanalysis
        photo.analyzed_at = None
        photo.analysis_started_at = None
        photo.analysis_duration_seconds = None

        # Add to queue
        enqueue_analysis(photo.id, str(file_path), selected_model)
        queued_count += 1

    db.commit()

    return {
        "message": f"Started analysis for {queued_count} photos",
        "queued": queued_count,
        "model": selected_model,
        "queue_size": analysis_queue.qsize()
    }


@app.post("/api/photos/stop-all-analyses")
async def stop_all_analyses(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Stop all pending analyses and clear the queue"""
    global stop_all_requested
    stop_all_requested = True

    queue_size = analysis_queue.qsize()

    # Find photos stuck in "analyzing" state
    stuck_photos = db.query(Photo).filter(
        Photo.user_id == current_user.id,
        Photo.analyzed_at.is_(None),
        Photo.analysis_started_at.isnot(None),
        Photo.deleted_at.is_(None)
    ).all()

    # Reset stuck photos immediately
    for photo in stuck_photos:
        photo.analysis_started_at = None

    db.commit()

    return {
        "message": "All analyses stopped",
        "queue_cleared": queue_size,
        "stuck_photos_reset": len(stuck_photos)
    }


@app.patch("/api/photos/{photo_id}")
async def update_photo(
    photo_id: uuid.UUID,
    taken_at: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    location_name: Optional[str] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update photo metadata"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Update fields
    if taken_at is not None:
        try:
            photo.taken_at = datetime.fromisoformat(taken_at.replace('Z', '+00:00'))
        except:
            raise HTTPException(status_code=400, detail="Invalid date format")

    if latitude is not None:
        photo.latitude = latitude
    if longitude is not None:
        photo.longitude = longitude
    if location_name is not None:
        photo.location_name = location_name

    db.commit()
    db.refresh(photo)

    return photo


@app.delete("/api/photos/{photo_id}")
async def delete_photo(
    photo_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Delete photo (soft delete in DB + physical file deletion)"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Soft delete in DB
    photo.deleted_at = datetime.now(timezone.utc)
    db.commit()

    # Delete physical files
    try:
        if photo.original_path and os.path.exists(photo.original_path):
            os.remove(photo.original_path)
        if photo.thumbnail_128_path and os.path.exists(photo.thumbnail_128_path):
            os.remove(photo.thumbnail_128_path)
        if photo.thumbnail_512_path and os.path.exists(photo.thumbnail_512_path):
            os.remove(photo.thumbnail_512_path)
    except Exception as e:
        print(f"Error deleting physical files for photo {photo_id}: {e}")

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
