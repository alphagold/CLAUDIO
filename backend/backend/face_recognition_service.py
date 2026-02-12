"""
Face Recognition Service

Gestisce detection, clustering, labeling e similarity search per volti.
Utilizza face_recognition library (basata su dlib) per generare embeddings 128-dim.
"""

import logging
import traceback
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone
from uuid import UUID
import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func, text, distinct

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
            consent.consent_date = datetime.now(timezone.utc)
            consent.consent_ip = ip_address
            consent.revoked_at = None
            consent.revoked_reason = None
            consent.updated_at = datetime.now(timezone.utc)
        else:
            # Create new
            consent = FaceRecognitionConsent(
                user_id=user_id,
                consent_given=True,
                consent_date=datetime.now(timezone.utc),
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
        consent.revoked_at = datetime.now(timezone.utc)
        consent.revoked_reason = reason
        consent.updated_at = datetime.now(timezone.utc)

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

        # Soft-delete Face esistenti per questa foto (evita duplicati su ri-analisi)
        existing_faces = self.db.query(Face).filter(
            Face.photo_id == photo_id,
            Face.deleted_at.is_(None)
        ).all()
        affected_person_ids = list({str(f.person_id) for f in existing_faces if f.person_id is not None})
        for ef in existing_faces:
            ef.deleted_at = datetime.now(timezone.utc)

        # Update status
        photo.face_detection_status = "processing"
        self.db.commit()

        # Ricalcola photo_count per persone che avevano volti in questa foto
        for pid_str in affected_person_ids:
            pid_uuid = UUID(pid_str)
            pc = self.db.query(func.count(distinct(Face.photo_id))).filter(
                Face.person_id == pid_uuid,
                Face.deleted_at.is_(None)
            ).scalar() or 0
            self.db.execute(
                text("UPDATE persons SET photo_count = :count WHERE id = :pid"),
                {"count": pc, "pid": pid_str}
            )
        if affected_person_ids:
            self.db.commit()

        try:
            # Preprocessing: correggi EXIF, ridimensiona se necessario
            resized_image, full_image, scale_factor = self._preprocess_image(image_path)

            # Detect face locations sull'immagine ridimensionata
            face_locations = face_recognition.face_locations(resized_image, model=model)

            # Retry con upsampling se nessun volto trovato (cattura volti piccoli/distanti)
            if not face_locations:
                logger.info(f"Nessun volto al primo tentativo per photo {photo_id}, retry con upsample=2")
                face_locations = face_recognition.face_locations(
                    resized_image, model=model, number_of_times_to_upsample=2
                )

            if not face_locations:
                logger.info(f"No faces detected in photo {photo_id}")
                photo.face_detection_status = "no_faces"
                photo.faces_detected_at = datetime.now(timezone.utc)
                self.db.commit()
                return []

            # Rimappa coordinate bbox all'immagine originale
            if scale_factor < 1.0:
                inv_scale = 1.0 / scale_factor
                original_face_locations = [
                    (
                        int(top * inv_scale),
                        int(right * inv_scale),
                        int(bottom * inv_scale),
                        int(left * inv_scale)
                    )
                    for top, right, bottom, left in face_locations
                ]
            else:
                original_face_locations = face_locations

            # Generate embeddings sull'immagine EXIF-corretta a piena risoluzione
            face_encodings = face_recognition.face_encodings(full_image, original_face_locations)

            # Calculate quality scores sull'immagine originale
            quality_scores = self._calculate_face_quality(full_image, original_face_locations)

            # Save faces (coordinate originali)
            created_faces = []
            for i, ((top, right, bottom, left), encoding, quality) in enumerate(
                zip(original_face_locations, face_encodings, quality_scores)
            ):
                face = Face(
                    photo_id=photo_id,
                    bbox_x=int(left),
                    bbox_y=int(top),
                    bbox_width=int(right - left),
                    bbox_height=int(bottom - top),
                    embedding=encoding.tolist(),
                    detection_confidence=0.90,
                    face_quality_score=float(quality)
                )
                self.db.add(face)
                created_faces.append(face)

            photo.face_detection_status = "completed"
            photo.faces_detected_at = datetime.now(timezone.utc)
            self.db.commit()

            logger.info(f"Detected {len(created_faces)} faces in photo {photo_id}")

            # Per ogni nuovo volto, cerca se corrisponde a una persona già nota
            # Wrappato in try/except: errore qui non deve bloccare il face detection
            try:
                auto_matched = 0
                for face in created_faces:
                    self.db.refresh(face)
                    match = self._match_to_known_persons(face, photo.user_id)
                    if match is not None:
                        person_id_match, similarity = match
                        face.person_id = person_id_match
                        label = FaceLabel(
                            face_id=face.id,
                            person_id=person_id_match,
                            labeled_by_user_id=photo.user_id,
                            label_type="auto",
                            confidence=float(similarity)
                        )
                        self.db.add(label)
                        auto_matched += 1

                if auto_matched > 0:
                    self.db.flush()
                    matched_person_ids = [
                        str(f.person_id) for f in created_faces
                        if f.person_id is not None
                    ]
                    for pid_str in set(matched_person_ids):
                        pid_uuid = UUID(pid_str)
                        pc = self.db.query(func.count(distinct(Face.photo_id))).filter(
                            Face.person_id == pid_uuid,
                            Face.deleted_at.is_(None)
                        ).scalar() or 0
                        self.db.execute(
                            text("UPDATE persons SET photo_count = :count WHERE id = :pid"),
                            {"count": pc, "pid": pid_str}
                        )
                    self.db.commit()
                    logger.info(f"Auto-matched {auto_matched} faces to known persons in photo {photo_id}")
            except Exception as e:
                logger.warning(f"Auto-match non critico fallito per photo {photo_id}: {e}")
                self.db.rollback()

            # Trigger auto-clustering (non critico)
            try:
                self._auto_cluster_faces(photo.user_id)
            except Exception as e:
                logger.warning(f"Auto-clustering non critico fallito per photo {photo_id}: {e}")

            return created_faces

        except FileNotFoundError as e:
            # File fisico mancante: salta permanentemente (non ri-accodare)
            logger.warning(f"Face detection skipped for photo {photo_id}: file not found at {image_path}")
            photo.face_detection_status = "skipped"
            self.db.commit()
        except Exception as e:
            logger.error(f"Face detection failed for photo {photo_id}: {e}")
            logger.error(f"Traceback completo:\n{traceback.format_exc()}")
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

    def _preprocess_image(
        self,
        image_path: str,
        max_long_side: int = 2048
    ) -> Tuple[np.ndarray, np.ndarray, float]:
        """
        Preprocessa immagine per face detection: corregge EXIF, ridimensiona.

        Args:
            image_path: Path assoluto al file immagine
            max_long_side: Dimensione massima del lato lungo (default 2048)

        Returns:
            (resized_array, exif_corrected_array, scale_factor)
            scale_factor = 1.0 se non ridimensionata
        """
        img = Image.open(image_path)

        # Correggi orientamento EXIF (foto da cellulare ruotate)
        from PIL import ImageOps
        img = ImageOps.exif_transpose(img)

        # Converti in RGB (rimuove alpha channel, gestisce grayscale)
        img = img.convert("RGB")

        # Immagine EXIF-corretta a risoluzione piena (per embedding di qualità)
        exif_corrected = np.array(img)

        # Ridimensiona se troppo grande (per detection veloce)
        w, h = img.size
        long_side = max(w, h)
        if long_side > max_long_side:
            scale_factor = max_long_side / long_side
            new_w = int(w * scale_factor)
            new_h = int(h * scale_factor)
            img_resized = img.resize((new_w, new_h), Image.LANCZOS)
            resized = np.array(img_resized)
        else:
            scale_factor = 1.0
            resized = exif_corrected

        return resized, exif_corrected, scale_factor

    # ========================================================================
    # Clustering
    # ========================================================================

    def _auto_cluster_faces(self, user_id: UUID, eps: float = 0.6, min_samples: int = 2):
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

        # Extract embeddings - converti in lista Python prima di np.array
        # (pgvector può ritornare Vector/numpy types che causano problemi)
        raw_embeddings = []
        valid_faces = []
        for face in unlabeled_faces:
            emb = face.embedding
            if emb is None:
                continue
            if hasattr(emb, 'tolist'):
                emb = emb.tolist()
            raw_embeddings.append(list(emb))
            valid_faces.append(face)

        if len(valid_faces) < min_samples:
            return

        embeddings = np.array(raw_embeddings, dtype=np.float64)
        unlabeled_faces = valid_faces

        # DBSCAN clustering (distanza euclidea L2, metrica nativa dlib)
        clustering = DBSCAN(eps=eps, min_samples=min_samples, metric='euclidean')
        labels = clustering.fit_predict(embeddings)

        # Assign cluster IDs - usa raw_embeddings (lista Python) invece di face.embedding (pgvector)
        for idx, (face, cluster_id) in enumerate(zip(unlabeled_faces, labels)):
            cluster_id_int = int(cluster_id)
            if cluster_id_int >= 0:  # Not noise
                face.cluster_id = cluster_id_int

                # Calculate distance to cluster centroid
                cluster_mask = labels == cluster_id_int
                cluster_embeddings = embeddings[cluster_mask]
                centroid = cluster_embeddings.mean(axis=0)
                distance = float(np.linalg.norm(
                    np.array(raw_embeddings[idx], dtype=np.float64) - centroid
                ))
                face.cluster_distance = round(float(distance), 4)

        self.db.commit()
        n_clusters = int(max(labels)) + 1 if len(labels) > 0 and int(max(labels)) >= 0 else 0
        logger.info(f"Clustered {len(unlabeled_faces)} faces into {n_clusters} clusters")

    def _cosine_distance(self, vec1, vec2: np.ndarray) -> float:
        """Calcola distanza coseno tra due vettori."""
        # Converti vec1 in lista Python se è pgvector o numpy (evita boolean ambiguity)
        if hasattr(vec1, 'tolist'):
            vec1 = vec1.tolist()
        v1 = np.array(list(vec1), dtype=np.float64)
        v2 = np.array(vec2, dtype=np.float64)
        norm1 = float(np.linalg.norm(v1))
        norm2 = float(np.linalg.norm(v2))
        if norm1 == 0.0 or norm2 == 0.0:
            return 1.0
        return float(1.0 - np.dot(v1, v2) / (norm1 * norm2))

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
        self.db.refresh(person)  # Previene expired object dopo commit

        # Cattura valori prima di ulteriori commit (evita access su oggetto expired)
        person_id_val = person.id
        user_id_val = person.user_id
        person_name_val = person.name

        # Aggiorna photo_count e last_seen_at per la persona
        photo_count = self.db.query(func.count(distinct(Face.photo_id))).filter(
            Face.person_id == person_id_val,
            Face.deleted_at.is_(None)
        ).scalar() or 0

        latest_photo = self.db.query(Photo).join(Face, Face.photo_id == Photo.id).filter(
            Face.person_id == person_id_val,
            Face.deleted_at.is_(None)
        ).order_by(Photo.uploaded_at.desc()).first()

        person.photo_count = photo_count
        if latest_photo:
            person.last_seen_at = latest_photo.uploaded_at
        self.db.commit()

        # Auto-assegna volti simili se labeling manuale (non bloccante)
        if label_type == "manual":
            try:
                auto_count = self._auto_assign_similar_faces(
                    face, person_id_val, user_id_val
                )
                if auto_count > 0:
                    logger.info(f"Auto-assegnati {auto_count} volti simili a {person_name_val}")
            except Exception as e:
                logger.warning(f"Auto-assegnazione volti simili fallita (non critico): {e}")
                try:
                    self.db.rollback()
                except Exception:
                    pass

        # Refresh face per assicurare stato pulito prima di restituire
        try:
            self.db.refresh(face)
        except Exception:
            pass

        logger.info(f"Labeled face {face_id} as person {person_id_val} ({person_name_val})")
        return face

    def _match_to_known_persons(
        self,
        face: Face,
        user_id: UUID,
        max_distance: float = 0.6
    ):
        """
        Per un nuovo volto, cerca se esiste già una persona nota con embedding simile.
        Usa distanza euclidea L2 (metrica nativa dlib, soglia 0.6).
        Restituisce (person_id, confidence) oppure None.
        """
        if face.embedding is None:
            return None

        # Converti embedding in lista Python (pgvector ritorna numpy array dopo db.refresh)
        emb = face.embedding
        if hasattr(emb, 'tolist'):
            emb = emb.tolist()

        query = text("""
            SELECT f.person_id,
                   (f.embedding <-> :embedding::vector) AS distance
            FROM faces f
            JOIN photos ph ON f.photo_id = ph.id
            WHERE f.person_id IS NOT NULL
              AND f.deleted_at IS NULL
              AND f.id != :face_id
              AND ph.user_id = :user_id
              AND (f.embedding <-> :embedding::vector) <= :max_distance
            ORDER BY f.embedding <-> :embedding::vector
            LIMIT 1
        """)

        result = self.db.execute(
            query,
            {
                "face_id": str(face.id),
                "embedding": str(emb),
                "user_id": str(user_id),
                "max_distance": max_distance
            }
        ).fetchone()

        if result is not None:
            # Converti distanza L2 in confidenza: 0.0 dist → 1.0, 0.6 dist → 0.0
            confidence = max(0.0, 1.0 - (float(result.distance) / max_distance))
            return (result.person_id, confidence)
        return None

    def _auto_assign_similar_faces(
        self,
        labeled_face: Face,
        person_id: UUID,
        user_id: UUID,
        max_distance: float = 0.6
    ) -> int:
        """
        Auto-assegna la stessa persona a volti simili non etichettati.

        Dopo un labeling manuale, cerca volti con distanza euclidea L2 <= max_distance
        e li assegna automaticamente alla stessa persona.

        Soglia 0.6 = standard dlib per stessa persona (distanza L2).

        Args:
            labeled_face: Volto appena etichettato (riferimento)
            person_id: ID persona da assegnare (valore catturato, non oggetto ORM)
            user_id: ID utente (valore catturato, non oggetto ORM)
            max_distance: Soglia distanza L2 massima

        Returns:
            Numero di volti auto-assegnati
        """
        if labeled_face.embedding is None:
            return 0

        # Converti embedding in lista Python (pgvector ritorna numpy array dopo db.refresh)
        emb = labeled_face.embedding
        if hasattr(emb, 'tolist'):
            emb = emb.tolist()

        query = text("""
            SELECT f.id,
                   (f.embedding <-> :embedding::vector) AS distance
            FROM faces f
            JOIN photos ph ON f.photo_id = ph.id
            WHERE f.person_id IS NULL
              AND f.deleted_at IS NULL
              AND f.id != :face_id
              AND ph.user_id = :user_id
              AND (f.embedding <-> :embedding::vector) <= :max_distance
            ORDER BY f.embedding <-> :embedding::vector
            LIMIT 100
        """)

        results = self.db.execute(
            query,
            {
                "face_id": str(labeled_face.id),
                "embedding": str(emb),
                "user_id": str(user_id),
                "max_distance": max_distance
            }
        ).fetchall()

        if not results:
            logger.info(f"Nessun volto simile trovato (max_distance={max_distance})")
            return 0

        assigned_count = 0
        for row in results:
            face_to_assign = self.db.query(Face).filter(Face.id == row.id).first()
            if face_to_assign and face_to_assign.person_id is None:
                face_to_assign.person_id = person_id
                face_to_assign.cluster_id = None
                # Converti distanza L2 in confidenza
                confidence = max(0.0, 1.0 - (float(row.distance) / max_distance))
                label = FaceLabel(
                    face_id=face_to_assign.id,
                    person_id=person_id,
                    labeled_by_user_id=user_id,
                    label_type="auto",
                    confidence=float(confidence)
                )
                self.db.add(label)
                assigned_count += 1

        if assigned_count > 0:
            self.db.flush()
            photo_count = self.db.query(func.count(distinct(Face.photo_id))).filter(
                Face.person_id == person_id,
                Face.deleted_at.is_(None)
            ).scalar() or 0
            # Aggiorna person tramite query diretta (evita oggetto ORM expired)
            self.db.execute(
                text("UPDATE persons SET photo_count = :count WHERE id = :pid"),
                {"count": photo_count, "pid": str(person_id)}
            )
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
            Photo.uploaded_at,
            Photo.file_path,
            Face.bbox_x,
            Face.bbox_y,
            Face.bbox_width,
            Face.bbox_height
        ).join(Face).filter(
            Face.person_id == person_id,
            Face.deleted_at.is_(None)
        ).order_by(Photo.uploaded_at.desc()).limit(limit).all()

        return [
            {
                "photo_id": str(r.id),
                "upload_date": r.uploaded_at.isoformat(),
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
        Trova volti simili usando pgvector L2 distance search.

        Args:
            face_id: ID volto di riferimento
            threshold: Distanza L2 massima (0.6 = same person per dlib)
            limit: Numero massimo risultati

        Returns:
            Lista di dict con face_id, distance, person_name
        """
        face = self.db.query(Face).filter(Face.id == face_id).first()
        if not face:
            raise ValueError(f"Face {face_id} not found")

        # pgvector L2 distance search (metrica nativa dlib)
        query = text("""
            SELECT
                f.id,
                f.person_id,
                p.name as person_name,
                (f.embedding <-> :embedding::vector) as distance
            FROM faces f
            LEFT JOIN persons p ON f.person_id = p.id
            WHERE f.id != :face_id
              AND f.deleted_at IS NULL
              AND (f.embedding <-> :embedding::vector) <= :threshold
            ORDER BY f.embedding <-> :embedding::vector
            LIMIT :limit
        """)

        # Converti embedding in lista Python
        emb = face.embedding
        if hasattr(emb, 'tolist'):
            emb = emb.tolist()

        results = self.db.execute(
            query,
            {
                "face_id": str(face_id),
                "embedding": str(emb),
                "threshold": threshold,
                "limit": limit
            }
        ).fetchall()

        return [
            {
                "face_id": str(r.id),
                "person_id": str(r.person_id) if r.person_id else None,
                "person_name": r.person_name,
                "similarity": round(max(0.0, 1.0 - (float(r.distance) / threshold)), 3),
                "distance": round(float(r.distance), 3)
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
