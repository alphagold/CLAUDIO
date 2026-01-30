"""
Face Recognition API Routes

Gestisce consent GDPR, detection volti, labeling persone, similarity search.
"""

import logging
from typing import List, Optional
from uuid import UUID
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.security import OAuth2PasswordBearer
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from database import get_db
from models import User, Face, Person, Photo, FaceRecognitionConsent
from face_recognition_service import FaceRecognitionService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/faces", tags=["Face Recognition"])

# Dependency injection - will be set by main.py to avoid circular imports
get_current_user_dependency = None


def get_current_user_wrapper(
    token: str = Depends(OAuth2PasswordBearer(tokenUrl="/api/auth/login")),
    db: Session = Depends(get_db)
) -> User:
    """Wrapper to call get_current_user_dependency at runtime"""
    from fastapi import HTTPException
    if get_current_user_dependency is None:
        raise HTTPException(status_code=500, detail="Authentication not initialized")
    return get_current_user_dependency(token=token, db=db)


# ============================================================================
# Pydantic Models
# ============================================================================

class ConsentResponse(BaseModel):
    """GDPR consent status"""
    consent_given: bool
    consent_date: Optional[str] = None
    can_use_face_recognition: bool


class ConsentGiveRequest(BaseModel):
    """Request per dare consenso"""
    pass  # No body needed, IP viene preso da request


class ConsentRevokeRequest(BaseModel):
    """Request per revocare consenso"""
    delete_data: bool = Field(default=False, description="Se True, elimina tutti i dati facciali")
    reason: str = Field(default="User request", description="Motivazione revoca")


class FaceDetectionResponse(BaseModel):
    """Risposta detection volti"""
    photo_id: str
    faces_detected: int
    status: str  # 'completed', 'no_faces', 'failed'


class FaceResponse(BaseModel):
    """Singolo volto rilevato"""
    id: str
    person_id: Optional[str] = None
    person_name: Optional[str] = None
    bbox: dict  # {x, y, width, height}
    quality_score: Optional[float] = None
    cluster_id: Optional[int] = None


class PersonResponse(BaseModel):
    """Persona identificata"""
    id: str
    name: Optional[str] = None
    notes: Optional[str] = None
    photo_count: int
    first_seen_at: Optional[str] = None
    last_seen_at: Optional[str] = None
    is_verified: bool
    representative_face_id: Optional[str] = None


class PersonUpdateRequest(BaseModel):
    """Update dati persona"""
    name: Optional[str] = None
    notes: Optional[str] = None
    is_verified: Optional[bool] = None


class FaceLabelRequest(BaseModel):
    """Request per etichettare volto"""
    person_id: Optional[str] = Field(None, description="ID persona esistente")
    person_name: Optional[str] = Field(None, description="Nome nuova persona")


class SimilarFaceResponse(BaseModel):
    """Volto simile trovato"""
    face_id: str
    person_id: Optional[str] = None
    person_name: Optional[str] = None
    similarity: float
    distance: float


class ClusterResponse(BaseModel):
    """Cluster di volti non etichettati"""
    cluster_id: int
    face_count: int
    faces: List[str]  # Lista di face_id
    representative_face: Optional[str] = None


# ============================================================================
# GDPR Consent Endpoints
# ============================================================================

@router.get("/consent", response_model=ConsentResponse)
async def get_consent_status(
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Ottiene lo stato del consenso GDPR per face recognition.
    """
    service = FaceRecognitionService(db)
    has_consent = service.check_user_consent(current_user.id)

    consent_record = db.query(FaceRecognitionConsent).filter(
        FaceRecognitionConsent.user_id == current_user.id
    ).first()

    return ConsentResponse(
        consent_given=has_consent,
        consent_date=consent_record.consent_date.isoformat() if consent_record and consent_record.consent_date else None,
        can_use_face_recognition=has_consent
    )


@router.post("/consent/give", response_model=ConsentResponse)
async def give_consent(
    request: Request,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Concede consenso GDPR per face recognition.
    Registra IP del client per audit.
    """
    service = FaceRecognitionService(db)

    # Get client IP
    client_ip = request.client.host if request.client else "unknown"

    consent = service.give_consent(current_user.id, client_ip)

    return ConsentResponse(
        consent_given=True,
        consent_date=consent.consent_date.isoformat() if consent.consent_date else None,
        can_use_face_recognition=True
    )


@router.post("/consent/revoke", response_model=ConsentResponse)
async def revoke_consent(
    body: ConsentRevokeRequest,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Revoca consenso GDPR per face recognition.
    Opzionalmente elimina tutti i dati facciali.
    """
    service = FaceRecognitionService(db)

    try:
        consent = service.revoke_consent(
            current_user.id,
            reason=body.reason,
            delete_data=body.delete_data
        )

        return ConsentResponse(
            consent_given=False,
            consent_date=None,
            can_use_face_recognition=False
        )
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))


# ============================================================================
# Face Detection Endpoints
# ============================================================================

@router.post("/detect/{photo_id}", response_model=FaceDetectionResponse)
async def detect_faces(
    photo_id: UUID,
    model: str = "hog",  # 'hog' (CPU) or 'cnn' (GPU)
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Rileva volti in una foto specifica.
    Genera embeddings 128-dim per ogni volto.

    Args:
        photo_id: ID foto
        model: 'hog' (veloce, CPU) o 'cnn' (accurato, GPU)
    """
    # Check photo exists and belongs to user
    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.user_id == current_user.id
    ).first()

    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    service = FaceRecognitionService(db)

    # Check consent
    if not service.check_user_consent(current_user.id):
        raise HTTPException(
            status_code=403,
            detail="Face recognition consent required. Please enable in Settings."
        )

    try:
        faces = service.detect_faces_in_photo(
            photo_id,
            photo.original_path,
            model=model
        )

        return FaceDetectionResponse(
            photo_id=str(photo_id),
            faces_detected=len(faces),
            status="completed" if faces else "no_faces"
        )

    except Exception as e:
        logger.error(f"Face detection failed for photo {photo_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Face detection failed: {str(e)}")


@router.get("/photo/{photo_id}", response_model=List[FaceResponse])
async def get_photo_faces(
    photo_id: UUID,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Ottiene tutti i volti rilevati in una foto.
    """
    # Check photo ownership
    photo = db.query(Photo).filter(
        Photo.id == photo_id,
        Photo.user_id == current_user.id
    ).first()

    if not photo:
        raise HTTPException(status_code=404, detail="Photo not found")

    # Get faces
    faces = db.query(Face).filter(
        Face.photo_id == photo_id,
        Face.deleted_at.is_(None)
    ).all()

    return [
        FaceResponse(
            id=str(face.id),
            person_id=str(face.person_id) if face.person_id else None,
            person_name=face.person.name if face.person else None,
            bbox={
                "x": face.bbox_x,
                "y": face.bbox_y,
                "width": face.bbox_width,
                "height": face.bbox_height
            },
            quality_score=float(face.face_quality_score) if face.face_quality_score else None,
            cluster_id=face.cluster_id
        )
        for face in faces
    ]


# ============================================================================
# Person Management Endpoints
# ============================================================================

@router.get("/persons", response_model=List[PersonResponse])
async def list_persons(
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Lista tutte le persone identificate dall'utente.
    """
    persons = db.query(Person).filter(
        Person.user_id == current_user.id
    ).order_by(Person.photo_count.desc()).all()

    return [
        PersonResponse(
            id=str(p.id),
            name=p.name,
            notes=p.notes,
            photo_count=p.photo_count,
            first_seen_at=p.first_seen_at.isoformat() if p.first_seen_at else None,
            last_seen_at=p.last_seen_at.isoformat() if p.last_seen_at else None,
            is_verified=p.is_verified,
            representative_face_id=str(p.representative_face_id) if p.representative_face_id else None
        )
        for p in persons
    ]


@router.get("/persons/{person_id}", response_model=PersonResponse)
async def get_person(
    person_id: UUID,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Ottiene dettagli di una persona specifica.
    """
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.user_id == current_user.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    return PersonResponse(
        id=str(person.id),
        name=person.name,
        notes=person.notes,
        photo_count=person.photo_count,
        first_seen_at=person.first_seen_at.isoformat() if person.first_seen_at else None,
        last_seen_at=person.last_seen_at.isoformat() if person.last_seen_at else None,
        is_verified=person.is_verified,
        representative_face_id=str(person.representative_face_id) if person.representative_face_id else None
    )


@router.patch("/persons/{person_id}", response_model=PersonResponse)
async def update_person(
    person_id: UUID,
    body: PersonUpdateRequest,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Aggiorna informazioni di una persona (nome, note, verificato).
    """
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.user_id == current_user.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Update fields
    if body.name is not None:
        person.name = body.name
    if body.notes is not None:
        person.notes = body.notes
    if body.is_verified is not None:
        person.is_verified = body.is_verified

    db.commit()
    db.refresh(person)

    return PersonResponse(
        id=str(person.id),
        name=person.name,
        notes=person.notes,
        photo_count=person.photo_count,
        first_seen_at=person.first_seen_at.isoformat() if person.first_seen_at else None,
        last_seen_at=person.last_seen_at.isoformat() if person.last_seen_at else None,
        is_verified=person.is_verified,
        representative_face_id=str(person.representative_face_id) if person.representative_face_id else None
    )


@router.delete("/persons/{person_id}")
async def delete_person(
    person_id: UUID,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Elimina una persona. I volti associati vengono de-linkati (person_id = NULL).
    GDPR Right to Erasure.
    """
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.user_id == current_user.id
    ).first()

    if not person:
        raise HTTPException(status_code=404, detail="Person not found")

    # Cascade delete handled by DB (ON DELETE SET NULL for faces)
    db.delete(person)
    db.commit()

    logger.info(f"Deleted person {person_id} ({person.name})")
    return {"message": "Person deleted successfully"}


# ============================================================================
# Face Labeling Endpoints
# ============================================================================

@router.post("/label/{face_id}", response_model=FaceResponse)
async def label_face(
    face_id: UUID,
    body: FaceLabelRequest,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Etichetta un volto assegnandolo a una persona (esistente o nuova).

    Args:
        face_id: ID volto da etichettare
        body.person_id: ID persona esistente (opzionale)
        body.person_name: Nome nuova persona (opzionale)

    Deve essere fornito person_id OPPURE person_name.
    """
    if not body.person_id and not body.person_name:
        raise HTTPException(
            status_code=400,
            detail="Either person_id or person_name must be provided"
        )

    service = FaceRecognitionService(db)

    try:
        face = service.label_face(
            face_id=face_id,
            person_id=UUID(body.person_id) if body.person_id else None,
            person_name=body.person_name,
            user_id=current_user.id,
            label_type="manual"
        )

        return FaceResponse(
            id=str(face.id),
            person_id=str(face.person_id) if face.person_id else None,
            person_name=face.person.name if face.person else None,
            bbox={
                "x": face.bbox_x,
                "y": face.bbox_y,
                "width": face.bbox_width,
                "height": face.bbox_height
            },
            quality_score=float(face.face_quality_score) if face.face_quality_score else None,
            cluster_id=face.cluster_id
        )

    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/similar/{face_id}", response_model=List[SimilarFaceResponse])
async def get_similar_faces(
    face_id: UUID,
    threshold: float = 0.6,
    limit: int = 10,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Trova volti simili usando pgvector similarity search.

    Args:
        face_id: ID volto di riferimento
        threshold: Distanza massima (0.6 = stessa persona)
        limit: Numero massimo risultati
    """
    # Verify face belongs to user's photos
    face = db.query(Face).join(Photo).filter(
        Face.id == face_id,
        Photo.user_id == current_user.id
    ).first()

    if not face:
        raise HTTPException(status_code=404, detail="Face not found")

    service = FaceRecognitionService(db)
    similar_faces = service.suggest_similar_faces(face_id, threshold, limit)

    return [
        SimilarFaceResponse(**f) for f in similar_faces
    ]


# ============================================================================
# Clustering Endpoints
# ============================================================================

@router.get("/clusters", response_model=List[ClusterResponse])
async def get_clusters(
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Ottiene tutti i cluster di volti non ancora etichettati.
    Utile per suggerire grouping automatico.
    """
    service = FaceRecognitionService(db)
    clusters = service.get_clusters(current_user.id)

    return [ClusterResponse(**c) for c in clusters]


@router.post("/clusters/{cluster_id}/label")
async def label_cluster(
    cluster_id: int,
    person_name: str,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db)
):
    """
    Etichetta tutti i volti di un cluster con un nome persona.
    Assegnazione batch per velocizzare labeling.
    """
    # Get all faces in cluster
    faces = db.query(Face).join(Photo).filter(
        Photo.user_id == current_user.id,
        Face.cluster_id == cluster_id,
        Face.person_id.is_(None),
        Face.deleted_at.is_(None)
    ).all()

    if not faces:
        raise HTTPException(status_code=404, detail="Cluster not found or already labeled")

    service = FaceRecognitionService(db)

    # Label first face (creates person)
    first_face = service.label_face(
        face_id=faces[0].id,
        person_id=None,
        person_name=person_name,
        user_id=current_user.id,
        label_type="auto"
    )

    person_id = first_face.person_id

    # Label remaining faces with same person
    for face in faces[1:]:
        service.label_face(
            face_id=face.id,
            person_id=person_id,
            person_name=None,
            user_id=current_user.id,
            label_type="auto"
        )

    logger.info(f"Labeled cluster {cluster_id} with {len(faces)} faces as '{person_name}'")

    return {
        "message": f"Labeled {len(faces)} faces as '{person_name}'",
        "person_id": str(person_id)
    }
