"""
Face Recognition Service - InsightFace buffalo_l

Gestisce detection, clustering, labeling e similarity search per volti.
Utilizza InsightFace buffalo_l (ONNX/CPU) per generare embeddings 512-dim.
Metrica: cosine distance (pgvector <=> operator).
"""

import logging
import os
import traceback
from typing import List, Dict, Any, Optional, Tuple
from datetime import datetime, timezone
from uuid import UUID
import numpy as np
from sqlalchemy.orm import Session
from sqlalchemy import func, text, distinct

# InsightFace (optional)
try:
    from insightface.app import FaceAnalysis
    from PIL import Image, ImageOps
    import cv2
    from sklearn.cluster import DBSCAN
    FACE_RECOGNITION_AVAILABLE = True
except ImportError as e:
    FACE_RECOGNITION_AVAILABLE = False
    print(f"WARNING: insightface not available: {e}")
    print("Face recognition features will be disabled")

# Registra psycopg2 adapters per tipi numpy - previene "can't adapt type numpy.floatX"
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

# ============================================================================
# InsightFace Singleton (lazy initialization)
# ============================================================================

_insightface_app = None

# Soglie configurabili
DET_THRESH = 0.5       # Soglia minima detection confidence
MATCH_THRESH = 0.4     # Soglia cosine distance per match persona
CLUSTER_THRESH = 0.4   # Soglia cosine distance per DBSCAN clustering


def get_insightface_app() -> Optional['FaceAnalysis']:
    """
    Ritorna singleton FaceAnalysis con buffalo_l.
    Lazy init: scarica modello al primo uso (~300MB).
    Thread-safe per il GIL Python.
    """
    global _insightface_app

    if not FACE_RECOGNITION_AVAILABLE:
        return None

    if _insightface_app is not None:
        return _insightface_app

    try:
        model_name = os.environ.get("INSIGHTFACE_MODEL", "buffalo_l")
        logger.info(f"Inizializzazione InsightFace {model_name}...")

        app = FaceAnalysis(
            name=model_name,
            providers=['CPUExecutionProvider']
        )
        # det_size: dimensione input detector (640x640 è il default di buffalo_l)
        app.prepare(ctx_id=-1, det_size=(640, 640), det_thresh=DET_THRESH)

        _insightface_app = app
        logger.info(f"InsightFace {model_name} pronto (CPU, det_thresh={DET_THRESH})")
        return _insightface_app

    except Exception as e:
        logger.error(f"InsightFace init fallita: {e}")
        logger.error(traceback.format_exc())
        return None


class FaceRecognitionService:
    """
    Servizio completo per face recognition:
    - Detection volti con bounding boxes
    - Generazione embeddings 512-dim (InsightFace buffalo_l)
    - Clustering automatico DBSCAN (cosine distance)
    - Labeling e similarity search (pgvector <=> cosine)
    """

    def __init__(self, db: Session):
        self.db = db

    # ========================================================================
    # GDPR Consent Management
    # ========================================================================

    def check_user_consent(self, user_id: UUID) -> bool:
        """
        Verifica se l'utente ha dato consenso per face recognition.
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
        """
        consent = self.db.query(FaceRecognitionConsent).filter(
            FaceRecognitionConsent.user_id == user_id
        ).first()

        if consent:
            consent.consent_given = True
            consent.consent_date = datetime.now(timezone.utc)
            consent.consent_ip = ip_address
            consent.revoked_at = None
            consent.revoked_reason = None
            consent.updated_at = datetime.now(timezone.utc)
        else:
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
            self.db.execute(
                text("UPDATE faces SET deleted_at = NOW() WHERE photo_id IN (SELECT id FROM photos WHERE user_id = :user_id)"),
                {"user_id": str(user_id)}
            )
            self.db.query(Person).filter(Person.user_id == user_id).delete()
            logger.warning(f"Deleted all face data for user {user_id}")

        self.db.commit()
        self.db.refresh(consent)
        logger.info(f"User {user_id} revoked face recognition consent (delete_data={delete_data})")
        return consent

    # ========================================================================
    # Face Detection & Embedding (InsightFace)
    # ========================================================================

    def detect_faces_in_photo(
        self,
        photo_id: UUID,
        image_path: str
    ) -> List[Face]:
        """
        Rileva tutti i volti in una foto e genera embeddings 512-dim.

        InsightFace esegue detection + embedding in un solo passo.
        Bbox formato: [x1, y1, x2, y2] float → convertito in (x, y, w, h) int.

        Args:
            photo_id: ID foto nel database
            image_path: Path assoluto al file immagine

        Returns:
            Lista di Face records creati
        """
        app = get_insightface_app()
        if app is None:
            logger.warning("InsightFace not available - skipping face detection")
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
            # Preprocessing: EXIF transpose, resize, converti in BGR per InsightFace
            img_bgr, scale_factor = self._preprocess_image_bgr(image_path)

            # InsightFace: detection + embedding in un solo passo
            det_faces = app.get(img_bgr)

            if not det_faces:
                logger.info(f"No faces detected in photo {photo_id}")
                photo.face_detection_status = "no_faces"
                photo.faces_detected_at = datetime.now(timezone.utc)
                self.db.commit()
                return []

            # Save faces
            created_faces = []
            for det_face in det_faces:
                # Bbox: [x1, y1, x2, y2] float → (x, y, w, h) int
                bbox = det_face.bbox  # numpy array [x1, y1, x2, y2]
                x1, y1, x2, y2 = bbox

                # Remap a coordinate originali se resize applicato
                if scale_factor < 1.0:
                    inv_scale = 1.0 / scale_factor
                    x1 = x1 * inv_scale
                    y1 = y1 * inv_scale
                    x2 = x2 * inv_scale
                    y2 = y2 * inv_scale

                bbox_x = max(0, int(round(x1)))
                bbox_y = max(0, int(round(y1)))
                bbox_w = max(1, int(round(x2 - x1)))
                bbox_h = max(1, int(round(y2 - y1)))

                # Embedding 512-dim (L2-normalized da InsightFace)
                embedding = det_face.embedding
                embedding_list = embedding.tolist() if embedding is not None else None

                # Detection confidence reale
                det_score = float(det_face.det_score) if hasattr(det_face, 'det_score') else 0.90

                # Quality score: combinazione di det_score e dimensione volto
                face_area = bbox_w * bbox_h
                img_area = img_bgr.shape[0] * img_bgr.shape[1]
                size_ratio = face_area / max(img_area, 1)
                size_score = min(size_ratio * 10, 1.0)
                quality = round(float(0.7 * det_score + 0.3 * size_score), 2)

                face = Face(
                    photo_id=photo_id,
                    bbox_x=bbox_x,
                    bbox_y=bbox_y,
                    bbox_width=bbox_w,
                    bbox_height=bbox_h,
                    embedding=embedding_list,
                    detection_confidence=round(det_score, 2),
                    face_quality_score=quality
                )
                self.db.add(face)
                created_faces.append(face)

            photo.face_detection_status = "completed"
            photo.faces_detected_at = datetime.now(timezone.utc)
            self.db.commit()

            logger.info(f"Detected {len(created_faces)} faces in photo {photo_id}")

            # Auto-match a persone note (non bloccante)
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

        except FileNotFoundError:
            logger.warning(f"Face detection skipped for photo {photo_id}: file not found at {image_path}")
            photo.face_detection_status = "skipped"
            self.db.commit()
            return []
        except Exception as e:
            logger.error(f"Face detection failed for photo {photo_id}: {e}")
            logger.error(f"Traceback completo:\n{traceback.format_exc()}")
            photo.face_detection_status = "failed"
            self.db.commit()
            raise

    def _preprocess_image_bgr(
        self,
        image_path: str,
        max_long_side: int = 2048
    ) -> Tuple[np.ndarray, float]:
        """
        Preprocessa immagine per InsightFace: EXIF transpose, resize, RGB→BGR.

        Args:
            image_path: Path assoluto al file immagine
            max_long_side: Dimensione massima del lato lungo

        Returns:
            (img_bgr, scale_factor) - immagine BGR numpy array e fattore scala
        """
        img = Image.open(image_path)

        # Correggi orientamento EXIF (foto da cellulare ruotate)
        img = ImageOps.exif_transpose(img)

        # Converti in RGB (rimuove alpha channel, gestisce grayscale)
        img = img.convert("RGB")

        # Ridimensiona se troppo grande
        w, h = img.size
        long_side = max(w, h)
        if long_side > max_long_side:
            scale_factor = max_long_side / long_side
            new_w = int(w * scale_factor)
            new_h = int(h * scale_factor)
            img = img.resize((new_w, new_h), Image.LANCZOS)
        else:
            scale_factor = 1.0

        # Converti RGB → BGR per InsightFace (usa OpenCV internamente)
        img_rgb = np.array(img)
        img_bgr = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2BGR)

        return img_bgr, scale_factor

    # ========================================================================
    # Matching (cosine distance)
    # ========================================================================

    def _match_to_known_persons(
        self,
        face: Face,
        user_id: UUID,
        max_distance: float = MATCH_THRESH
    ):
        """
        Per un nuovo volto, cerca se esiste già una persona nota con embedding simile.
        Usa cosine distance (pgvector <=>) con soglia 0.4.
        Restituisce (person_id, confidence) oppure None.
        """
        if face.embedding is None:
            return None

        # Converti embedding in lista Python
        emb = face.embedding
        if hasattr(emb, 'tolist'):
            emb = emb.tolist()

        query = text("""
            SELECT f.person_id,
                   (f.embedding <=> :embedding::vector) AS distance
            FROM faces f
            JOIN photos ph ON f.photo_id = ph.id
            WHERE f.person_id IS NOT NULL
              AND f.deleted_at IS NULL
              AND f.id != :face_id
              AND f.embedding IS NOT NULL
              AND ph.user_id = :user_id
              AND (f.embedding <=> :embedding::vector) <= :max_distance
            ORDER BY f.embedding <=> :embedding::vector
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
            # Converti cosine distance in confidenza: 0.0 dist → 1.0, threshold dist → 0.0
            confidence = max(0.0, 1.0 - (float(result.distance) / max_distance))
            return (result.person_id, confidence)
        return None

    def _auto_assign_similar_faces(
        self,
        labeled_face: Face,
        person_id: UUID,
        user_id: UUID,
        max_distance: float = MATCH_THRESH
    ) -> int:
        """
        Auto-assegna la stessa persona a volti simili non etichettati.
        Usa cosine distance <= 0.4.

        Args:
            labeled_face: Volto appena etichettato (riferimento)
            person_id: ID persona da assegnare
            user_id: ID utente
            max_distance: Soglia cosine distance massima

        Returns:
            Numero di volti auto-assegnati
        """
        if labeled_face.embedding is None:
            return 0

        emb = labeled_face.embedding
        if hasattr(emb, 'tolist'):
            emb = emb.tolist()

        query = text("""
            SELECT f.id,
                   (f.embedding <=> :embedding::vector) AS distance
            FROM faces f
            JOIN photos ph ON f.photo_id = ph.id
            WHERE f.person_id IS NULL
              AND f.deleted_at IS NULL
              AND f.id != :face_id
              AND f.embedding IS NOT NULL
              AND ph.user_id = :user_id
              AND (f.embedding <=> :embedding::vector) <= :max_distance
            ORDER BY f.embedding <=> :embedding::vector
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
            self.db.execute(
                text("UPDATE persons SET photo_count = :count WHERE id = :pid"),
                {"count": photo_count, "pid": str(person_id)}
            )
            self.db.commit()

        return assigned_count

    # ========================================================================
    # Clustering (DBSCAN cosine)
    # ========================================================================

    def _auto_cluster_faces(self, user_id: UUID, eps: float = CLUSTER_THRESH, min_samples: int = 2):
        """
        Esegue clustering DBSCAN con metrica cosine sui volti non etichettati.

        Args:
            user_id: ID utente
            eps: DBSCAN epsilon (cosine distance threshold)
            min_samples: Minimo volti per cluster
        """
        unlabeled_faces = self.db.query(Face).join(Photo).filter(
            Photo.user_id == user_id,
            Face.person_id.is_(None),
            Face.deleted_at.is_(None)
        ).all()

        if len(unlabeled_faces) < min_samples:
            logger.info(f"Not enough unlabeled faces for clustering (found {len(unlabeled_faces)})")
            return

        # Extract embeddings (skip volti manuali senza embedding)
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

        # DBSCAN clustering con metrica cosine (nativa InsightFace)
        clustering = DBSCAN(eps=eps, min_samples=min_samples, metric='cosine')
        labels = clustering.fit_predict(embeddings)

        # Assign cluster IDs
        for idx, (face, cluster_id) in enumerate(zip(valid_faces, labels)):
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
        logger.info(f"Clustered {len(valid_faces)} faces into {n_clusters} clusters")

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
        """
        face = self.db.query(Face).filter(Face.id == face_id).first()
        if not face:
            raise ValueError(f"Face {face_id} not found")

        if person_id:
            person = self.db.query(Person).filter(Person.id == person_id).first()
            if not person:
                raise ValueError(f"Person {person_id} not found")
        elif person_name:
            photo = self.db.query(Photo).filter(Photo.id == face.photo_id).first()
            person = Person(
                user_id=photo.user_id,
                name=person_name,
                first_seen_at=photo.uploaded_at
            )
            self.db.add(person)
            self.db.flush()
        else:
            raise ValueError("Either person_id or person_name must be provided")

        old_person_id = face.person_id
        face.person_id = person.id
        face.cluster_id = None

        label = FaceLabel(
            face_id=face_id,
            person_id=person.id,
            labeled_by_user_id=user_id,
            label_type=label_type,
            confidence=1.00 if label_type == "manual" else 0.80
        )
        self.db.add(label)

        if not person.representative_face_id or (
            face.face_quality_score and
            face.face_quality_score > 0.7
        ):
            person.representative_face_id = face_id

        self.db.commit()
        self.db.refresh(face)
        self.db.refresh(person)

        person_id_val = person.id
        user_id_val = person.user_id
        person_name_val = person.name

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

        try:
            self.db.refresh(face)
        except Exception:
            pass

        logger.info(f"Labeled face {face_id} as person {person_id_val} ({person_name_val})")
        return face

    # ========================================================================
    # Similarity Search (cosine distance)
    # ========================================================================

    def suggest_similar_faces(
        self,
        face_id: UUID,
        threshold: float = MATCH_THRESH,
        limit: int = 10
    ) -> List[Dict[str, Any]]:
        """
        Trova volti simili usando pgvector cosine distance search.

        Args:
            face_id: ID volto di riferimento
            threshold: Cosine distance massima (0.4 = same person per InsightFace)
            limit: Numero massimo risultati
        """
        face = self.db.query(Face).filter(Face.id == face_id).first()
        if not face:
            raise ValueError(f"Face {face_id} not found")

        if face.embedding is None:
            return []

        emb = face.embedding
        if hasattr(emb, 'tolist'):
            emb = emb.tolist()

        query = text("""
            SELECT
                f.id,
                f.person_id,
                p.name as person_name,
                (f.embedding <=> :embedding::vector) as distance
            FROM faces f
            LEFT JOIN persons p ON f.person_id = p.id
            WHERE f.id != :face_id
              AND f.deleted_at IS NULL
              AND f.embedding IS NOT NULL
              AND (f.embedding <=> :embedding::vector) <= :threshold
            ORDER BY f.embedding <=> :embedding::vector
            LIMIT :limit
        """)

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

    def get_person_photos(self, person_id: UUID, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Ottiene tutte le foto contenenti una persona specifica.
        """
        results = self.db.query(
            Photo.id,
            Photo.uploaded_at,
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
                "face_bbox": {
                    "x": r.bbox_x,
                    "y": r.bbox_y,
                    "width": r.bbox_width,
                    "height": r.bbox_height
                }
            }
            for r in results
        ]

    def get_clusters(self, user_id: UUID) -> List[Dict[str, Any]]:
        """
        Ottiene tutti i cluster di volti non etichettati per un utente.
        """
        faces = self.db.query(Face).join(Photo).filter(
            Photo.user_id == user_id,
            Face.person_id.is_(None),
            Face.cluster_id.isnot(None),
            Face.deleted_at.is_(None)
        ).all()

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

            if face.face_quality_score and face.face_quality_score > clusters[cluster_id]["best_quality"]:
                clusters[cluster_id]["representative_face"] = str(face.id)
                clusters[cluster_id]["best_quality"] = face.face_quality_score

        return list(clusters.values())
