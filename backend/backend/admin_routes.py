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

    return {
        "containers": containers,
        "statistics": {
            "total_photos": total_photos,
            "analyzed_photos": analyzed_photos,
            "pending_analysis": pending_photos,
            "disk_usage_mb": round(disk_usage_mb, 2)
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
        "role": user.role,
        "created_at": user.created_at.isoformat(),
        "photo_count": db.query(func.count(Photo.id)).filter(Photo.user_id == user.id).scalar()
    } for user in users]


@router.post("/users")
async def create_user(
    email: str,
    password: str,
    full_name: str = "",
    role: str = "editor",  # 'admin', 'editor', 'viewer'
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db)
):
    """Create new user (admin only)"""
    from passlib.context import CryptContext

    # Validate role
    if role not in ['admin', 'editor', 'viewer']:
        raise HTTPException(status_code=400, detail="Invalid role. Must be 'admin', 'editor', or 'viewer'")

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
        role=role,
        is_admin=(role == 'admin')  # Set is_admin based on role
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    return {
        "id": str(new_user.id),
        "email": new_user.email,
        "full_name": new_user.full_name,
        "is_admin": new_user.is_admin,
        "role": new_user.role,
        "created_at": new_user.created_at.isoformat()
    }


@router.patch("/users/{user_id}")
async def update_user(
    user_id: str,
    email: str = None,
    full_name: str = None,
    role: str = None,  # 'admin', 'editor', 'viewer'
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

    if role is not None:
        if role not in ['admin', 'editor', 'viewer']:
            raise HTTPException(status_code=400, detail="Invalid role. Must be 'admin', 'editor', or 'viewer'")
        user.role = role
        user.is_admin = (role == 'admin')  # Sync is_admin with role

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
        "role": user.role,
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
