"""
Admin-only routes for system monitoring and logs
"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import func
from database import get_db
from models import User, Photo
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
    pending_photos = total_photos - analyzed_photos

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
        "system": {
            "cpu_percent": round(cpu_percent, 1),
            "memory_percent": round(memory_percent, 1),
            "memory_used_mb": round(memory_used_mb, 2),
            "memory_total_mb": round(memory_total_mb, 2)
        }
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


@router.post("/ollama/models/pull")
async def pull_ollama_model(
    model_name: str,
    current_user: User = Depends(require_admin)
):
    """Download an Ollama model (runs in background)"""
    import httpx
    from config import settings

    try:
        # Start pull in background (non-blocking)
        async with httpx.AsyncClient() as client:
            # Just trigger the pull, don't wait for completion
            response = await client.post(
                f"{settings.OLLAMA_HOST}/api/pull",
                json={"name": model_name},
                timeout=5.0  # Quick timeout, download continues in background
            )

            if response.status_code == 200:
                return {
                    "message": f"Started downloading {model_name}",
                    "model": model_name,
                    "status": "downloading"
                }
            else:
                raise HTTPException(status_code=response.status_code, detail="Failed to start download")

    except httpx.TimeoutException:
        # Timeout is expected - download continues in background
        return {
            "message": f"Download started for {model_name} (running in background)",
            "model": model_name,
            "status": "downloading"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error pulling model: {str(e)}")


@router.delete("/ollama/models/{model_name}")
async def delete_ollama_model(
    model_name: str,
    current_user: User = Depends(require_admin)
):
    """Delete an Ollama model"""
    import httpx
    from config import settings

    try:
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{settings.OLLAMA_HOST}/api/delete",
                json={"name": model_name},
                timeout=30.0
            )

            if response.status_code == 200:
                return {
                    "message": f"Model {model_name} deleted successfully",
                    "model": model_name
                }
            else:
                raise HTTPException(status_code=response.status_code, detail="Failed to delete model")

    except httpx.RequestError as e:
        raise HTTPException(status_code=503, detail=f"Cannot connect to Ollama: {str(e)}")
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
