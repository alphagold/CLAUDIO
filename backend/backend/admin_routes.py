"""
Admin-only routes for system monitoring and logs
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from database import get_db
from models import User
import subprocess
import os

router = APIRouter(prefix="/api/admin", tags=["admin"])

# This will be set by main.py after get_current_user is defined
get_current_user_dependency = None


def require_admin(current_user: User = Depends(lambda: get_current_user_dependency)) -> User:
    """Verify user is admin"""
    if not current_user or not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    return current_user


@router.get("/logs/backend")
async def get_backend_logs(
    lines: int = 100,
    current_user: User = Depends(get_admin_user)
):
    """Get backend container logs (last N lines)"""
    try:
        result = subprocess.run(
            ["docker", "logs", "photomemory-api", "--tail", str(lines)],
            capture_output=True,
            text=True,
            timeout=10
        )
        return {
            "logs": result.stdout + result.stderr,
            "lines": lines
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch logs: {str(e)}")


@router.get("/logs/ollama")
async def get_ollama_logs(
    lines: int = 100,
    current_user: User = Depends(get_admin_user)
):
    """Get Ollama container logs (last N lines)"""
    try:
        result = subprocess.run(
            ["docker", "logs", "photomemory-ollama", "--tail", str(lines)],
            capture_output=True,
            text=True,
            timeout=10
        )
        return {
            "logs": result.stdout + result.stderr,
            "lines": lines
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch logs: {str(e)}")


@router.get("/status")
async def get_system_status(
    current_user: User = Depends(get_admin_user),
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
            status = result.stdout.strip()
            containers.append({"name": container, "status": status})
        except:
            containers.append({"name": container, "status": "unknown"})

    # Get database stats
    total_photos = db.query(func.count(Photo.id)).scalar()
    analyzed_photos = db.query(func.count(Photo.id)).filter(Photo.analyzed_at.isnot(None)).scalar()
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

    return {
        "containers": containers,
        "statistics": {
            "total_photos": total_photos,
            "analyzed_photos": analyzed_photos,
            "pending_analysis": pending_photos,
            "disk_usage_mb": round(disk_usage_mb, 2)
        }
    }
