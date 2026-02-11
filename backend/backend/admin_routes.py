"""
Admin-only routes for system monitoring and logs
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, Photo, Face, Person, FaceRecognitionConsent
import subprocess
import os

# Optional import for system metrics
try:
    import psutil
    PSUTIL_AVAILABLE = True
except ImportError:
    PSUTIL_AVAILABLE = False

from datetime import datetime
from collections import deque
from typing import List, Dict

# In-memory storage for metrics history (last 60 data points = 5 minutes at 5s interval)
metrics_history: deque = deque(maxlen=60)

router = APIRouter(prefix="/api/admin", tags=["admin"])

# OAuth2 scheme for token extraction (matches main.py)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")

# This will be set by main.py after get_current_user is defined
get_current_user_dependency = None


def get_current_user_wrapper(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Wrapper to call get_current_user_dependency at runtime"""
    if get_current_user_dependency is None:
        raise HTTPException(status_code=500, detail="Authentication not initialized")
    return get_current_user_dependency(token=token, db=db)


def require_admin(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db)
) -> User:
    """Get current admin user and verify admin status"""
    if get_current_user_dependency is None:
        raise HTTPException(status_code=500, detail="Authentication not initialized")

    # Call get_current_user with the injected dependencies
    user = get_current_user_dependency(token=token, db=db)

    # Verify admin status
    if not user or not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return user


@router.get("/logs/backend")
async def get_backend_logs(
    lines: int = 100,
    current_user: User = Depends(require_admin)
):
    """Get backend container logs (last N lines)"""
    try:
        result = subprocess.run(
            ["docker", "logs", "photomemory-api", "--tail", str(lines), "--timestamps"],
            capture_output=True,
            text=True,
            timeout=10
        )
        return {
            "logs": result.stdout + result.stderr,
            "lines": lines
        }
    except Exception as e:
        return {
            "logs": f"Failed to fetch logs: {str(e)}\nMake sure Docker socket is mounted.",
            "lines": 0
        }


@router.get("/logs/ollama")
async def get_ollama_logs(
    lines: int = 100,
    current_user: User = Depends(require_admin)
):
    """Get Ollama container logs (last N lines)"""
    try:
        result = subprocess.run(
            ["docker", "logs", "photomemory-ollama", "--tail", str(lines), "--timestamps"],
            capture_output=True,
            text=True,
            timeout=10
        )
        return {
            "logs": result.stdout + result.stderr,
            "lines": lines
        }
    except Exception as e:
        return {
            "logs": f"Failed to fetch logs: {str(e)}\nMake sure Docker socket is mounted.",
            "lines": 0
        }


@router.get("/status")
async def get_system_status(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get system status and statistics"""
    from models import Photo
    from sqlalchemy import func

    # Get container status
    containers = []
    for container in ["photomemory-api", "photomemory-postgres", "photomemory-redis", "photomemory-minio", "photomemory-ollama"]:
        try:
            result = subprocess.run(
                ["docker", "inspect", container, "--format", "{{.State.Status}}"],
                capture_output=True,
                text=True,
                timeout=5
            )
            status = result.stdout.strip() if result.returncode == 0 else "unknown"
            containers.append({"name": container, "status": status})
        except:
            containers.append({"name": container, "status": "unknown"})

    # Get database stats (exclude soft-deleted photos)
    total_photos = db.query(func.count(Photo.id)).filter(Photo.deleted_at.is_(None)).scalar()
    analyzed_photos = db.query(func.count(Photo.id)).filter(
        Photo.analyzed_at.isnot(None),
        Photo.deleted_at.is_(None)
    ).scalar()
    # Count only photos truly in analysis (started but not completed)
    pending_photos = db.query(func.count(Photo.id)).filter(
        Photo.analyzed_at.is_(None),
        Photo.analysis_started_at.isnot(None),
        Photo.deleted_at.is_(None)
    ).scalar()

    # Face detection stats
    face_stats = {}
    try:
        for status in ["pending", "processing", "completed", "failed", "no_faces", "skipped"]:
            face_stats[status] = db.query(func.count(Photo.id)).filter(
                Photo.face_detection_status == status,
                Photo.deleted_at.is_(None)
            ).scalar() or 0
        face_stats["total_faces"] = db.query(func.count(Face.id)).filter(
            Face.deleted_at.is_(None)
        ).scalar() or 0
        face_stats["persons"] = db.query(func.count(Person.id)).scalar() or 0
    except Exception:
        face_stats = {}

    # Get disk usage
    try:
        upload_dir = "/app/uploads"
        if os.path.exists(upload_dir):
            result = subprocess.run(
                ["du", "-sb", upload_dir],
                capture_output=True,
                text=True,
                timeout=5
            )
            disk_usage_bytes = int(result.stdout.split()[0])
            disk_usage_mb = disk_usage_bytes / (1024 * 1024)
        else:
            disk_usage_mb = 0
    except:
        disk_usage_mb = 0

    # Get system metrics (CPU, RAM)
    if PSUTIL_AVAILABLE:
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            memory_percent = memory.percent
            memory_used_mb = memory.used / (1024 * 1024)
            memory_total_mb = memory.total / (1024 * 1024)
        except Exception as e:
            print(f"Error getting system metrics: {e}")
            cpu_percent = 0
            memory_percent = 0
            memory_used_mb = 0
            memory_total_mb = 0
    else:
        # psutil not installed - return zeros
        cpu_percent = 0
        memory_percent = 0
        memory_used_mb = 0
        memory_total_mb = 0

    return {
        "containers": containers,
        "statistics": {
            "total_photos": total_photos,
            "analyzed_photos": analyzed_photos,
            "pending_analysis": pending_photos,
            "disk_usage_mb": round(disk_usage_mb, 2)
        },
        "face_detection": face_stats,
        "system": {
            "cpu_percent": round(cpu_percent, 1),
            "memory_percent": round(memory_percent, 1),
            "memory_used_mb": round(memory_used_mb, 2),
            "memory_total_mb": round(memory_total_mb, 2)
        }
    }


# ============================================================================
# FACE DETECTION ADMIN ENDPOINTS
# ============================================================================

@router.post("/faces/requeue")
async def admin_requeue_face_detection(
    reset_failed: bool = False,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Rimette in coda tutte le foto pending per face detection.
    reset_failed=true: rimette in coda anche foto failed/no_faces.
    """
    # Lazy import per evitare circular dependency
    try:
        from main import enqueue_face_detection, FACE_RECOGNITION_AVAILABLE
        if not FACE_RECOGNITION_AVAILABLE:
            raise HTTPException(status_code=503, detail="Face recognition non disponibile su questo server")
    except ImportError:
        raise HTTPException(status_code=503, detail="Face recognition non disponibile")

    # Reset foto bloccate in processing
    stuck = db.query(Photo).filter(Photo.face_detection_status == "processing").all()
    for p in stuck:
        p.face_detection_status = "pending"

    if reset_failed:
        to_reset = db.query(Photo).filter(
            Photo.face_detection_status.in_(["failed", "no_faces"])
        ).all()
        for p in to_reset:
            p.face_detection_status = "pending"

    db.commit()

    # Recupera utenti con consenso attivo
    consented_users = {
        c.user_id for c in db.query(FaceRecognitionConsent).filter(
            FaceRecognitionConsent.consent_given == True,
            FaceRecognitionConsent.revoked_at == None
        ).all()
    }

    if not consented_users:
        return {"message": "Nessun utente con consenso attivo", "count": 0, "stuck_reset": len(stuck)}

    # Accoda foto pending
    pending = db.query(Photo).filter(
        Photo.face_detection_status == "pending",
        Photo.user_id.in_(consented_users),
        Photo.deleted_at.is_(None)
    ).all()

    for photo in pending:
        enqueue_face_detection(photo.id, str(photo.original_path))

    return {
        "message": f"Accodate {len(pending)} foto per face detection",
        "count": len(pending),
        "stuck_reset": len(stuck)
    }


# ============================================================================
# USER MANAGEMENT ENDPOINTS
# ============================================================================

@router.get("/users")
async def list_users(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """List all users (admin only)"""
    users = db.query(User).all()
    return [{
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "is_admin": user.is_admin,
        "created_at": user.created_at.isoformat(),
        "photo_count": db.query(func.count(Photo.id)).filter(
            Photo.user_id == user.id,
            Photo.deleted_at.is_(None)
        ).scalar()
    } for user in users]


@router.post("/users")
async def create_user(
    email: str,
    password: str,
    full_name: str = "",
    is_admin: bool = False,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Create new user (admin only)"""
    from passlib.context import CryptContext

    # Check if user exists
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    # Hash password
    pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
    password_hash = pwd_context.hash(password)

    # Create user
    new_user = User(
        email=email,
        password_hash=password_hash,
        full_name=full_name,
        is_admin=is_admin
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "id": str(new_user.id),
        "email": new_user.email,
        "full_name": new_user.full_name,
        "is_admin": new_user.is_admin,
        "created_at": new_user.created_at.isoformat()
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    email: str = None,
    full_name: str = None,
    is_admin: bool = None,
    new_password: str = None,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Update user (admin only)"""
    from uuid import UUID
    from passlib.context import CryptContext

    user = db.query(User).filter(User.id == UUID(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Update fields
    if email is not None:
        # Check if email is already taken
        existing = db.query(User).filter(User.email == email, User.id != UUID(user_id)).first()
        if existing:
            raise HTTPException(status_code=400, detail="Email already in use")
        user.email = email

    if full_name is not None:
        user.full_name = full_name

    if is_admin is not None:
        user.is_admin = is_admin

    if new_password is not None:
        pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
        user.password_hash = pwd_context.hash(new_password)

    db.commit()
    db.refresh(user)

    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "is_admin": user.is_admin,
        "created_at": user.created_at.isoformat()
    }


@router.delete("/users/{user_id}")
async def delete_user(
    user_id: str,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Delete user (admin only)"""
    from uuid import UUID

    # Don't allow deleting yourself
    if str(current_user.id) == user_id:
        raise HTTPException(status_code=400, detail="Cannot delete your own account")

    user = db.query(User).filter(User.id == UUID(user_id)).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Delete user (cascade will delete photos)
    db.delete(user)
    db.commit()

    return {"message": "User deleted successfully"}


@router.get("/cleanup/soft-deleted-count")
async def get_soft_deleted_count(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Get count of soft-deleted photos waiting to be cleaned up"""
    count = db.query(func.count(Photo.id)).filter(Photo.deleted_at.isnot(None)).scalar()
    return {
        "soft_deleted_count": count,
        "message": f"{count} soft-deleted photos in database" if count > 0 else "No soft-deleted photos"
    }


@router.post("/cleanup/soft-deleted-photos")
async def cleanup_soft_deleted_photos(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Permanently delete soft-deleted photos from database
    (files are already deleted when soft-delete happens)
    """
    # Count soft-deleted photos
    count = db.query(func.count(Photo.id)).filter(Photo.deleted_at.isnot(None)).scalar()

    if count == 0:
        return {"message": "No soft-deleted photos to clean up", "deleted_count": 0}

    # Permanently delete soft-deleted photos
    db.query(Photo).filter(Photo.deleted_at.isnot(None)).delete(synchronize_session=False)
    db.commit()

    return {
        "message": f"Successfully cleaned up {count} soft-deleted photos",
        "deleted_count": count
    }


# ============================================================================
# SYSTEM METRICS MONITORING
# ============================================================================

@router.get("/metrics/history")
async def get_metrics_history(
    current_user: User = Depends(require_admin)
):
    """Get historical system metrics for charting"""
    return {
        "metrics": list(metrics_history),
        "count": len(metrics_history)
    }


@router.post("/metrics/record")
async def record_current_metrics(
    current_user: User = Depends(require_admin)
):
    """Record current system metrics (called by frontend polling)"""
    if PSUTIL_AVAILABLE:
        try:
            cpu_percent = psutil.cpu_percent(interval=0.1)
            memory = psutil.virtual_memory()
            memory_percent = memory.percent

            metric_entry = {
                "timestamp": datetime.utcnow().isoformat(),
                "cpu_percent": round(cpu_percent, 1),
                "memory_percent": round(memory_percent, 1)
            }

            metrics_history.append(metric_entry)

            return {
                "message": "Metrics recorded",
                "current": metric_entry
            }
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error recording metrics: {str(e)}")
    else:
        raise HTTPException(status_code=503, detail="psutil not available")


# ==========================================
# Ollama Model Management Endpoints
# ==========================================

@router.get("/ollama/models")
async def list_ollama_models(
    current_user: User = Depends(require_admin)
):
    """List all downloaded Ollama models"""
    import httpx
    from config import settings

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{settings.OLLAMA_HOST}/api/tags", timeout=10.0)
            response.raise_for_status()
            data = response.json()

            models = []
            for model in data.get("models", []):
                models.append({
                    "name": model.get("name"),
                    "size": model.get("size", 0),
                    "modified_at": model.get("modified_at"),
                    "digest": model.get("digest", "")[:12]  # Short digest
                })

            return {
                "models": models,
                "count": len(models)
            }
    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Cannot connect to Ollama: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error listing models: {str(e)}")


@router.get("/ollama/models/pull")
async def pull_ollama_model(
    model_name: str,
    token: str = None,
    db: Session = Depends(get_db)
):
    """Download an Ollama model with progress streaming via SSE"""
    import httpx
    from config import settings
    from fastapi.responses import StreamingResponse
    import json
    from jose import jwt, JWTError

    # EventSource doesn't support custom headers, so we accept token as query parameter
    # Validate token before streaming
    if not token:
        raise HTTPException(status_code=401, detail="Authentication token required")

    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")

        user = db.query(User).filter(User.id == user_id).first()
        if not user or not user.is_admin:
            raise HTTPException(status_code=403, detail="Admin access required")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid token")

    async def stream_pull_progress():
        """Stream download progress from Ollama"""
        try:
            async with httpx.AsyncClient(timeout=None) as client:
                async with client.stream(
                    'POST',
                    f"{settings.OLLAMA_HOST}/api/pull",
                    json={"name": model_name}
                ) as response:
                    if response.status_code != 200:
                        yield f"data: {json.dumps({'error': 'Failed to start download'})}\n\n"
                        return

                    async for line in response.aiter_lines():
                        if line:
                            try:
                                data = json.loads(line)
                                # Send progress update to client
                                yield f"data: {json.dumps(data)}\n\n"

                                # If download is complete, break
                                if data.get('status') == 'success':
                                    break
                            except json.JSONDecodeError:
                                continue

        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return StreamingResponse(
        stream_pull_progress(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
        }
    )


@router.delete("/ollama/models/{model_name:path}")
async def delete_ollama_model(
    model_name: str,
    current_user: User = Depends(require_admin)
):
    """Delete an Ollama model"""
    import httpx
    from config import settings
    from urllib.parse import unquote

    try:
        # Decode URL-encoded model name (e.g., llama3.2-vision%3Alatest -> llama3.2-vision:latest)
        decoded_model_name = unquote(model_name)

        async with httpx.AsyncClient() as client:
            response = await client.request(
                "DELETE",
                f"{settings.OLLAMA_HOST}/api/delete",
                json={"name": decoded_model_name},
                timeout=30.0
            )

            if response.status_code == 200:
                return {
                    "message": f"Model {decoded_model_name} deleted successfully",
                    "model": decoded_model_name
                }
            else:
                # Try to get error details from response
                try:
                    error_detail = response.json().get('error', 'Failed to delete model')
                except:
                    error_detail = f"Failed to delete model (status {response.status_code})"
                raise HTTPException(status_code=response.status_code, detail=error_detail)

    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Cannot connect to Ollama: {str(e)}")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting model: {str(e)}")


@router.get("/ollama/status")
async def get_ollama_status(
    current_user: User = Depends(require_admin)
):
    """Get Ollama service status and available models"""
    import httpx
    from config import settings

    try:
        async with httpx.AsyncClient() as client:
            # Check if Ollama is running
            response = await client.get(f"{settings.OLLAMA_HOST}/api/tags", timeout=5.0)
            response.raise_for_status()
            data = response.json()

            models = data.get("models", [])
            total_size = sum(model.get("size", 0) for model in models)

            return {
                "status": "online",
                "host": settings.OLLAMA_HOST,
                "models_count": len(models),
                "total_size": total_size,
                "total_size_gb": round(total_size / (1024**3), 2)
            }
    except httpx.RequestError:
        return {
            "status": "offline",
            "host": settings.OLLAMA_HOST,
            "models_count": 0,
            "total_size": 0,
            "total_size_gb": 0
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error checking Ollama status: {str(e)}")


@router.get("/ollama/remote/models")
async def get_remote_ollama_models(
    url: str,
    current_user: User = Depends(get_current_user_wrapper)
):
    """
    Interroga server Ollama remoto per ottenere lista modelli disponibili
    Disponibile a tutti gli utenti autenticati (non solo admin)
    """
    import httpx
    from urllib.parse import urlparse

    # Validate URL format
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(
                status_code=400,
                detail="URL non valido. Deve includere schema (http/https) e host."
            )
    except Exception:
        raise HTTPException(status_code=400, detail="Formato URL non valido")

    # Ensure URL doesn't have trailing slash
    clean_url = url.rstrip('/')

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{clean_url}/api/tags", timeout=10.0)
            response.raise_for_status()
            data = response.json()

            # Filtra solo modelli vision (hanno "families" con clip/mllama/qwen)
            vision_models = []
            all_models = []

            for model in data.get("models", []):
                model_info = {
                    "name": model.get("name"),
                    "size": model.get("size", 0),
                    "modified_at": model.get("modified_at"),
                }

                all_models.append(model_info)

                # Check if it's a vision model
                families = model.get("details", {}).get("families")
                print(f"[REMOTE MODELS] Model: {model.get('name')}, families: {families}")

                if families:
                    # families can be a string or a list
                    families_str = " ".join(families) if isinstance(families, list) else str(families)
                    # Check for vision-related keywords
                    if any(keyword in families_str.lower() for keyword in ["clip", "mllama", "qwen", "vision"]):
                        print(f"[REMOTE MODELS]   ✓ Vision model detected")
                        vision_models.append(model_info)
                    else:
                        print(f"[REMOTE MODELS]   ✗ Not a vision model (families: {families_str})")

            # Se non ci sono vision models, mostra tutti (il server potrebbe non avere families)
            models_to_return = vision_models if vision_models else all_models

            print(f"[REMOTE MODELS] URL: {clean_url}")
            print(f"[REMOTE MODELS] Total models: {len(all_models)}, Vision models: {len(vision_models)}")
            print(f"[REMOTE MODELS] Returning: {len(models_to_return)} models")

            return {
                "models": models_to_return,
                "all_models": all_models,
                "vision_only": len(vision_models) > 0,
                "server_url": clean_url,
                "count": len(models_to_return)
            }

    except httpx.TimeoutException:
        raise HTTPException(
            status_code=503,
            detail=f"Timeout connessione. Il server {clean_url} non ha risposto entro 10 secondi."
        )
    except httpx.RequestError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Impossibile contattare server Ollama: {str(e)}"
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Errore nel recupero modelli: {str(e)}"
        )


@router.get("/ollama/remote/test")
async def test_remote_ollama_connection(
    ollama_url: str,
    current_user: User = Depends(get_current_user_wrapper)
):
    """
    Test connessione a server Ollama remoto
    Disponibile a tutti gli utenti autenticati (non solo admin)
    """
    import httpx
    from urllib.parse import urlparse, unquote

    # Decode URL in case it's URL-encoded
    decoded_url = unquote(ollama_url)
    print(f"[REMOTE TEST] Received URL: {ollama_url!r}, Decoded: {decoded_url!r}")

    # Validate URL format
    try:
        parsed = urlparse(decoded_url)
        if not parsed.scheme or not parsed.netloc:
            raise HTTPException(status_code=400, detail="Formato URL non valido")
    except Exception:
        raise HTTPException(status_code=400, detail="Formato URL non valido")

    clean_url = decoded_url.rstrip('/')

    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(f"{clean_url}/api/tags", timeout=5.0)
            response.raise_for_status()

            return {
                "status": "ok",
                "message": f"Connessione riuscita a Ollama su {clean_url}",
                "url": clean_url
            }
    except httpx.TimeoutException:
        return {
            "status": "error",
            "message": f"Timeout dopo 5 secondi",
            "url": clean_url
        }
    except httpx.RequestError as e:
        return {
            "status": "error",
            "message": f"Impossibile connettersi: {str(e)}",
            "url": clean_url
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Errore imprevisto: {str(e)}",
            "url": clean_url
        }


# ============================================================================
# PROMPT TEMPLATES ENDPOINTS
# ============================================================================

from models import PromptTemplate
from pydantic import BaseModel


class PromptTemplateUpdate(BaseModel):
    """Schema for updating prompt template"""
    description: str = None
    prompt_text: str = None
    is_default: bool = None
    is_active: bool = None


@router.get("/prompts")
async def list_prompt_templates(
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    List all available prompt templates
    Available to all authenticated users (not just admin)
    """
    templates = db.query(PromptTemplate).filter(
        PromptTemplate.is_active == True
    ).order_by(PromptTemplate.is_default.desc(), PromptTemplate.name).all()

    return [
        {
            "id": str(template.id),
            "name": template.name,
            "description": template.description,
            "prompt_text": template.prompt_text,
            "is_default": template.is_default,
            "is_active": template.is_active,
            "created_at": template.created_at.isoformat() if template.created_at else None,
            "updated_at": template.updated_at.isoformat() if template.updated_at else None,
        }
        for template in templates
    ]


@router.get("/prompts/{template_id}")
async def get_prompt_template(
    template_id: str,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """Get specific prompt template by ID"""
    from uuid import UUID

    try:
        template_uuid = UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template ID format")

    template = db.query(PromptTemplate).filter(
        PromptTemplate.id == template_uuid
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Prompt template not found")

    return {
        "id": str(template.id),
        "name": template.name,
        "description": template.description,
        "prompt_text": template.prompt_text,
        "is_default": template.is_default,
        "is_active": template.is_active,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }


@router.put("/prompts/{template_id}")
async def update_prompt_template(
    template_id: str,
    update_data: PromptTemplateUpdate,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Update prompt template (admin only)
    Can update description, prompt_text, is_default, is_active
    """
    from uuid import UUID

    try:
        template_uuid = UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template ID format")

    template = db.query(PromptTemplate).filter(
        PromptTemplate.id == template_uuid
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Prompt template not found")

    # Update fields if provided
    if update_data.description is not None:
        template.description = update_data.description

    if update_data.prompt_text is not None:
        # Validate minimum length
        if len(update_data.prompt_text.strip()) < 50:
            raise HTTPException(status_code=400, detail="Prompt text troppo breve (min 50 caratteri)")
        template.prompt_text = update_data.prompt_text

    if update_data.is_default is not None:
        # If setting as default, unset other defaults
        if update_data.is_default:
            db.query(PromptTemplate).filter(
                PromptTemplate.id != template_uuid
            ).update({"is_default": False})
        template.is_default = update_data.is_default

    if update_data.is_active is not None:
        template.is_active = update_data.is_active

    db.commit()
    db.refresh(template)

    return {
        "id": str(template.id),
        "name": template.name,
        "description": template.description,
        "prompt_text": template.prompt_text,
        "is_default": template.is_default,
        "is_active": template.is_active,
        "updated_at": template.updated_at.isoformat() if template.updated_at else None,
    }


@router.post("/prompts/{template_id}/set-default")
async def set_default_prompt_template(
    template_id: str,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Set a template as the default (admin only)
    Unsets all other templates as default
    """
    from uuid import UUID

    try:
        template_uuid = UUID(template_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid template ID format")

    template = db.query(PromptTemplate).filter(
        PromptTemplate.id == template_uuid
    ).first()

    if not template:
        raise HTTPException(status_code=404, detail="Prompt template not found")

    # Unset all other defaults
    db.query(PromptTemplate).filter(
        PromptTemplate.id != template_uuid
    ).update({"is_default": False})

    # Set this as default
    template.is_default = True
    db.commit()

    return {
        "message": f"Template '{template.name}' set as default",
        "template_id": str(template.id)
    }


@router.post("/prompts/reset")
async def reset_prompt_templates(
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """
    Reset all prompt templates to default values (admin only)
    DANGEROUS: This will overwrite all custom prompts!
    """
    # Delete all existing templates
    db.query(PromptTemplate).delete()

    # Re-run the default inserts (same as migration)
    default_templates = [
        {
            "name": "structured_detailed",
            "description": "Prompt strutturato con sezioni MAIUSCOLE per analisi dettagliate (default)",
            "prompt_text": """Analizza questa immagine in modo MOLTO DETTAGLIATO in italiano.{location_hint}

Organizza la tua analisi in queste sezioni (rispetta esattamente i titoli in MAIUSCOLO):

DESCRIZIONE COMPLETA:
[Scrivi almeno 5-6 frasi molto dettagliate descrivendo:
- Il soggetto principale e contesto generale
- Oggetti visibili e loro posizione nello spazio
- Colori dominanti e atmosfera
- Dettagli importanti (materiali, texture, condizioni)
- Se è interno (indoor) o esterno (outdoor)
- Emozioni o sensazioni trasmesse dalla foto]

OGGETTI IDENTIFICATI:
[Lista di 8-12 oggetti/elementi visibili nell'immagine, separati da virgola.
Includi sia oggetti principali che secondari. Es: laptop, tazza, libro, finestra, lampada, mouse, tastiera, quadro, pianta, scrivania]

PERSONE E VOLTI:
[Numero di persone visibili (anche parzialmente). Formato: "N persone" oppure "Nessuna persona visibile".
Se ci sono persone, descrivi brevemente: età approssimativa, posizione, attività]

TESTO VISIBILE:
[Trascrivi ESATTAMENTE eventuali testi, scritte, etichette, insegne visibili nell'immagine.
Se non c'è testo visibile, scrivi: "Nessun testo"]

CATEGORIA SCENA:
[Una sola parola tra: indoor, outdoor, food, document, people, nature, urban, vehicle, other]

TAG CHIAVE:
[5-8 tag descrittivi ad alta confidenza che riassumono l'immagine. Evita tag troppo generici.
Separa con virgola. Es: lavoro, tecnologia, ambiente-moderno, illuminazione-naturale, minimalista]

CONFIDENZA ANALISI:
[Un numero da 0.0 a 1.0 che indica quanto sei sicuro della tua analisi. Es: 0.85]

Importante: scrivi descrizioni lunghe e ricche di dettagli. Non essere sintetico.""",
            "is_default": True,
            "is_active": True
        },
        {
            "name": "simple_natural",
            "description": "Prompt semplice e naturale per analisi rapide",
            "prompt_text": """Descrivi in italiano cosa vedi in questa immagine.{location_hint}

Includi nella tua descrizione:
- Cosa c'è nell'immagine (oggetti, persone, ambiente)
- Colori e dettagli importanti
- Se è un luogo interno (indoor) o esterno (outdoor)
- Eventuali testi o scritte visibili nell'immagine

Descrivi in modo naturale e dettagliato.""",
            "is_default": False,
            "is_active": True
        },
    ]

    for tmpl_data in default_templates:
        template = PromptTemplate(**tmpl_data)
        db.add(template)

    db.commit()

    return {
        "message": f"Reset completato: {len(default_templates)} template ripristinati",
        "templates_count": len(default_templates)
    }
