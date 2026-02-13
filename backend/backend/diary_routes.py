"""
Diary API - Timeline persona con capitoli e generazione storie con Ollama
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from sqlalchemy import text
from uuid import UUID
from datetime import datetime
from typing import List, Dict, Optional
import httpx

from database import get_db
from models import Person, User

router = APIRouter(prefix="/api/diary", tags=["Diary"])

# Dependency injection placeholder (set in main.py)
get_current_user_dependency = None

# Gap minimo (giorni) per separare capitoli
CHAPTER_GAP_DAYS = 3


def get_current_user_wrapper(
    token: str = Depends(OAuth2PasswordBearer(tokenUrl="/api/auth/login")),
    db: Session = Depends(get_db)
) -> User:
    """Wrapper to call get_current_user_dependency at runtime"""
    if get_current_user_dependency is None:
        raise HTTPException(status_code=500, detail="Authentication not initialized")
    return get_current_user_dependency(token=token, db=db)


def _build_chapters(photos_with_analysis: List[Dict]) -> List[Dict]:
    """
    Raggruppa foto in capitoli basandosi su gap temporali > CHAPTER_GAP_DAYS.
    Ogni capitolo ha titolo automatico da location + date range.
    """
    if not photos_with_analysis:
        return []

    chapters = []
    current_chapter_photos = [photos_with_analysis[0]]

    for i in range(1, len(photos_with_analysis)):
        prev_date = photos_with_analysis[i - 1]["taken_at"]
        curr_date = photos_with_analysis[i]["taken_at"]

        gap = (curr_date - prev_date).days if curr_date and prev_date else 0

        if abs(gap) > CHAPTER_GAP_DAYS:
            chapters.append(_finalize_chapter(current_chapter_photos, len(chapters) + 1))
            current_chapter_photos = [photos_with_analysis[i]]
        else:
            current_chapter_photos.append(photos_with_analysis[i])

    # Ultimo capitolo
    if current_chapter_photos:
        chapters.append(_finalize_chapter(current_chapter_photos, len(chapters) + 1))

    return chapters


def _finalize_chapter(photos: List[Dict], chapter_num: int) -> Dict:
    """Crea un capitolo con titolo automatico da location + date range."""
    dates = [p["taken_at"] for p in photos if p["taken_at"]]
    locations = list({p["location_name"] for p in photos if p.get("location_name")})

    date_from = min(dates) if dates else None
    date_to = max(dates) if dates else None

    # Titolo automatico
    location_str = ", ".join(locations[:2]) if locations else "Luoghi vari"
    if date_from and date_to:
        if date_from.date() == date_to.date():
            date_str = date_from.strftime("%d/%m/%Y")
        else:
            date_str = f"{date_from.strftime('%d/%m/%Y')} - {date_to.strftime('%d/%m/%Y')}"
    elif date_from:
        date_str = date_from.strftime("%d/%m/%Y")
    else:
        date_str = "Data sconosciuta"

    title = f"{location_str} ({date_str})"

    return {
        "chapter_num": chapter_num,
        "title": title,
        "date_from": date_from.isoformat() if date_from else None,
        "date_to": date_to.isoformat() if date_to else None,
        "locations": locations,
        "photo_count": len(photos),
        "photos": [
            {
                "id": str(p["id"]),
                "taken_at": p["taken_at"].isoformat() if p["taken_at"] else None,
                "location_name": p.get("location_name"),
                "description_short": p.get("description_short"),
                "description_full": p.get("description_full"),
                "tags": p.get("tags", []),
            }
            for p in photos
        ],
    }


@router.get("/person/{person_id}")
async def get_person_diary(
    person_id: UUID,
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """
    Timeline di una persona: foto ordinate per data, raggruppate in capitoli.
    Gap > 3 giorni separa i capitoli. Titolo automatico da location + date.
    """
    # Verifica che la persona esista e appartenga all'utente
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.user_id == current_user.id,
    ).first()
    if not person:
        raise HTTPException(status_code=404, detail="Persona non trovata")

    # Query: foto della persona ordinate per taken_at
    results = db.execute(
        text("""
            SELECT DISTINCT ON (p.id)
                p.id,
                p.taken_at,
                p.location_name,
                pa.description_short,
                pa.description_full,
                pa.tags
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            LEFT JOIN photo_analysis pa ON pa.photo_id = p.id
            WHERE f.person_id = :person_id
              AND f.deleted_at IS NULL
              AND p.deleted_at IS NULL
            ORDER BY p.id, p.taken_at ASC
        """),
        {"person_id": str(person_id)},
    ).fetchall()

    # Riordina per taken_at dopo DISTINCT ON
    photos_data = []
    for row in results:
        photos_data.append({
            "id": row[0],
            "taken_at": row[1],
            "location_name": row[2],
            "description_short": row[3],
            "description_full": row[4],
            "tags": row[5] or [],
        })
    photos_data.sort(key=lambda p: p["taken_at"] or datetime.min)

    chapters = _build_chapters(photos_data)

    return {
        "person": {
            "id": str(person.id),
            "name": person.name or "Sconosciuto",
            "photo_count": person.photo_count or 0,
            "first_seen_at": person.first_seen_at.isoformat() if person.first_seen_at else None,
            "last_seen_at": person.last_seen_at.isoformat() if person.last_seen_at else None,
        },
        "total_photos": len(photos_data),
        "total_chapters": len(chapters),
        "chapters": chapters,
    }


@router.post("/person/{person_id}/story")
async def generate_person_story(
    person_id: UUID,
    model: str = Query(default=None, description="Modello Ollama (text) per generazione storia"),
    current_user: User = Depends(get_current_user_wrapper),
    db: Session = Depends(get_db),
):
    """
    Genera una storia narrativa della persona usando Ollama (text model).
    Usa i capitoli della timeline come contesto.
    """
    # Verifica persona
    person = db.query(Person).filter(
        Person.id == person_id,
        Person.user_id == current_user.id,
    ).first()
    if not person:
        raise HTTPException(status_code=404, detail="Persona non trovata")

    # Recupera foto con descrizioni
    results = db.execute(
        text("""
            SELECT DISTINCT ON (p.id)
                p.taken_at,
                p.location_name,
                pa.description_short,
                pa.description_full
            FROM faces f
            JOIN photos p ON f.photo_id = p.id
            LEFT JOIN photo_analysis pa ON pa.photo_id = p.id
            WHERE f.person_id = :person_id
              AND f.deleted_at IS NULL
              AND p.deleted_at IS NULL
            ORDER BY p.id, p.taken_at ASC
        """),
        {"person_id": str(person_id)},
    ).fetchall()

    if not results:
        raise HTTPException(status_code=404, detail="Nessuna foto trovata per questa persona")

    # Riordina per data
    sorted_results = sorted(results, key=lambda r: r[0] or datetime.min)

    # Costruisci contesto per Ollama
    person_name = person.name or "questa persona"
    photo_descriptions = []
    for row in sorted_results:
        taken_at, location, desc_short, desc_full = row
        date_str = taken_at.strftime("%d/%m/%Y") if taken_at else "data sconosciuta"
        loc_str = f" a {location}" if location else ""
        desc = desc_short or (desc_full[:200] if desc_full else "foto senza descrizione")
        photo_descriptions.append(f"- {date_str}{loc_str}: {desc}")

    photo_context = "\n".join(photo_descriptions)

    prompt = f"""Scrivi una breve storia narrativa in italiano su {person_name}, basandoti sulle seguenti foto in ordine cronologico.
La storia deve essere personale, evocativa e in terza persona. Non elencare le foto, scrivi un racconto fluido.

Foto di {person_name}:
{photo_context}

Scrivi la storia (3-5 paragrafi):"""

    # Ollama locale o remoto in base a preferenza utente
    ollama_url = "http://ollama:11434"
    ollama_model = model or getattr(current_user, 'text_model', None) or "llama3.2:latest"

    if getattr(current_user, 'text_use_remote', False) and current_user.remote_ollama_url:
        ollama_url = current_user.remote_ollama_url

    # Chiama Ollama per generare la storia
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            payload = {
                "model": ollama_model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": 0.8,
                    "top_p": 0.9,
                },
            }

            response = await client.post(
                f"{ollama_url}/api/generate",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            story = data.get("response", "").strip()

            if not story:
                raise HTTPException(status_code=500, detail="Ollama non ha generato una storia")

            return {
                "person_name": person_name,
                "story": story,
                "model": ollama_model,
                "photo_count": len(sorted_results),
            }

    except httpx.HTTPError as e:
        raise HTTPException(
            status_code=503,
            detail=f"Errore comunicazione con Ollama: {str(e)}"
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Errore generazione storia: {str(e)}"
        )
