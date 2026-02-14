"""
Photo Memory - FastAPI Backend
Self-hosted AI-powered photo memory system
"""
from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, distinct
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
from models import User, Photo, PhotoAnalysis, SearchHistory, FaceRecognitionConsent, Face, Person, MemoryQuestion
import schemas
from vision import vision_client
import admin_routes
import diary_routes
import memory_routes

# Face recognition (optional)
try:
    import face_routes
    from face_recognition_service import FaceRecognitionService
    FACE_RECOGNITION_AVAILABLE = True
except (Exception, SystemExit) as e:
    FACE_RECOGNITION_AVAILABLE = False
    print(f"WARNING: face_recognition not available: {e}")
    print("Face recognition features will be disabled")
    face_routes = None
    FaceRecognitionService = None

# Security
from passlib.context import CryptContext
from jose import JWTError, jwt

# Create tables
Base.metadata.create_all(bind=engine)

# Create default user if not exists
def create_default_user():
    """Create default test user if it doesn't exist"""
    try:
        db = SessionLocal()
        existing_user = db.query(User).filter(User.email == "test@example.com").first()

        if not existing_user:
            from passlib.context import CryptContext
            pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

            new_user = User(
                email="test@example.com",
                password_hash=pwd_context.hash("test123"),
                is_admin=True,
                preferred_model="moondream",
                auto_analyze=True
            )
            db.add(new_user)
            db.commit()
            print("✅ Default user created: test@example.com / test123")
        else:
            print("ℹ️ Default user already exists")

        db.close()
    except Exception as e:
        print(f"⚠️ Error creating default user: {e}")

# Create default user at startup
create_default_user()

# FastAPI app
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.VERSION,
    description="Self-hosted AI-powered photo memory system"
)

# CORS middleware
CORS_ORIGINS = os.environ.get("CORS_ORIGINS", "http://192.168.200.4:5173,http://localhost:5173").split(",")
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
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
    except Exception:
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


@app.get("/api/auth/me")
async def get_me(current_user: User = Depends(get_current_user)):
    """Get current user info"""
    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "full_name": current_user.full_name,
        "is_admin": current_user.is_admin,
        "self_person_id": str(current_user.self_person_id) if current_user.self_person_id else None,
        "memory_questions_enabled": getattr(current_user, 'memory_questions_enabled', False),
        "auto_rewrite_enabled": getattr(current_user, 'auto_rewrite_enabled', False),
        "created_at": current_user.created_at.isoformat() if current_user.created_at else None
    }


from pydantic import BaseModel as PydanticBaseModel

class UpdateMeRequest(PydanticBaseModel):
    self_person_id: Optional[str] = None
    memory_questions_enabled: Optional[bool] = None
    auto_rewrite_enabled: Optional[bool] = None


@app.patch("/api/auth/me")
async def update_me(
    request: UpdateMeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update current user settings (self_person_id, memory_questions_enabled)"""
    if request.self_person_id is not None:
        if request.self_person_id == "" or request.self_person_id == "null":
            current_user.self_person_id = None
        else:
            current_user.self_person_id = uuid.UUID(request.self_person_id)

    if request.memory_questions_enabled is not None:
        current_user.memory_questions_enabled = request.memory_questions_enabled

    if request.auto_rewrite_enabled is not None:
        current_user.auto_rewrite_enabled = request.auto_rewrite_enabled

    db.commit()
    db.refresh(current_user)

    return {
        "id": str(current_user.id),
        "email": current_user.email,
        "self_person_id": str(current_user.self_person_id) if current_user.self_person_id else None,
        "memory_questions_enabled": getattr(current_user, 'memory_questions_enabled', False),
        "auto_rewrite_enabled": getattr(current_user, 'auto_rewrite_enabled', False),
    }


# ============================================================================
# ANALYSIS QUEUE
# ============================================================================

# Global queue for photo analysis tasks
analysis_queue = asyncio.Queue()
analysis_worker_started = False
stop_all_requested = False
current_analyzing_photo_id = None  # Track current photo being analyzed

# Global queue for face detection tasks
face_detection_queue = asyncio.Queue()
face_detection_worker_started = False

async def analysis_worker():
    """Worker that processes analysis tasks one at a time"""
    global stop_all_requested, current_analyzing_photo_id
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
                        photo_id, file_path, model, _fc, _fn, _cp = analysis_queue.get_nowait()
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
                current_analyzing_photo_id = None
                continue

            photo_id, file_path, model, faces_context, faces_names, custom_prompt = await analysis_queue.get()
            current_analyzing_photo_id = photo_id  # Set current photo
            print(f"Processing analysis for photo {photo_id} (queue size: {analysis_queue.qsize()})")
            await analyze_photo_background(photo_id, file_path, model, faces_context=faces_context, faces_names=faces_names, custom_prompt=custom_prompt)
            current_analyzing_photo_id = None  # Reset after completion
            analysis_queue.task_done()
        except Exception as e:
            print(f"Analysis worker error: {e}")
            current_analyzing_photo_id = None  # Reset on error
            # Continue processing next item
            analysis_queue.task_done()


async def face_detection_worker():
    """Worker dedicato per face detection in background.
    Se then_analyze_model è presente, dopo detection accoda analisi LLM con contesto volti."""
    global face_detection_worker_started

    if not FACE_RECOGNITION_AVAILABLE:
        print("Face detection worker NOT started - face_recognition library not available")
        return

    print("Face detection worker started")
    while True:
        try:
            photo_id, file_path, then_analyze_model = await face_detection_queue.get()
            print(f"Processing face detection for photo {photo_id} (queue size: {face_detection_queue.qsize()})")

            # Run face detection in thread pool (CPU-intensive)
            db = SessionLocal()
            face_names = []
            try:
                service = FaceRecognitionService(db)
                faces = await asyncio.to_thread(
                    service.detect_faces_in_photo,
                    photo_id,
                    file_path
                )
                # Raccogli nomi persone riconosciute (auto-match)
                for face in (faces or []):
                    if face.person_id:
                        try:
                            db.refresh(face, ['person'])
                            if face.person and face.person.name:
                                face_names.append(face.person.name)
                        except Exception:
                            pass
                print(f"Face detection completed for photo {photo_id}: {len(faces or [])} volti"
                      + (f", riconosciuti: {face_names}" if face_names else ""))
            except Exception as e:
                print(f"Face detection error for photo {photo_id}: {e}")
            finally:
                db.close()

            # Se richiesto, accoda analisi LLM con contesto volti
            if then_analyze_model:
                faces_context = None
                faces_names_str = None
                total_faces = len(faces or [])
                if face_names:
                    unique_names = list(dict.fromkeys(face_names))
                    unnamed = total_faces - len(unique_names)
                    cert_suffix = (
                        " I nomi sono stati verificati tramite riconoscimento facciale: "
                        "usali come fatti certi, NON usare espressioni dubitative come 'sembra essere' o 'potrebbe essere'."
                    )
                    if unnamed > 0:
                        faces_context = f"Nella foto sono presenti: {', '.join(unique_names)} e {unnamed} altra/e persona/e." + cert_suffix
                    else:
                        faces_context = f"Nella foto sono presenti: {', '.join(unique_names)}." + cert_suffix
                    # Costruisci faces_names per {faces_names} nel template
                    if len(unique_names) == 1 and unnamed == 0:
                        faces_names_str = unique_names[0]
                    elif len(unique_names) == 2 and unnamed == 0:
                        faces_names_str = f"{unique_names[0]} e {unique_names[1]}"
                    elif unnamed > 0:
                        other_part = "l'altra persona" if unnamed == 1 else f"le altre {unnamed} persone"
                        faces_names_str = f"{', '.join(unique_names)} e {other_part}"
                    else:
                        faces_names_str = f"{', '.join(unique_names[:-1])} e {unique_names[-1]}"
                elif total_faces > 0:
                    faces_context = f"Nella foto sono state rilevate {total_faces} persone."
                    faces_names_str = f"le {total_faces} persone presenti"
                enqueue_analysis(photo_id, file_path, then_analyze_model, faces_context=faces_context, faces_names=faces_names_str)

            face_detection_queue.task_done()
        except Exception as e:
            print(f"Face detection worker error: {e}")
            face_detection_queue.task_done()


def enqueue_face_detection(photo_id: uuid.UUID, file_path: str, then_analyze_model: str = None):
    """Add photo to face detection queue.
    Se then_analyze_model è fornito, dopo face detection accoda analisi LLM con contesto volti."""
    global face_detection_worker_started

    # Start worker if not already running
    if not face_detection_worker_started:
        asyncio.create_task(face_detection_worker())
        face_detection_worker_started = True

    # Add to queue (non-blocking)
    try:
        face_detection_queue.put_nowait((photo_id, file_path, then_analyze_model))
        print(f"Added photo {photo_id} to face detection queue (position: {face_detection_queue.qsize()})"
              + (f", then LLM with {then_analyze_model}" if then_analyze_model else ""))
    except asyncio.QueueFull:
        print(f"Face detection queue full! Skipping photo {photo_id}")


def enqueue_analysis(photo_id: uuid.UUID, file_path: str, model: str = None, faces_context: str = None, faces_names: str = None, custom_prompt: str = None):
    """Add photo to analysis queue"""
    global analysis_worker_started

    # Start worker if not already running
    if not analysis_worker_started:
        asyncio.create_task(analysis_worker())
        analysis_worker_started = True

    # Add to queue (non-blocking)
    try:
        analysis_queue.put_nowait((photo_id, file_path, model, faces_context, faces_names, custom_prompt))
        print(f"Added photo {photo_id} to analysis queue (position: {analysis_queue.qsize()})"
              + (f" [faces: {faces_context[:60]}]" if faces_context else "")
              + (f" [names: {faces_names}]" if faces_names else "")
              + (" [custom_prompt]" if custom_prompt else ""))
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
        except Exception:
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
                            except (UnicodeDecodeError, AttributeError):
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
                                except Exception:
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
                            except Exception:
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
                        try:
                            gps_lat = gps_info.get(2)  # GPSLatitude
                            gps_lat_ref = gps_info.get(1)  # GPSLatitudeRef
                            if gps_lat and gps_lat_ref:
                                if isinstance(gps_lat_ref, bytes):
                                    gps_lat_ref = gps_lat_ref.decode('utf-8')
                                lat_decimal = dms_to_decimal(gps_lat, gps_lat_ref)
                                if lat_decimal is not None:
                                    exif_data['GPS_Latitude_Decimal'] = lat_decimal
                        except Exception as lat_error:
                            print(f"[EXIF] GPS Latitude error: {lat_error}")

                        # Extract and convert longitude
                        try:
                            gps_lon = gps_info.get(4)  # GPSLongitude
                            gps_lon_ref = gps_info.get(3)  # GPSLongitudeRef
                            if gps_lon and gps_lon_ref:
                                if isinstance(gps_lon_ref, bytes):
                                    gps_lon_ref = gps_lon_ref.decode('utf-8')
                                lon_decimal = dms_to_decimal(gps_lon, gps_lon_ref)
                                if lon_decimal is not None:
                                    exif_data['GPS_Longitude_Decimal'] = lon_decimal
                        except Exception as lon_error:
                            print(f"[EXIF] GPS Longitude error: {lon_error}")

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

async def analyze_photo_background(photo_id: uuid.UUID, file_path: str, model: str = None, faces_context: str = None, faces_names: str = None, custom_prompt: str = None):
    """Analyze photo in background with Vision AI"""
    try:
        model_name = model or "llama3.2-vision"
        print(f"[ANALYSIS] Starting for photo {photo_id}, model={model_name}"
              + (f", faces_context={faces_context}" if faces_context else "")
              + (f", faces_names={faces_names}" if faces_names else ""))

        # Mark analysis start time immediately and get user preferences
        db = SessionLocal()
        user_config = None
        location_name = None  # Per passare al vision client
        try:
            photo = db.query(Photo).filter(Photo.id == photo_id).first()
            if not photo:
                print(f"Photo {photo_id} not found")
                return

            # Get location name for AI context
            location_name = photo.location_name

            # Get user preferences for remote server
            user = db.query(User).filter(User.id == photo.user_id).first()
            if user:
                user_config = {
                    "remote_enabled": user.remote_ollama_enabled,
                    "remote_url": user.remote_ollama_url,
                    "remote_model": user.remote_ollama_model,
                    "text_model": getattr(user, 'text_model', None) or "llama3.2:latest",
                    "text_use_remote": getattr(user, 'text_use_remote', False),
                }

            # Save analysis start timestamp
            photo.analysis_started_at = datetime.now(timezone.utc)
            db.commit()
        except Exception as e:
            print(f"Failed to mark analysis start: {e}")
        finally:
            db.close()

        # Determine which server to use
        if model == "remote" and user_config and user_config["remote_enabled"]:
            from vision import OllamaVisionClient
            remote_url = user_config["remote_url"]
            actual_model = user_config["remote_model"]
            print(f"[ANALYSIS] Using REMOTE server: {remote_url}, model={actual_model}"
                  + (f", location={location_name}" if location_name else "")
                  + (f", faces={faces_context}" if faces_context else ""))
            remote_client = OllamaVisionClient(host=remote_url)
            analysis_result = await remote_client.analyze_photo(
                file_path,
                model=actual_model,
                location_name=location_name,
                allow_fallback=False,
                faces_context=faces_context,
                faces_names=faces_names,
                custom_prompt=custom_prompt
            )
        elif model == "remote" and (not user_config or not user_config["remote_enabled"]):
            print(f"[ANALYSIS] WARNING: model='remote' but remote not enabled! user_config={user_config}")
            print(f"[ANALYSIS] Falling back to local default model")
            analysis_result = await vision_client.analyze_photo(
                file_path,
                model=None,
                location_name=location_name,
                faces_context=faces_context,
                faces_names=faces_names,
                custom_prompt=custom_prompt
            )
        else:
            print(f"[ANALYSIS] Using LOCAL server, model={model}"
                  + (f", location={location_name}" if location_name else "")
                  + (f", faces={faces_context}" if faces_context else "")
                  + (" [custom_prompt]" if custom_prompt else ""))
            analysis_result = await vision_client.analyze_photo(
                file_path,
                model=model,
                location_name=location_name,
                faces_context=faces_context,
                faces_names=faces_names,
                custom_prompt=custom_prompt
            )

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

            # Verify analysis_result is a dict
            if not isinstance(analysis_result, dict):
                print(f"ERROR: analysis_result is not a dict, it's {type(analysis_result)}")
                raise ValueError(f"Invalid analysis result type: {type(analysis_result)}")

            # Determine server type for model_version display
            base_model = analysis_result.get("model_version", "unknown")
            is_remote = model == "remote" and user_config and user_config["remote_enabled"]
            model_display = f"{base_model} (Remoto)" if is_remote else f"{base_model} (Locale)"

            # Save new analysis
            analysis = PhotoAnalysis(
                photo_id=photo.id,
                description_full=analysis_result.get("description_full", "Analisi non disponibile"),
                description_short=analysis_result["description_short"],
                extracted_text=analysis_result.get("extracted_text"),
                detected_objects=analysis_result.get("detected_objects", []),
                detected_faces=analysis_result.get("detected_faces", 0),
                scene_category=analysis_result.get("scene_category"),
                scene_subcategory=analysis_result.get("scene_subcategory"),
                tags=analysis_result.get("tags", []),
                prompt_used=analysis_result.get("prompt_used"),
                raw_response=analysis_result.get("raw_response"),
                model_version=model_display,
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

            # Recupera info utente e volti per post-analisi
            user = db.query(User).filter(User.id == photo.user_id).first()
            faces_info_post = _build_faces_context(db, photo_id)
            names_in_photo = faces_info_post.get("names_list", [])

            # === POST-ANALISI 1: riscrittura testo (se auto_rewrite_enabled) ===
            try:
                if user and getattr(user, 'auto_rewrite_enabled', False):
                    user_is_in_photo = False
                    user_name = None
                    if getattr(user, 'self_person_id', None) and names_in_photo:
                        self_person = db.query(Person).filter(Person.id == user.self_person_id).first()
                        if self_person and self_person.name and self_person.name in names_in_photo:
                            user_is_in_photo = True
                            user_name = self_person.name
                    rewritten = _rewrite_description_with_context(
                        db, photo_id, photo, analysis, faces_info_post, location_name,
                        user_config, user_is_in_photo, user_name
                    )
                    if rewritten:
                        analysis_result["description_full"] = analysis.description_full
                        analysis_result["description_short"] = analysis.description_short
            except Exception as rw_err:
                print(f"[POST-ANALYSIS] Errore riscrittura testo: {rw_err}")

            # === POST-ANALISI 2: aggiornamento physical_description Person ===
            try:
                raw_response = analysis_result.get("raw_response", "")
                if names_in_photo and raw_response:
                    _update_persons_physical_description(
                        db, photo_id, photo, names_in_photo, raw_response,
                        user_config, location_name
                    )
            except Exception as pd_err:
                print(f"[POST-ANALYSIS] Errore aggiornamento physical_description: {pd_err}")

            # === POST-ANALISI 3: generazione domande memoria ===
            try:
                if user and getattr(user, 'memory_questions_enabled', False):
                    _generate_memory_questions_sync(
                        db, photo_id, photo, user, analysis_result,
                        faces_info_post if names_in_photo else {"faces_context": faces_context, "names_list": []},
                        location_name, user_config
                    )
            except Exception as mq_err:
                print(f"[POST-ANALYSIS] Errore generazione domande memoria: {mq_err}")

            # Face detection ora avviene PRIMA dell'analisi LLM (nel flusso upload).
            # Per reanalyze manuali dove face detection non è stato fatto, accodalo dopo.
            if FACE_RECOGNITION_AVAILABLE and photo.face_detection_status not in ("completed", "processing"):
                consent_db = SessionLocal()
                try:
                    face_service = FaceRecognitionService(consent_db)
                    if face_service.check_user_consent(photo.user_id):
                        print(f"Photo {photo_id} analysis done, face detection pending - enqueueing")
                        enqueue_face_detection(photo_id, file_path)
                    else:
                        photo.face_detection_status = "skipped"
                        consent_db.merge(photo)
                        consent_db.commit()
                except Exception as e:
                    print(f"Failed to check face recognition consent: {e}")
                finally:
                    consent_db.close()

        finally:
            db.close()

    except Exception as e:
        print(f"Background analysis failed for photo {photo_id}: {e}")
        import traceback
        traceback.print_exc()

        # Reset photo state on failure
        db = SessionLocal()
        try:
            photo = db.query(Photo).filter(Photo.id == photo_id).first()
            if photo:
                photo.analysis_started_at = None
                photo.analyzed_at = None
                photo.analysis_duration_seconds = None
                db.commit()
                print(f"[ANALYSIS] ❌ Photo {photo_id} state reset after failure")
        except Exception as reset_error:
            print(f"Failed to reset photo state: {reset_error}")
        finally:
            db.close()


# ============================================================================
# POST-ANALYSIS HELPERS
# ============================================================================

def _call_text_llm_sync(prompt: str, user_config: dict, ollama_url_default: str = "http://ollama:11434") -> Optional[str]:
    """Chiamata sincrona a LLM text model. Ritorna la risposta o None."""
    import requests as req
    try:
        # Determina URL e modello
        url = ollama_url_default
        model = "llama3.2:latest"
        if user_config:
            # Usa text_model se disponibile
            if user_config.get("text_model"):
                model = user_config["text_model"]
            # Usa server remoto se text_use_remote è abilitato
            if user_config.get("text_use_remote") and user_config.get("remote_url"):
                url = user_config["remote_url"]
            elif user_config.get("remote_enabled") and user_config.get("remote_url"):
                url = user_config["remote_url"]

        resp = req.post(
            f"{url}/api/generate",
            json={"model": model, "prompt": prompt, "stream": False, "options": {"temperature": 0.3, "num_predict": 500}},
            timeout=(30, 180)
        )
        resp.raise_for_status()
        return resp.json().get("response", "").strip()
    except Exception as e:
        print(f"[TEXT_LLM] Errore: {e}")
        return None


def _rewrite_description_with_context(
    db, photo_id, photo, analysis, faces_info, location_name,
    user_config, user_is_in_photo, user_name, user_answers=None
):
    """Riscrive description_full con modello testo aggiungendo contesto."""
    raw_desc = analysis.description_full
    if not raw_desc or len(raw_desc) < 50:
        return None

    context_parts = []

    # Nomi persone (certi)
    names_list = faces_info.get("names_list", [])
    if names_list:
        context_parts.append(
            f"Le persone nella foto sono state IDENTIFICATE con certezza: {', '.join(names_list)}. "
            "Usa i loro nomi come fatti certi, MAI espressioni dubitative."
        )

    # Prima persona
    if user_is_in_photo and user_name:
        other_names = [n for n in names_list if n != user_name]
        if other_names:
            context_parts.append(
                f"L'utente si chiama {user_name}. Riscrivi in PRIMA PERSONA. "
                f"'Sono con {', '.join(other_names)}...' NON '{user_name} e ...sono...'"
            )
        else:
            context_parts.append(
                f"L'utente si chiama {user_name}. Riscrivi in PRIMA PERSONA."
            )

    # Posizione
    if location_name:
        context_parts.append(f"Posizione: {location_name}.")

    # Testo estratto
    if analysis.extracted_text:
        context_parts.append(f"Testo nella foto: \"{analysis.extracted_text}\"")

    # Risposte utente alle domande
    if user_answers:
        for qa in user_answers:
            context_parts.append(f"Info dall'utente - {qa['question']}: {qa['answer']}")

    if not context_parts:
        return None

    prompt = f"""Riscrivi questa descrizione di una foto applicando le istruzioni.

DESCRIZIONE ORIGINALE:
---
{raw_desc}
---

ISTRUZIONI:
{chr(10).join(f'- {p}' for p in context_parts)}

REGOLE:
- Mantieni TUTTI i dettagli della descrizione originale
- Correggi errori evidenti del modello vision
- NON inventare dettagli
- Rispondi SOLO con la descrizione riscritta, in italiano"""

    rewritten = _call_text_llm_sync(prompt, user_config)
    if rewritten and len(rewritten) > 50:
        analysis.description_full = rewritten
        first_sentence = rewritten.split('.')[0].strip()
        if first_sentence and len(first_sentence) > 10:
            analysis.description_short = first_sentence + "."
        db.commit()
        print(f"[REWRITE] Descrizione riscritta per foto {photo_id}")
        return rewritten
    return None


def merge_physical_description(existing: dict, new_data: dict, photo_date: str, photo_id: str) -> dict:
    """Aggiorna tratti fisici preservando la history"""
    result = existing.copy() if existing else {}

    for key, value in new_data.items():
        if value and key not in ("history", "last_updated", "photo_count_at_update"):
            result[key] = value

    history = result.get("history", [])
    history.append({"date": photo_date, "photo_id": str(photo_id), "traits": new_data})
    result["history"] = history[-10:]  # mantieni ultime 10
    result["last_updated"] = photo_date

    return result


def _update_persons_physical_description(db: Session, photo_id, photo, names_list: list, raw_response: str, user_config: dict, location_name: str):
    """Post-analisi: estrae tratti fisici dalla risposta e aggiorna Person.physical_description"""
    import json as json_mod

    photo_date = photo.taken_at.strftime("%Y-%m-%d") if photo.taken_at else datetime.now(timezone.utc).strftime("%Y-%m-%d")

    for name in names_list:
        try:
            person = db.query(Person).filter(
                Person.user_id == photo.user_id,
                Person.name == name
            ).first()
            if not person:
                continue

            # Cerca nel raw_response la parte relativa a questa persona
            # Prendi un estratto attorno al nome (max 500 char)
            import re
            pattern = re.compile(re.escape(name), re.IGNORECASE)
            match = pattern.search(raw_response)
            if not match:
                continue

            start = max(0, match.start() - 50)
            end = min(len(raw_response), match.end() + 400)
            excerpt = raw_response[start:end]

            # Chiama LLM per estrarre tratti fisici
            extract_prompt = f"""Dalla seguente descrizione di {name}, estrai SOLO i tratti fisici in JSON:
"{excerpt}"

Rispondi SOLO con JSON valido:
{{"sesso": "...", "eta_approssimativa": "...", "corporatura": "...", "capelli": "...", "occhi": "...", "tratti_distintivi": "..."}}
Ometti campi non menzionati. Non aggiungere commenti."""

            llm_response = _call_text_llm_sync(extract_prompt, user_config)
            if not llm_response:
                continue

            # Parse JSON dalla risposta
            # Cerca il primo { e l'ultimo }
            json_start = llm_response.find('{')
            json_end = llm_response.rfind('}')
            if json_start == -1 or json_end == -1:
                continue

            try:
                new_traits = json_mod.loads(llm_response[json_start:json_end + 1])
            except json_mod.JSONDecodeError:
                print(f"[PHYS_DESC] JSON non valido per {name}: {llm_response[:100]}")
                continue

            # Filtra campi vuoti/null
            new_traits = {k: v for k, v in new_traits.items() if v and v != "..."}

            if not new_traits:
                continue

            # Merge con descrizione esistente
            existing = person.physical_description or {}
            updated = merge_physical_description(existing, new_traits, photo_date, str(photo_id))

            person.physical_description = updated
            db.commit()
            print(f"[PHYS_DESC] Aggiornata descrizione fisica di {name}: {list(new_traits.keys())}")

        except Exception as e:
            print(f"[PHYS_DESC] Errore per persona {name}: {e}")


def _generate_memory_questions_sync(db: Session, photo_id, photo, user, analysis_result: dict, faces_info: dict, location_name: str, user_config: dict):
    """Genera domande memoria post-analisi usando LLM text model"""
    import re

    analysis_text = analysis_result.get("raw_response", "") or analysis_result.get("description_full", "")
    if not analysis_text or len(analysis_text) < 50:
        return

    # Determina se l'utente appare nella foto
    user_is_in_photo = False
    user_name = None
    if getattr(user, 'self_person_id', None) and faces_info.get("names_list"):
        self_person = db.query(Person).filter(Person.id == user.self_person_id).first()
        if self_person and self_person.name and self_person.name in faces_info["names_list"]:
            user_is_in_photo = True
            user_name = self_person.name

    # Costruisci prompt
    context_parts = []
    if location_name:
        context_parts.append(f"Luogo: {location_name}")
    if faces_info.get("faces_context"):
        context_parts.append(f"Persone: {faces_info['faces_context']}")
    context_str = "\n".join(context_parts)

    user_instruction = ""
    if user_is_in_photo:
        user_instruction = f"\nL'utente si chiama {user_name} e appare in questa foto. Rivolgi le domande in seconda persona singolare (tu).\nChiedi all'utente cosa stava facendo, con chi era, come si sentiva, ecc."

    prompt = f"""Sei un assistente che arricchisce la memoria fotografica dell'utente.

Analisi della foto:
---
{analysis_text[:1500]}
---
{context_str}
{user_instruction}

Genera 2-3 domande BREVI e SPECIFICHE per QUESTA foto.
NON chiedere cose già descritte nell'analisi.
Concentrati su: chi sono le persone, occasione/evento, contesto, dettagli sul luogo.

Formato (una per riga):
[tipo] Domanda?

Tipi validi: persone, occasione, luogo, attivita, oggetto, contesto"""

    llm_response = _call_text_llm_sync(prompt, user_config)
    if not llm_response:
        return

    # Parse domande
    questions = []
    for line in llm_response.split('\n'):
        line = line.strip()
        match = re.match(r'^\[(\w+)\]\s+(.+)$', line)
        if match:
            q_type = match.group(1).lower()
            q_text = match.group(2).strip()
            valid_types = {"persone", "occasione", "luogo", "attivita", "oggetto", "contesto"}
            if q_type in valid_types and len(q_text) > 10:
                questions.append((q_type, q_text))

    if not questions:
        print(f"[MEM_QUESTIONS] Nessuna domanda valida generata per foto {photo_id}")
        return

    # Salva domande nel DB
    for q_type, q_text in questions[:3]:
        mq = MemoryQuestion(
            user_id=user.id,
            photo_id=photo_id,
            question=q_text,
            question_type=q_type,
            status="pending"
        )
        db.add(mq)

    db.commit()
    print(f"[MEM_QUESTIONS] Generate {len(questions[:3])} domande per foto {photo_id}")


# ============================================================================
# ROUTES - OLLAMA LOCAL MODELS
# ============================================================================

@app.get("/api/ollama/local/models")
async def get_local_ollama_models(
    current_user: User = Depends(get_current_user)
):
    """Lista modelli Ollama installati sul server locale. Accessibile a tutti gli utenti autenticati."""
    import httpx
    from config import settings

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{settings.OLLAMA_HOST}/api/tags")
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("models", []):
                models.append({
                    "name": model.get("name", ""),
                    "size": model.get("size", 0),
                })

            return {"models": models, "count": len(models)}

    except Exception as e:
        return {"models": [], "count": 0, "error": str(e)}


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
        "remote_ollama_enabled": current_user.remote_ollama_enabled,
        "remote_ollama_url": current_user.remote_ollama_url,
        "remote_ollama_model": current_user.remote_ollama_model,
        "text_model": current_user.text_model or "llama3.2:latest",
        "text_use_remote": getattr(current_user, 'text_use_remote', False),
        "memory_questions_enabled": getattr(current_user, 'memory_questions_enabled', False),
        "auto_rewrite_enabled": getattr(current_user, 'auto_rewrite_enabled', False),
        "self_person_id": str(current_user.self_person_id) if current_user.self_person_id else None,
        "created_at": current_user.created_at.isoformat()
    }


@app.patch("/api/user/preferences")
async def update_user_preferences(
    preferred_model: Optional[str] = None,
    auto_analyze: Optional[bool] = None,
    remote_ollama_enabled: Optional[bool] = None,
    remote_ollama_url: Optional[str] = None,
    remote_ollama_model: Optional[str] = None,
    text_model: Optional[str] = None,
    text_use_remote: Optional[bool] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Update user preferences for AI model and auto-analysis"""

    if preferred_model is not None:
        current_user.preferred_model = preferred_model

    if auto_analyze is not None:
        current_user.auto_analyze = auto_analyze

    # Validazione server remoto se abilitato
    if remote_ollama_enabled and remote_ollama_url and remote_ollama_model:
        import httpx
        pass  # Validate remote server

        try:
            # Test connessione al server remoto
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{remote_ollama_url}/api/tags")
                response.raise_for_status()
                data = response.json()

                # Verifica che il modello esista
                model_names = [m["name"] for m in data.get("models", [])]
                if remote_ollama_model not in model_names:
                    raise HTTPException(
                        status_code=400,
                        detail=f"Modello '{remote_ollama_model}' non trovato sul server remoto. Modelli disponibili: {', '.join(model_names)}"
                    )

        except httpx.HTTPError as e:
            raise HTTPException(
                status_code=503,
                detail=f"Impossibile contattare server Ollama a {remote_ollama_url}. Verifica che il server sia in esecuzione."
            )

    if remote_ollama_enabled is not None:
        current_user.remote_ollama_enabled = remote_ollama_enabled

    if remote_ollama_url is not None:
        current_user.remote_ollama_url = remote_ollama_url

    if remote_ollama_model is not None:
        current_user.remote_ollama_model = remote_ollama_model

    if text_model is not None:
        current_user.text_model = text_model

    if text_use_remote is not None:
        current_user.text_use_remote = text_use_remote

    db.commit()
    db.refresh(current_user)

    return {
        "message": "Preferences updated successfully",
        "preferred_model": current_user.preferred_model,
        "auto_analyze": current_user.auto_analyze,
        "remote_ollama_enabled": current_user.remote_ollama_enabled,
        "remote_ollama_url": current_user.remote_ollama_url,
        "remote_ollama_model": current_user.remote_ollama_model,
        "text_model": current_user.text_model or "llama3.2:latest",
        "text_use_remote": getattr(current_user, 'text_use_remote', False),
        "memory_questions_enabled": getattr(current_user, 'memory_questions_enabled', False),
        "auto_rewrite_enabled": getattr(current_user, 'auto_rewrite_enabled', False),
        "self_person_id": str(current_user.self_person_id) if current_user.self_person_id else None,
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
        except (ValueError, TypeError):
            taken_at_dt = datetime.now(timezone.utc)
    else:
        # Try to get date from EXIF
        taken_at_dt = datetime.now(timezone.utc)
        if exif_data:
            date_taken = exif_data.get('DateTimeOriginal') or exif_data.get('DateTime')
            if date_taken:
                try:
                    taken_at_dt = datetime.strptime(date_taken, '%Y:%m:%d %H:%M:%S')
                except (ValueError, TypeError):
                    pass  # Keep default

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
    print(f"[UPLOAD] GPS coordinates: lat={latitude}, lon={longitude}")
    if latitude and longitude:
        try:
            location_name = await reverse_geocode(latitude, longitude)
            print(f"[UPLOAD] Geocoding result: {location_name}")
        except Exception as e:
            print(f"Geocoding failed (non-critical): {e}")
            location_name = None
    else:
        print("[UPLOAD] No GPS coordinates found in EXIF")

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

    print(f"[UPLOAD] User {current_user.email} - auto_analyze: {current_user.auto_analyze}, preferred_model: {current_user.preferred_model}, remote_enabled: {current_user.remote_ollama_enabled}")

    if current_user.auto_analyze:
        model = current_user.preferred_model or "moondream"
        if model == "remote":
            print(f"[UPLOAD] Auto-analysis enabled, using REMOTE server (url={current_user.remote_ollama_url}, model={current_user.remote_ollama_model})")
        else:
            print(f"[UPLOAD] Auto-analysis enabled, using LOCAL model: {model}")

        # Face detection prima dell'analisi LLM (se disponibile e consenso dato)
        face_first = False
        if FACE_RECOGNITION_AVAILABLE:
            try:
                face_svc = FaceRecognitionService(db)
                if face_svc.check_user_consent(current_user.id):
                    face_first = True
                    print(f"[UPLOAD] Face detection first, then LLM analysis")
                    enqueue_face_detection(photo.id, str(file_path), then_analyze_model=model)
            except Exception as e:
                print(f"[UPLOAD] Face detection check failed: {e}")

        if not face_first:
            enqueue_analysis(photo.id, str(file_path), model)
    else:
        print(f"[UPLOAD] Auto-analysis disabled, skipping analysis")

    return photo


@app.get("/api/photos/queue-status")
async def get_queue_status(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Get analysis queue status with details"""
    # Get current photo being analyzed
    current_photo = None
    if current_analyzing_photo_id:
        photo = db.query(Photo).filter(Photo.id == current_analyzing_photo_id).first()
        if photo:
            from pathlib import Path
            filename = Path(photo.original_path).name if photo.original_path else "unknown.jpg"
            current_photo = {
                "id": str(photo.id),
                "filename": filename,
                "analysis_started_at": photo.analysis_started_at.isoformat() if photo.analysis_started_at else None,
                "elapsed_seconds": photo.elapsed_time_seconds if photo.analysis_started_at else 0
            }

    return {
        "queue_size": analysis_queue.qsize(),
        "worker_running": analysis_worker_started,
        "current_photo": current_photo,
        "total_in_progress": 1 if current_analyzing_photo_id else 0
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
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
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
    # Query diretta con unnest() + DISTINCT (evita caricare tutte le analisi in memoria)
    from sqlalchemy import text as sql_text
    result = db.execute(sql_text("""
        SELECT DISTINCT unnest(pa.tags) AS tag
        FROM photo_analysis pa
        JOIN photos p ON pa.photo_id = p.id
        WHERE p.user_id = :user_id
          AND p.deleted_at IS NULL
          AND pa.tags IS NOT NULL
        ORDER BY tag
    """), {"user_id": str(current_user.id)}).fetchall()

    tags_list = [row[0] for row in result]
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
    size = max(64, min(size, 1024))
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


class ReanalyzeRequest(schemas.BaseModel):
    model: str = "llama3.2-vision"
    custom_prompt: Optional[str] = None


def _build_faces_context(db: Session, photo_id: uuid.UUID) -> dict:
    """Costruisce contesto volti per una foto.
    Ritorna dict con:
      faces_context: frase completa per {faces_hint}
      faces_names: solo nomi per {faces_names} nel template
      names_list: lista nomi (per aggiornamento Person)
      total_faces: numero totale volti
    """
    result = {"faces_context": None, "faces_names": None, "names_list": [], "total_faces": 0}
    if not FACE_RECOGNITION_AVAILABLE:
        return result
    try:
        all_faces = db.query(Face).filter(
            Face.photo_id == photo_id,
            Face.deleted_at.is_(None)
        ).all()
        if not all_faces:
            return result
        result["total_faces"] = len(all_faces)
        named_faces = []
        for f in all_faces:
            if f.person_id:
                try:
                    person = db.query(Person).filter(Person.id == f.person_id).first()
                    if person and person.name:
                        named_faces.append(person.name)
                except Exception:
                    pass
        names = list(dict.fromkeys(named_faces))
        result["names_list"] = names
        unnamed_count = len(all_faces) - len(names)

        # faces_context: frase completa per {faces_hint}
        cert_suffix = (
            " I nomi sono stati verificati tramite riconoscimento facciale: "
            "usali come fatti certi, NON usare espressioni dubitative come 'sembra essere' o 'potrebbe essere'."
        )
        if names and unnamed_count > 0:
            result["faces_context"] = f"Nella foto sono presenti: {', '.join(names)} e {unnamed_count} altra/e persona/e." + cert_suffix
        elif names:
            result["faces_context"] = f"Nella foto sono presenti: {', '.join(names)}." + cert_suffix
        else:
            result["faces_context"] = f"Nella foto sono state rilevate {len(all_faces)} persone."

        # faces_names: solo nomi per {faces_names} nel template
        if names and unnamed_count > 0:
            if len(names) == 1:
                result["faces_names"] = f"{names[0]} e l'altra persona"
            else:
                other_label = "l'altra persona" if unnamed_count == 1 else f"le altre {unnamed_count} persone"
                result["faces_names"] = f"{', '.join(names[:-1])}, {names[-1]} e {other_label}"
        elif names:
            if len(names) == 1:
                result["faces_names"] = names[0]
            elif len(names) == 2:
                result["faces_names"] = f"{names[0]} e {names[1]}"
            else:
                result["faces_names"] = f"{', '.join(names[:-1])} e {names[-1]}"
        else:
            result["faces_names"] = f"le {len(all_faces)} persone presenti"

        return result
    except Exception as e:
        print(f"[FACES_CONTEXT] Errore: {e}")
        return result


@app.get("/api/photos/{photo_id}/prompt-preview")
async def get_prompt_preview(
    photo_id: uuid.UUID,
    model: str = "llama3.2-vision",
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Anteprima prompt che verrà inviato al LLM per questa foto"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    faces_info = _build_faces_context(db, photo_id)
    location_name = photo.location_name

    prompt = vision_client._get_analysis_prompt(
        location_name=location_name,
        model=model,
        faces_context=faces_info["faces_context"],
        faces_names=faces_info["faces_names"]
    )

    return {
        "prompt": prompt,
        "faces_context": faces_info["faces_context"],
        "faces_names": faces_info["faces_names"],
        "location_name": location_name,
        "model": model
    }


@app.post("/api/photos/{photo_id}/reanalyze")
async def reanalyze_photo(
    photo_id: uuid.UUID,
    request: ReanalyzeRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Reanalyze photo with vision AI"""
    model = request.model
    custom_prompt = request.custom_prompt

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

    # Recupera contesto volti (tutti, non solo named)
    faces_info = _build_faces_context(db, photo_id)
    if faces_info["faces_context"]:
        print(f"[REANALYZE] Contesto volti: {faces_info['faces_context']}, nomi: {faces_info['faces_names']}")

    # Add to analysis queue with specified model, faces context, and custom prompt
    enqueue_analysis(photo.id, str(file_path), model, faces_context=faces_info["faces_context"], faces_names=faces_info["faces_names"], custom_prompt=custom_prompt)

    return {
        "message": "Reanalysis started",
        "photo_id": str(photo.id),
        "model": model,
        "custom_prompt": bool(custom_prompt),
        "queue_position": analysis_queue.qsize()
    }


@app.post("/api/photos/{photo_id}/rewrite")
async def rewrite_photo_description(
    photo_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    """Riscrive la descrizione della foto con contesto (nomi certi, prima persona, location)"""
    photo = (
        db.query(Photo)
        .filter(Photo.id == photo_id, Photo.user_id == current_user.id, Photo.deleted_at.is_(None))
        .first()
    )
    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    analysis = db.query(PhotoAnalysis).filter(PhotoAnalysis.photo_id == photo_id).first()
    if not analysis:
        raise HTTPException(status_code=400, detail="Foto non ancora analizzata")

    # Costruisci contesto
    faces_info = _build_faces_context(db, photo_id)
    location_name = photo.location_name

    # Determina se utente appare nella foto
    user_is_in_photo = False
    user_name = None
    if getattr(current_user, 'self_person_id', None) and faces_info.get("names_list"):
        self_person = db.query(Person).filter(Person.id == current_user.self_person_id).first()
        if self_person and self_person.name and self_person.name in faces_info["names_list"]:
            user_is_in_photo = True
            user_name = self_person.name

    # Carica risposte domande memoria (se presenti)
    user_answers = []
    answered_questions = db.query(MemoryQuestion).filter(
        MemoryQuestion.photo_id == photo_id,
        MemoryQuestion.user_id == current_user.id,
        MemoryQuestion.status == "answered",
        MemoryQuestion.answer.isnot(None),
    ).all()
    for q in answered_questions:
        user_answers.append({"question": q.question, "answer": q.answer})

    user_config = {
        "remote_enabled": current_user.remote_ollama_enabled,
        "remote_url": current_user.remote_ollama_url,
        "remote_model": current_user.remote_ollama_model,
        "text_model": getattr(current_user, 'text_model', None) or "llama3.2:latest",
        "text_use_remote": getattr(current_user, 'text_use_remote', False),
    }

    result = _rewrite_description_with_context(
        db, photo_id, photo, analysis, faces_info, location_name,
        user_config, user_is_in_photo, user_name, user_answers or None
    )

    if result:
        return {
            "message": "Descrizione riscritta",
            "description_full": analysis.description_full,
            "description_short": analysis.description_short,
        }
    else:
        raise HTTPException(status_code=400, detail="Nessun contesto disponibile per la riscrittura")


# ============================================================================
# FACE THUMBNAIL - crop esatto del volto
# ============================================================================

@app.get("/api/faces/{face_id}/thumbnail")
async def get_face_thumbnail(
    face_id: uuid.UUID,
    size: int = 256,
    padding: float = 0.3,
    db: Session = Depends(get_db),
):
    """Ritorna crop del volto dalla foto originale."""
    from fastapi.responses import StreamingResponse
    import io

    size = max(64, min(size, 512))
    padding = max(0.0, min(padding, 1.0))

    face = db.query(Face).filter(Face.id == face_id, Face.deleted_at.is_(None)).first()
    if not face:
        raise HTTPException(status_code=404, detail="Volto non trovato")

    photo = db.query(Photo).filter(Photo.id == face.photo_id, Photo.deleted_at.is_(None)).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Foto non trovata")

    file_path = Path(photo.original_path)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="File foto non trovato")

    try:
        img = Image.open(file_path)
        img_w, img_h = img.size

        # Bbox con padding
        pad_x = int(face.bbox_width * padding)
        pad_y = int(face.bbox_height * padding)
        x1 = max(0, face.bbox_x - pad_x)
        y1 = max(0, face.bbox_y - pad_y)
        x2 = min(img_w, face.bbox_x + face.bbox_width + pad_x)
        y2 = min(img_h, face.bbox_y + face.bbox_height + pad_y)

        crop = img.crop((x1, y1, x2, y2))

        # Rendi quadrato centrando
        w, h = crop.size
        side = max(w, h)
        square = Image.new('RGB', (side, side), (200, 200, 200))
        square.paste(crop, ((side - w) // 2, (side - h) // 2))
        square = square.resize((size, size), Image.LANCZOS)

        buf = io.BytesIO()
        square.save(buf, format='JPEG', quality=85)
        buf.seek(0)

        return StreamingResponse(
            buf,
            media_type='image/jpeg',
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except Exception as e:
        logger.error(f"Errore crop volto {face_id}: {e}")
        raise HTTPException(status_code=500, detail="Errore nel crop del volto")


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
        except (ValueError, TypeError):
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

    # Raccogli person_id delle persone con volti in questa foto (prima del delete)
    affected_person_ids = []
    if FACE_RECOGNITION_AVAILABLE:
        faces_in_photo = db.query(Face).filter(
            Face.photo_id == photo_id,
            Face.deleted_at.is_(None)
        ).all()
        affected_person_ids = list({
            str(f.person_id) for f in faces_in_photo if f.person_id is not None
        })
        # Soft delete dei Face associati alla foto
        for face in faces_in_photo:
            face.deleted_at = datetime.now(timezone.utc)

    # Soft delete in DB
    photo.deleted_at = datetime.now(timezone.utc)
    db.commit()

    # Ricalcola photo_count per le persone coinvolte (query reale sul DB)
    if affected_person_ids:
        for pid in affected_person_ids:
            import uuid as _uuid
            pid_uuid = _uuid.UUID(pid)
            photo_count = db.query(func.count(distinct(Face.photo_id))).filter(
                Face.person_id == pid_uuid,
                Face.deleted_at.is_(None)
            ).scalar() or 0
            db.query(Person).filter(Person.id == pid_uuid).update(
                {"photo_count": photo_count},
                synchronize_session=False
            )
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

# Include face recognition routes (if available)
if FACE_RECOGNITION_AVAILABLE and face_routes:
    face_routes.get_current_user_dependency = get_current_user
    app.include_router(face_routes.router)
    print("Face recognition routes registered")
else:
    print("Face recognition routes NOT available - feature disabled")

# Include diary routes
diary_routes.get_current_user_dependency = get_current_user
app.include_router(diary_routes.router)
print("Diary routes registered")

# Include memory routes
memory_routes.get_current_user_dependency = get_current_user
app.include_router(memory_routes.router)
print("Memory routes registered")


@app.on_event("startup")
async def enqueue_pending_face_detections():
    """Al boot, accoda le foto con face_detection_status pending/processing.
    Le foto 'processing' erano in corso durante un riavvio precedente."""
    if not FACE_RECOGNITION_AVAILABLE:
        return

    db = SessionLocal()
    try:
        # Reset foto bloccate in "processing" da riavvii precedenti
        stuck = db.query(Photo).filter(Photo.face_detection_status == "processing").all()
        for photo in stuck:
            photo.face_detection_status = "pending"
        if stuck:
            db.commit()
            print(f"Reset {len(stuck)} foto da 'processing' a 'pending'")

        # Recupera utenti con consenso attivo
        consented_users = {
            c.user_id for c in db.query(FaceRecognitionConsent).filter(
                FaceRecognitionConsent.consent_given == True,
                FaceRecognitionConsent.revoked_at == None
            ).all()
        }

        if not consented_users:
            return

        # Accode foto pending degli utenti con consenso
        pending = db.query(Photo).filter(
            Photo.face_detection_status == "pending",
            Photo.user_id.in_(consented_users)
        ).all()

        for photo in pending:
            enqueue_face_detection(photo.id, str(photo.original_path))

        if pending:
            print(f"Accodate {len(pending)} foto pending per face detection")

    except Exception as e:
        print(f"Errore nel riaccodamento foto pending: {e}")
    finally:
        db.close()


# ============================================================================
# RUN
# ============================================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
