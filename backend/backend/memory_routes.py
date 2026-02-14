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


class AnswerRequest(BaseModel):
    answer: str = Field(..., min_length=1, max_length=2000)


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

    # Ollama locale o remoto in base a preferenza utente
    ollama_url = "http://ollama:11434"
    ollama_model = model or getattr(current_user, 'text_model', None) or "llama3.2:latest"

    if getattr(current_user, 'text_use_remote', False) and current_user.remote_ollama_url:
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

    # Ollama locale o remoto in base a preferenza utente
    ollama_url = "http://ollama:11434"
    ollama_model = request.model or getattr(current_user, 'text_model', None) or "llama3.2:latest"

    if getattr(current_user, 'text_use_remote', False) and current_user.remote_ollama_url:
        ollama_url = current_user.remote_ollama_url

    result = await service.ask_with_context(
        user_id=current_user.id,
        question=request.question,
        ollama_url=ollama_url,
        model=ollama_model,
    )
    return result


# ============================================================================
# ROUTES - CONVERSATIONS
# ============================================================================

@router.get("/conversations")
async def list_conversations(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Recupera cronologia conversazioni."""
    service = MemoryService(db)
    conversations, total = service.get_conversations(
        user_id=current_user.id, limit=limit, offset=offset,
    )
    return {"conversations": conversations, "total": total}


@router.delete("/conversations")
async def clear_conversations(
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Cancella tutte le conversazioni dell'utente."""
    service = MemoryService(db)
    deleted = service.clear_conversations(user_id=current_user.id)
    return {"message": f"{deleted} conversazioni eliminate", "deleted": deleted}


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


# ============================================================================
# ROUTES - MEMORY QUESTIONS
# ============================================================================

@router.get("/questions")
async def list_questions(
    photo_id: Optional[str] = None,
    status: Optional[str] = None,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Lista domande memoria, opzionalmente filtrate per foto e/o status."""
    service = MemoryService(db)
    pid = UUID(photo_id) if photo_id else None
    questions = service.get_questions(user_id=current_user.id, photo_id=pid, status=status)
    return {"questions": questions, "count": len(questions)}


@router.get("/questions/count")
async def get_questions_count(
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Conteggio domande pending."""
    service = MemoryService(db)
    count = service.get_pending_count(user_id=current_user.id)
    return {"pending_count": count}


@router.post("/questions/{question_id}/answer")
async def answer_question(
    question_id: UUID,
    request: AnswerRequest,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Risponde a una domanda memoria e la indicizza."""
    service = MemoryService(db)
    result = service.answer_question(
        question_id=question_id,
        user_id=current_user.id,
        answer=request.answer,
    )
    if not result:
        raise HTTPException(status_code=404, detail="Domanda non trovata")
    return result


@router.post("/questions/{question_id}/skip")
async def skip_question(
    question_id: UUID,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Salta una domanda."""
    service = MemoryService(db)
    success = service.skip_question(
        question_id=question_id,
        user_id=current_user.id,
    )
    if not success:
        raise HTTPException(status_code=404, detail="Domanda non trovata")
    return {"message": "Domanda saltata"}


@router.post("/questions/generate/{photo_id}")
async def generate_questions_for_photo(
    photo_id: UUID,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """Genera domande manualmente per una foto."""
    from models import Photo, PhotoAnalysis, Person, Face, MemoryQuestion

    # Verifica foto e analisi
    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.user_id == current_user.id,
        Photo.deleted_at.is_(None),
    ).first()
    if not photo:
        raise HTTPException(status_code=404, detail="Foto non trovata")

    analysis = db.query(PhotoAnalysis).filter(PhotoAnalysis.photo_id == photo_id).first()
    if not analysis:
        raise HTTPException(status_code=400, detail="Foto non ancora analizzata")

    # Importa helper da main.py
    try:
        from main import _build_faces_context, _generate_memory_questions_sync
    except ImportError:
        raise HTTPException(status_code=500, detail="Servizio non disponibile")

    faces_info = _build_faces_context(db, photo_id)

    # Costruisci user_config
    user_config = {
        "remote_enabled": current_user.remote_ollama_enabled,
        "remote_url": current_user.remote_ollama_url,
        "remote_model": current_user.remote_ollama_model,
        "text_model": getattr(current_user, 'text_model', None) or "llama3.2:latest",
        "text_use_remote": getattr(current_user, 'text_use_remote', False),
    }

    analysis_result = {
        "raw_response": analysis.raw_response or analysis.description_full,
        "description_full": analysis.description_full,
    }

    _generate_memory_questions_sync(
        db, photo_id, photo, current_user, analysis_result,
        faces_info, photo.location_name, user_config
    )

    # Ritorna le domande generate
    service = MemoryService(db)
    questions = service.get_questions(user_id=current_user.id, photo_id=photo_id)
    return {"questions": questions, "count": len(questions)}
