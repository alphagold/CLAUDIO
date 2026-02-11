"""
Face Recognition Service

Gestisce detection, clustering, labeling e similarity search per volti.
Utilizza face_recognition library (basata su dlib) per generare embeddings 128-dim.
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime
from uuid import UUID
import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func, text

# Face recognition (optional)
try:
    import face_recognition
    from PIL import Image
    import cv2
    from sklearn.cluster import DBSCAN
    FACE_RECOGNITION_AVAILABLE = True
except ImportError as e:
    FACE_RECOGNITION_AVAILABLE = False
    print(f"WARNING: face_recognition not available: {e}")
    print("Face recognition features will be disabled")

# Registra psycopg2 adapters per tipi numpy - previene "can't adapt type numpy.floatX"
# face_recognition/cv2 producono numpy scalars che psycopg2 non serializza nativamente
try:
    from psycopg2.extensions import register_adapter as _pg2_register, AsIs as _pg2_AsIs
    _pg2_register(np.float32, lambda x: _pg2_AsIs(float(x)))
    _pg2_register(np.float64, lambda x: _pg2_AsIs(float(x)))
    _pg2_register(np.int32, lambda x: _pg2_AsIs(int(x)))
    _pg2_register(np.int64, lambda x: _pg2_AsIs(int(x)))
except Exception:
    pass

# Models
from models import Face, Person, FaceLabel, FaceRecognitionConsent, Photo

logger = logging.getLogger(__name__)


class FaceRecognitionService:
    """
    Servizio completo per face recognition:
    - Detection volti con bounding boxes
    - Generazione embeddings 128-dim (dlib)
    - Clustering automatico DBSCAN
    - Labeling e similarity search
    """

    def __init__(self, db: Session):
        self.db = db

    # ========================================================================
    # GDPR Consent Management
    # ========================================================================

    def check_user_consent(self, user_id: UUID) -> bool:
        """
        Verifica se l'utente ha dato consenso per face recognition.

        Args:
            user_id: ID utente

        Returns:
            True se consenso attivo, False altrimenti
        """
        consent = self.db.query(FaceRecognitionConsent).filter(
            FaceRecognitionConsent.user_id == user_id
        ).first()

        if not consent:
            return False

        return consent.consent_given and consent.revoked_at is None

    def give_consent(self, user_id: UUID, ip_address: str) -> FaceRecognitionConsent:
        """
        Registra consenso GDPR per face recognition.

        Args:
            user_id: ID utente
            ip_address: IP del client per audit

        Returns:
            Record consenso creato/aggiornato
        """
        consent = self.db.query(FaceRecognitionConsent).filter(
            FaceRecognitionConsent.user_id == user_id
        ).first()

        if consent:
            # Update existing
            consent.consent_given = True
            consent.consent_date = datetime.utcnow()
            consent.consent_ip = ip_address
            consent.revoked_at = None
            consent.revoked_reason = None
            consent.updated_at = datetime.utcnow()
        else:
            # Create new
            consent = FaceRecognitionConsent(
                user_id=user_id,
                consent_given=True,
                consent_date=datetime.utcnow(),
                consent_ip=ip_address
            )
            self.db.add(consent)

        self.db.commit()
        self.db.refresh(consent)
        logger.info(f"User {user_id} gave face recognition consent")
        return consent

    def revoke_consent(
        self,
        user_id: UUID,
        reason: str = "User request",
        delete_data: bool = False
    ) -> FaceRecognitionConsent:
        """
        Revoca consenso GDPR. Opzionalmente elimina tutti i dati facciali.

        Args:
            user_id: ID utente
            reason: Motivazione revoca
            delete_data: Se True, elimina tutti i Face e Person records

        Returns:
            Record consenso aggiornato
        """
        consent = self.db.query(FaceRecognitionConsent).filter(
            FaceRecognitionConsent.user_id == user_id
        ).first()

        if not consent:
            raise ValueError("No consent record found for user")

        consent.consent_given = False
        consent.revoked_at = datetime.utcnow()
        consent.revoked_reason = reason
        consent.updated_at = datetime.utcnow()

        if delete_data:
            # Soft delete all faces (cascade handled by DB)
            self.db.execute(
                text("UPDATE faces SET deleted_at = NOW() WHERE photo_id IN (SELECT id FROM photos WHERE user_id = :user_id)"),
                {"user_id": str(user_id)}
            )

            # Delete all persons
            self.db.query(Person).filter(Person.user_id == user_id).delete()

            logger.warning(f"Deleted all face data for user {user_id}")

        self.db.commit()
        self.db.refresh(consent)
        logger.info(f"User {user_id} revoked face recognition consent (delete_data={delete_data})")
        return consent

    # ========================================================================
    # Face Detection & Embedding
    # ========================================================================

    def detect_faces_in_photo(
        self,
        photo_id: UUID,
        image_path: str,
        model: str = "hog"
    ) -> List[Face]:
        """
        Rileva tutti i volti in una foto e genera embeddings.

        Returns empty list if face_recognition library not available.

        Args:
            photo_id: ID foto nel database
            image_path: Path assoluto al file immagine
            model: 'hog' (CPU) o 'cnn' (GPU, più accurato ma lento)

        Returns:
            Lista di Face records creati

        Raises:
            ValueError: Se foto non esiste o utente non ha consenso
        """
        # Check if face_recognition is available
        if not FACE_RECOGNITION_AVAILABLE:
            logger.warning("face_recognition library not available - skipping face detection")
            return []

        # Fetch photo and check consent
        photo = self.db.query(Photo).filter(Photo.id == photo_id).first()
        if not photo:
            raise ValueError(f"Photo {photo_id} not found")

        if not self.check_user_consent(photo.user_id):
            raise ValueError(f"User {photo.user_id} has not given consent for face recognition")

        # Update status
        photo.face_detection_status = "processing"
        self.db.commit()

        try:
            # Load image
            image = face_recognition.load_image_file(image_path)

            # Detect face locations
            face_locations = face_recognition.face_locations(image, model=model)

            if not face_locations:
                logger.info(f"No faces detected in photo {photo_id}")
                photo.face_detection_status = "no_faces"
                photo.faces_detected_at = datetime.utcnow()
                self.db.commit()
                return []

            # Generate embeddings
            face_encodings = face_recognition.face_encodings(image, face_locations)

            # Calculate quality scores
            quality_scores = self._calculate_face_quality(image, face_locations)

            # Save faces
            created_faces = []
            for i, ((top, right, bottom, left), encoding, quality) in enumerate(
                zip(face_locations, face_encodings, quality_scores)
            ):
                face = Face(
                    photo_id=photo_id,
                    bbox_x=int(left),
                    bbox_y=int(top),
                    bbox_width=int(right - left),
                    bbox_height=int(bottom - top),
                    embedding=encoding.tolist(),  # Convert numpy to list
                    detection_confidence=0.90,
                    face_quality_score=float(quality)  # cast np.float → float per psycopg2
                )
                self.db.add(face)
                created_faces.append(face)

            photo.face_detection_status = "completed"
            photo.faces_detected_at = datetime.utcnow()
            self.db.commit()

            logger.info(f"Detected {len(created_faces)} faces in photo {photo_id}")

            # Trigger auto-clustering for this user
            self._auto_cluster_faces(photo.user_id)

            return created_faces

        except Exception as e:
            logger.error(f"Face detection failed for photo {photo_id}: {e}")
            photo.face_detection_status = "failed"
            self.db.commit()
            raise

    def _calculate_face_quality(
        self,
        image: np.ndarray,
        face_locations: List[Tuple[int, int, int, int]]
    ) -> List[float]:
        """
        Calcola score di qualità per ogni volto (sharpness, dimensione).

        Args:
            image: Immagine numpy array
            face_locations: Lista (top, right, bottom, left)

        Returns:
            Lista di quality scores [0.0-1.0]
        """
        quality_scores = []

        for top, right, bottom, left in face_locations:
            # Extract face region
            face_img = image[top:bottom, left:right]

            # Sharpness (Laplacian variance)
            gray = cv2.cvtColor(face_img, cv2.COLOR_RGB2GRAY)
            laplacian_var = float(cv2.Laplacian(gray, cv2.CV_64F).var())
            sharpness = min(laplacian_var / 500.0, 1.0)  # Normalize

            # Size score (larger faces = better)
            face_area = int(right - left) * int(bottom - top)
            image_area = int(image.shape[0]) * int(image.shape[1])
            size_ratio = face_area / image_area
            size_score = min(size_ratio * 10, 1.0)  # Normalize

            # Combined quality (weighted average) - ensure Python float
            quality = float(0.7 * sharpness + 0.3 * size_score)
            quality_scores.append(round(quality, 2))

        return quality_scores

    # ========================================================================
    # Clustering
    # ========================================================================

    def _auto_cluster_faces(self, user_id: UUID, eps: float = 0.5, min_samples: int = 2):
        """
        Esegue clustering DBSCAN sui volti non ancora etichettati.
        Suggerisce grouping automatico per person_id assignment.

        Args:
            user_id: ID utente
            eps: DBSCAN epsilon (distance threshold, default 0.5)
            min_samples: Minimo volti per cluster

        Note:
            - Solo faces con person_id=NULL vengono clusterizzati
            - Cluster -1 = noise (outliers)
        """
        # Fetch unlabeled faces
        unlabeled_faces = self.db.query(Face).join(Photo).filter(
            Photo.user_id == user_id,
            Face.person_id.is_(None),
            Face.deleted_at.is_(None)
        ).all()

        if len(unlabeled_faces) < min_samples:
            logger.info(f"Not enough unlabeled faces for clustering (found {len(unlabeled_faces)})")
            return

        # Extract embeddings
        embeddings = np.array([face.embedding for face in unlabeled_faces])

        # DBSCAN clustering (cosine distance)
        clustering = DBSCAN(eps=eps, min_samples=min_samples, metric='cosine')
        labels = clustering.fit_predict(embeddings)

        # Assign cluster IDs
        for face, cluster_id in zip(unlabeled_faces, labels):
            if cluster_id >= 0:  # Not noise
                face.cluster_id = int(cluster_id)

                # Calculate distance to cluster centroid
                cluster_embeddings = embeddings[labels == cluster_id]
                centroid = cluster_embeddings.mean(axis=0)
                distance = self._cosine_distance(face.embedding, centroid)
                face.cluster_distance = round(distance, 4)

        self.db.commit()
        logger.info(f"Clustered {len(unlabeled_faces)} faces into {max(labels) + 1} clusters")

    def _cosine_distance(self, vec1: List[float], vec2: np.ndarray) -> float:
        """Calcola distanza coseno tra due vettori."""
        vec1 = np.array(vec1)
        return 1 - np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2))

    # ========================================================================
    # Person Management
    # ========================================================================

    def label_face(
        self,
        face_id: UUID,
        person_id: Optional[UUID],
        person_name: Optional[str],
        user_id: UUID,
        label_type: str = "manual"
    ) -> Face:
        """
        Assegna un volto a una persona (esistente o nuova).

        Args:
            face_id: ID volto da etichettare
            person_id: ID persona esistente (se None, usa person_name)
            person_name: Nome nuova persona (ignorato se person_id fornito)
            user_id: ID utente che sta facendo il labeling
            label_type: 'manual', 'auto', 'suggestion'

        Returns:
            Face record aggiornato

        Raises:
            ValueError: Se né person_id né person_name forniti
        """
        face = self.db.query(Face).filter(Face.id == face_id).first()
        if not face:
            raise ValueError(f"Face {face_id} not found")

        # Determine person
        if person_id:
            person = self.db.query(Person).filter(Person.id == person_id).first()
            if not person:
                raise ValueError(f"Person {person_id} not found")
        elif person_name:
            # Create new person
            photo = self.db.query(Photo).filter(Photo.id == face.photo_id).first()
            person = Person(
                user_id=photo.user_id,
                name=person_name,
                first_seen_at=photo.uploaded_at
            )
            self.db.add(person)
            self.db.flush()  # Get person.id
        else:
            raise ValueError("Either person_id or person_name must be provided")

        # Update face
        old_person_id = face.person_id
        face.person_id = person.id
        face.cluster_id = None  # Remove cluster assignment

        # Create audit record
        label = FaceLabel(
            face_id=face_id,
            person_id=person.id,
            labeled_by_user_id=user_id,
            label_type=label_type,
            confidence=1.00 if label_type == "manual" else 0.80
        )
        self.db.add(label)

        # Update representative face if this is better quality
        if not person.representative_face_id or (
            face.face_quality_score and
            face.face_quality_score > 0.7
        ):
            person.representative_face_id = face_id

        self.db.commit()
        self.db.refresh(face)

        # Aggiorna photo_count per la persona (numero foto distinte)
        photo_count = self.db.query(func.count(func.distinct(Face.photo_id))).filter(
            Face.person_id == person.id,
            Face.deleted_at.is_(None)
        ).scalar() or 0
        person.photo_count = photo_count
        self.db.commit()

        # Auto-assegna volti simili se labeling manuale
        if label_type == "manual":
            auto_count = self._auto_assign_similar_faces(face, person)
            if auto_count > 0:
                logger.info(f"Auto-assegnati {auto_count} volti simili a {person.name}")

        logger.info(f"Labeled face {face_id} as person {person.id} ({person.name})")
        return face

    def _auto_assign_similar_faces(
        self,
        labeled_face: Face,
        person: Person,
        min_similarity: float = 0.6
    ) -> int:
        """
        Auto-assegna la stessa persona a volti simili non etichettati.

        Dopo un labeling manuale, cerca volti con similarità coseno >= min_similarity
        e li assegna automaticamente alla stessa persona.

        Args:
            labeled_face: Volto appena etichettato (riferimento)
            person: Persona da assegnare
            min_similarity: Soglia similarità coseno (0.6 ≈ stessa persona)

        Returns:
            Numero di volti auto-assegnati
        """
        if not labeled_face.embedding:
            return 0

        query = text("""
            SELECT f.id,
                   (1 - (f.embedding <=> :embedding::vector)) AS similarity
            FROM faces f
            JOIN photos ph ON f.photo_id = ph.id
            WHERE f.person_id IS NULL
              AND f.deleted_at IS NULL
              AND f.id != :face_id
              AND ph.user_id = :user_id
              AND (1 - (f.embedding <=> :embedding::vector)) >= :min_similarity
            ORDER BY f.embedding <=> :embedding::vector
            LIMIT 100
        """)

        results = self.db.execute(
            query,
            {
                "face_id": str(labeled_face.id),
                "embedding": str(labeled_face.embedding),
                "user_id": str(person.user_id),
                "min_similarity": min_similarity
            }
        ).fetchall()

        if not results:
            return 0

        assigned_count = 0
        for row in results:
            face_to_assign = self.db.query(Face).filter(Face.id == row.id).first()
            if face_to_assign and face_to_assign.person_id is None:
                face_to_assign.person_id = person.id
                face_to_assign.cluster_id = None
                label = FaceLabel(
                    face_id=face_to_assign.id,
                    person_id=person.id,
                    labeled_by_user_id=person.user_id,
                    label_type="auto",
                    confidence=float(row.similarity)
                )
                self.db.add(label)
                assigned_count += 1

        if assigned_count > 0:
            self.db.flush()
            photo_count = self.db.query(func.count(func.distinct(Face.photo_id))).filter(
                Face.person_id == person.id,
                Face.deleted_at.is_(None)
            ).scalar() or 0
            person.photo_count = photo_count
            self.db.commit()

        return assigned_count

    def get_person_photos(self, person_id: UUID, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Ottiene tutte le foto contenenti una persona specifica.

        Args:
            person_id: ID persona
            limit: Numero massimo foto da ritornare

        Returns:
            Lista di dict con photo_id, upload_date, face_bbox
        """
        results = self.db.query(
            Photo.id,
            Photo.upload_date,
            Photo.file_path,
            Face.bbox_x,
            Face.bbox_y,
            Face.bbox_width,
            Face.bbox_height
        ).join(Face).filter(
            Face.person_id == person_id,
            Face.deleted_at.is_(None)
        ).order_by(Photo.upload_date.desc()).limit(limit).all()

        return [
            {
                "photo_id": str(r.id),
                "upload_date": r.upload_date.isoformat(),
                "file_path": r.file_path,
                "face_bbox": {
                    "x": r.bbox_x,
                    "y": r.bbox_y,
                    "width": r.bbox_width,
                    "height": r.bbox_height
                }
            }
            for r in results
        ]

    # ========================================================================
    # Similarity Search
    # ========================================================================

    def suggest_similar_faces(
        self,
        face_id: UUID,
        threshold: float = 0.6,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Trova volti simili usando pgvector similarity search.

        Args:
            face_id: ID volto di riferimento
            threshold: Distanza massima (0.6 = same person)
            limit: Numero massimo risultati

        Returns:
            Lista di dict con face_id, distance, person_name
        """
        face = self.db.query(Face).filter(Face.id == face_id).first()
        if not face:
            raise ValueError(f"Face {face_id} not found")

        # pgvector similarity search (cosine distance)
        query = text("""
            SELECT
                f.id,
                f.person_id,
                p.name as person_name,
                1 - (f.embedding <=> :embedding::vector) as similarity
            FROM faces f
            LEFT JOIN persons p ON f.person_id = p.id
            WHERE f.id != :face_id
              AND f.deleted_at IS NULL
              AND (1 - (f.embedding <=> :embedding::vector)) > :threshold
            ORDER BY f.embedding <=> :embedding::vector
            LIMIT :limit
        """)

        results = self.db.execute(
            query,
            {
                "face_id": str(face_id),
                "embedding": str(face.embedding),
                "threshold": 1 - threshold,  # Convert distance to similarity
                "limit": limit
            }
        ).fetchall()

        return [
            {
                "face_id": str(r.id),
                "person_id": str(r.person_id) if r.person_id else None,
                "person_name": r.person_name,
                "similarity": round(r.similarity, 3),
                "distance": round(1 - r.similarity, 3)
            }
            for r in results
        ]

    def get_clusters(self, user_id: UUID) -> List[Dict[str, Any]]:
        """
        Ottiene tutti i cluster di volti non etichettati per un utente.

        Args:
            user_id: ID utente

        Returns:
            Lista di cluster con representative_face e face_count
        """
        # Get all unlabeled faces with cluster_id
        faces = self.db.query(Face).join(Photo).filter(
            Photo.user_id == user_id,
            Face.person_id.is_(None),
            Face.cluster_id.isnot(None),
            Face.deleted_at.is_(None)
        ).all()

        # Group by cluster_id
        clusters = {}
        for face in faces:
            cluster_id = face.cluster_id
            if cluster_id not in clusters:
                clusters[cluster_id] = {
                    "cluster_id": cluster_id,
                    "face_count": 0,
                    "faces": [],
                    "representative_face": None,
                    "best_quality": 0.0
                }

            clusters[cluster_id]["face_count"] += 1
            clusters[cluster_id]["faces"].append(str(face.id))

            # Select best quality face as representative
            if face.face_quality_score and face.face_quality_score > clusters[cluster_id]["best_quality"]:
                clusters[cluster_id]["representative_face"] = str(face.id)
                clusters[cluster_id]["best_quality"] = face.face_quality_score

        return list(clusters.values())
