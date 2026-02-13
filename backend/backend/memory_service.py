"""
Memory Service - Motore semantico per Q&A, indicizzazione e direttive personali.

Gestisce:
- Indicizzazione semantica di foto, persone, luoghi, oggetti, testi, date
- Ricerca contestuale con Ollama (text model)
- Gestione direttive personali
- Feedback e apprendimento
"""
import logging
from typing import List, Dict, Any, Optional
from uuid import UUID
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from sqlalchemy import text, func
import httpx

from models import (
    MemoryIndex, MemoryConversation, MemoryDirective,
    Photo, PhotoAnalysis, Person, Face, User
)

logger = logging.getLogger(__name__)


class MemoryService:
    """Servizio memoria conversazionale per PhotoMemory"""

    def __init__(self, db: Session):
        self.db = db

    # ========================================================================
    # INDICIZZAZIONE
    # ========================================================================

    def reindex_all(self, user_id: UUID) -> Dict[str, int]:
        """
        Reindicizza tutto il contenuto dell'utente: foto, persone, luoghi, oggetti, testi.
        Cancella indice esistente e ricrea.
        """
        # Cancella indice esistente
        self.db.query(MemoryIndex).filter(MemoryIndex.user_id == user_id).delete()
        self.db.flush()

        counts = {"faces": 0, "places": 0, "objects": 0, "texts": 0, "descriptions": 0}

        # 1. Indicizza persone (volti)
        persons = self.db.query(Person).filter(Person.user_id == user_id).all()
        for person in persons:
            if person.name:
                content = f"Persona: {person.name}"
                if person.notes:
                    content += f". Note: {person.notes}"
                content += f". Presente in {person.photo_count or 0} foto."
                self._add_index_entry(user_id, "face", person.id, content)
                counts["faces"] += 1

        # 2. Indicizza foto con analisi
        results = self.db.execute(
            text("""
                SELECT p.id, p.location_name, p.taken_at,
                       pa.description_full, pa.description_short,
                       pa.extracted_text, pa.detected_objects, pa.tags,
                       pa.scene_category
                FROM photos p
                JOIN photo_analysis pa ON pa.photo_id = p.id
                WHERE p.user_id = :user_id AND p.deleted_at IS NULL
            """),
            {"user_id": str(user_id)},
        ).fetchall()

        for row in results:
            photo_id = row[0]
            location = row[1]
            taken_at = row[2]
            desc_full = row[3]
            desc_short = row[4]
            extracted_text = row[5]
            objects = row[6]
            tags = row[7]
            category = row[8]

            # Descrizione foto
            if desc_full or desc_short:
                desc = desc_short or (desc_full[:300] if desc_full else "")
                date_str = taken_at.strftime("%d/%m/%Y") if taken_at else ""
                loc_str = f" a {location}" if location else ""
                content = f"Foto del {date_str}{loc_str}: {desc}"
                if tags:
                    content += f". Tag: {', '.join(tags)}"
                self._add_index_entry(user_id, "description", photo_id, content)
                counts["descriptions"] += 1

            # Luoghi
            if location:
                date_str = taken_at.strftime("%d/%m/%Y") if taken_at else "data sconosciuta"
                content = f"Luogo: {location} (foto del {date_str})"
                if category:
                    content += f". Categoria: {category}"
                self._add_index_entry(user_id, "place", photo_id, content)
                counts["places"] += 1

            # Oggetti rilevati
            if objects:
                content = f"Oggetti: {', '.join(objects)}"
                if location:
                    content += f" a {location}"
                self._add_index_entry(user_id, "object", photo_id, content)
                counts["objects"] += 1

            # Testo estratto
            if extracted_text and extracted_text.strip():
                content = f"Testo in foto: \"{extracted_text.strip()[:500]}\""
                self._add_index_entry(user_id, "text", photo_id, content)
                counts["texts"] += 1

        self.db.commit()
        return counts

    def _add_index_entry(
        self, user_id: UUID, entity_type: str, entity_id: UUID, content: str,
        metadata: Optional[Dict] = None
    ):
        """Aggiunge una voce all'indice semantico."""
        entry = MemoryIndex(
            user_id=user_id,
            entity_type=entity_type,
            entity_id=entity_id,
            content=content,
            metadata=metadata,
        )
        self.db.add(entry)

    # ========================================================================
    # RICERCA E Q&A
    # ========================================================================

    def search_context(self, user_id: UUID, question: str, limit: int = 10) -> List[Dict]:
        """
        Cerca nel memory_index contenuti rilevanti per la domanda.
        Usa ricerca testuale (ILIKE) come fallback senza embeddings.
        """
        # Tokenizza la domanda in parole chiave (> 2 caratteri)
        keywords = [w.strip().lower() for w in question.split() if len(w.strip()) > 2]

        if not keywords:
            return []

        # Costruisci query OR con ILIKE per ogni keyword
        conditions = " OR ".join([f"LOWER(content) LIKE :kw{i}" for i in range(len(keywords))])
        params = {f"kw{i}": f"%{kw}%" for i, kw in enumerate(keywords)}
        params["user_id"] = str(user_id)
        params["limit"] = limit

        results = self.db.execute(
            text(f"""
                SELECT id, entity_type, entity_id, content, metadata
                FROM memory_index
                WHERE user_id = :user_id AND ({conditions})
                ORDER BY created_at DESC
                LIMIT :limit
            """),
            params,
        ).fetchall()

        return [
            {
                "id": str(row[0]),
                "entity_type": row[1],
                "entity_id": str(row[2]) if row[2] else None,
                "content": row[3],
                "metadata": row[4],
            }
            for row in results
        ]

    async def ask_with_context(
        self, user_id: UUID, question: str,
        ollama_url: str = "http://ollama:11434",
        model: str = "llama3.2:latest"
    ) -> Dict:
        """
        Risponde a una domanda cercando contesto nell'indice e usando Ollama.
        """
        # 1. Cerca contesto rilevante
        context_items = self.search_context(user_id, question, limit=15)

        # 2. Recupera direttive attive
        directives = self.db.query(MemoryDirective).filter(
            MemoryDirective.user_id == user_id,
            MemoryDirective.is_active == True,
        ).all()

        # 3. Costruisci prompt
        context_text = ""
        if context_items:
            context_text = "Informazioni disponibili nelle foto dell'utente:\n"
            for item in context_items:
                context_text += f"- [{item['entity_type']}] {item['content']}\n"

        directives_text = ""
        if directives:
            directives_text = "\nDirettive personali dell'utente:\n"
            for d in directives:
                directives_text += f"- {d.directive}\n"

        prompt = f"""Sei un assistente personale per una galleria fotografica. Rispondi in italiano.
{directives_text}
{context_text}
Domanda dell'utente: {question}

Rispondi basandoti sulle informazioni disponibili. Se non hai abbastanza informazioni, dillo chiaramente.
Rispondi in modo conciso e utile."""

        # 4. Chiama Ollama
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                payload = {
                    "model": model,
                    "prompt": prompt,
                    "stream": False,
                    "options": {"temperature": 0.3},
                }
                response = await client.post(f"{ollama_url}/api/generate", json=payload)
                response.raise_for_status()
                data = response.json()
                answer = data.get("response", "").strip()
        except Exception as e:
            logger.error(f"Ollama error: {e}")
            answer = f"Errore nella comunicazione con il modello AI: {str(e)}"

        # 5. Salva conversazione
        conversation = MemoryConversation(
            user_id=user_id,
            question=question,
            answer=answer,
            context={
                "items_found": len(context_items),
                "directives_used": len(directives),
                "model": model,
            },
        )
        self.db.add(conversation)
        self.db.commit()
        self.db.refresh(conversation)

        return {
            "answer": answer,
            "conversation_id": str(conversation.id),
            "context_items": len(context_items),
            "model": model,
        }

    # ========================================================================
    # FEEDBACK E APPRENDIMENTO
    # ========================================================================

    def learn_from_feedback(self, conversation_id: UUID, feedback: str) -> bool:
        """Salva feedback su una risposta (positive/negative/corrected)."""
        conversation = self.db.query(MemoryConversation).filter(
            MemoryConversation.id == conversation_id,
        ).first()
        if not conversation:
            return False

        conversation.feedback = feedback
        self.db.commit()
        return True

    # ========================================================================
    # DIRETTIVE
    # ========================================================================

    def get_directives(self, user_id: UUID, active_only: bool = True) -> List[Dict]:
        """Recupera direttive personali dell'utente."""
        query = self.db.query(MemoryDirective).filter(
            MemoryDirective.user_id == user_id,
        )
        if active_only:
            query = query.filter(MemoryDirective.is_active == True)

        directives = query.order_by(MemoryDirective.created_at.desc()).all()
        return [
            {
                "id": str(d.id),
                "directive": d.directive,
                "source": d.source,
                "confidence": float(d.confidence) if d.confidence else 1.0,
                "is_active": d.is_active,
                "created_at": d.created_at.isoformat() if d.created_at else None,
            }
            for d in directives
        ]

    def create_directive(self, user_id: UUID, directive: str, source: str = "manual") -> Dict:
        """Crea una nuova direttiva personale."""
        entry = MemoryDirective(
            user_id=user_id,
            directive=directive,
            source=source,
            confidence=1.00,
            is_active=True,
        )
        self.db.add(entry)
        self.db.commit()
        self.db.refresh(entry)

        return {
            "id": str(entry.id),
            "directive": entry.directive,
            "source": entry.source,
            "is_active": entry.is_active,
        }

    def update_directive(self, directive_id: UUID, user_id: UUID, **kwargs) -> Optional[Dict]:
        """Aggiorna una direttiva esistente."""
        directive = self.db.query(MemoryDirective).filter(
            MemoryDirective.id == directive_id,
            MemoryDirective.user_id == user_id,
        ).first()
        if not directive:
            return None

        for key, value in kwargs.items():
            if hasattr(directive, key) and value is not None:
                setattr(directive, key, value)

        directive.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(directive)

        return {
            "id": str(directive.id),
            "directive": directive.directive,
            "source": directive.source,
            "is_active": directive.is_active,
        }

    def delete_directive(self, directive_id: UUID, user_id: UUID) -> bool:
        """Elimina una direttiva."""
        directive = self.db.query(MemoryDirective).filter(
            MemoryDirective.id == directive_id,
            MemoryDirective.user_id == user_id,
        ).first()
        if not directive:
            return False

        self.db.delete(directive)
        self.db.commit()
        return True
