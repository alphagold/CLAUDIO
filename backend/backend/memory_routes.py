"""
Memory API Routes - Q&A conversazionale, indicizzazione, direttive personali
"""
import logging
from typing import Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import User
from memory_service import MemoryService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memory", tags=["Memory"])

# Dependency injection placeholder (set in main.py)
get_current_user_dependency = None


def get_current_user_wrapper(
    token: str = Depends(OAuth2PasswordBearer(tokenUrl="/api/auth/login")),
    db: Session = Depends(get_db)
) -> User:
    """Wrapper to call get_current_user_dependency at runtime"""
    if get_current_user_dependency is None:
        raise HTTPException(status_code=500, detail="Authentication not initialized")
    return get_current_user_dependency(token=token, db=db)


# ============================================================================
# Pydantic Models
# ============================================================================

class AskRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=1000)
    model: Optional[str] = None


class FeedbackRequest(BaseModel):
    conversation_id: str
    feedback: str = Field(..., pattern="^(positive|negative|corrected)$")


class DirectiveCreate(BaseModel):
    directive: str = Field(..., min_length=1, max_length=500)


class DirectiveUpdate(BaseModel):
    directive: Optional[str] = None
    is_active: Optional[bool] = None


# ============================================================================
# ROUTES - Q&A
# ============================================================================

@router.get("/ask")
async def ask_question_get(
    q: str,
    model: Optional[str] = None,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Domanda con contesto (GET). Cerca nell'indice e risponde con Ollama."""
    service = MemoryService(db)

    ollama_url = "http://ollama:11434"
    ollama_model = model or "llama3.2:latest"

    if current_user.remote_ollama_enabled and current_user.remote_ollama_url:
        ollama_url = current_user.remote_ollama_url

    result = await service.ask_with_context(
        user_id=current_user.id,
        question=q,
        ollama_url=ollama_url,
        model=ollama_model,
    )
    return result


@router.post("/ask")
async def ask_question_post(
    request: AskRequest,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Domanda con contesto (POST). Cerca nell'indice e risponde con Ollama."""
    service = MemoryService(db)

    ollama_url = "http://ollama:11434"
    ollama_model = request.model or "llama3.2:latest"

    if current_user.remote_ollama_enabled and current_user.remote_ollama_url:
        ollama_url = current_user.remote_ollama_url

    result = await service.ask_with_context(
        user_id=current_user.id,
        question=request.question,
        ollama_url=ollama_url,
        model=ollama_model,
    )
    return result


# ============================================================================
# ROUTES - FEEDBACK
# ============================================================================

@router.post("/learn")
async def learn_from_feedback(
    request: FeedbackRequest,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Feedback su una risposta (positive/negative/corrected)."""
    service = MemoryService(db)
    success = service.learn_from_feedback(
        conversation_id=UUID(request.conversation_id),
        feedback=request.feedback,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Conversazione non trovata")

    return {"message": "Feedback salvato", "feedback": request.feedback}


# ============================================================================
# ROUTES - REINDEX
# ============================================================================

@router.post("/reindex")
async def reindex_memory(
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Reindicizza tutto il contenuto dell'utente (foto, persone, luoghi, oggetti, testi)."""
    service = MemoryService(db)
    counts = service.reindex_all(user_id=current_user.id)

    return {
        "message": "Reindicizzazione completata",
        "indexed": counts,
        "total": sum(counts.values()),
    }


# ============================================================================
# ROUTES - DIRETTIVE
# ============================================================================

@router.get("/directives")
async def list_directives(
    active_only: bool = True,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Lista direttive personali attive."""
    service = MemoryService(db)
    directives = service.get_directives(user_id=current_user.id, active_only=active_only)
    return {"directives": directives, "count": len(directives)}


@router.post("/directives")
async def create_directive(
    request: DirectiveCreate,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Crea una nuova direttiva personale."""
    service = MemoryService(db)
    directive = service.create_directive(
        user_id=current_user.id,
        directive=request.directive,
    )
    return directive


@router.patch("/directives/{directive_id}")
async def update_directive(
    directive_id: UUID,
    request: DirectiveUpdate,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Modifica una direttiva esistente."""
    service = MemoryService(db)
    result = service.update_directive(
        directive_id=directive_id,
        user_id=current_user.id,
        directive=request.directive,
        is_active=request.is_active,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Direttiva non trovata")
    return result


@router.delete("/directives/{directive_id}")
async def delete_directive(
    directive_id: UUID,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Elimina una direttiva."""
    service = MemoryService(db)
    success = service.delete_directive(
        directive_id=directive_id,
        user_id=current_user.id,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Direttiva non trovata")
    return {"message": "Direttiva eliminata"}
