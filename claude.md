# PhotoMemory - Istruzioni per Claude

## Stack Tecnologico

- **Backend**: FastAPI (Python), porta 8000
- **Database**: PostgreSQL 16 + pgvector
- **Cache**: Redis 7
- **Storage**: MinIO (S3-compatible)
- **AI**: Ollama (vision models)
- **Frontend**: React 18 + TypeScript + Vite, porta 5173
- **UI**: TailwindCSS + Lucide Icons + react-hot-toast
- **State**: React Query (@tanstack/react-query)
- **Container**: Docker Compose

### Modelli Ollama
| Modello | RAM | Tempo | Note |
|---------|-----|-------|------|
| `moondream` | 1.7 GB | ~10s | Più veloce, usa per test |
| `llava-phi3` | 3.8 GB | ~30s | Bilanciato |
| `llava:latest` | 4.5 GB | ~45s | Versatile |
| `qwen3-vl:latest` | 4 GB | ~1min | Ottimo italiano, NO parallel |
| `llama3.2-vision` | 7.9 GB | ~10min | Massima qualità |

`OLLAMA_NUM_PARALLEL=1` richiesto per qwen3-vl.

---

## URLs e Credenziali

| Servizio | URL | Credenziali |
|----------|-----|-------------|
| Frontend | http://192.168.200.4:5173 | - |
| Backend API | http://192.168.200.4:8000 | - |
| API Docs | http://192.168.200.4:8000/docs | - |
| Ollama | http://192.168.200.4:11434 | - |
| MinIO Console | http://192.168.200.4:9001 | minioadmin / minioadmin |
| PostgreSQL | 192.168.200.4:5432 | photomemory / photomemory123 |
| App default user | - | test@example.com / test123 (is_admin=True) |

---

## Comandi Server Ubuntu

Tutti i comandi vanno eseguiti dalla directory `backend/` del server.

```bash
# Restart API
docker compose -f docker-compose.yml restart api

# Logs
docker compose -f docker-compose.yml logs -f api
docker compose -f docker-compose.yml logs -f ollama

# Rebuild API
docker compose -f docker-compose.yml up -d --build api

# Stop / Start
docker compose -f docker-compose.yml down
docker compose -f docker-compose.yml up -d --build

# Reset completo (CANCELLA TUTTI I DATI)
docker compose -f docker-compose.yml down -v
docker compose -f docker-compose.yml up -d --build

# Accesso PostgreSQL
docker exec -it photomemory-postgres psql -U photomemory -d photomemory

# Ollama: lista modelli
curl http://192.168.200.4:11434/api/tags
```

## Deploy / Aggiornamento

```bash
# Prima installazione
git clone https://github.com/alphagold/CLAUDIO.git
cd CLAUDIO/backend
docker compose -f docker-compose.yml up -d --build
# Attendi ~60 secondi, poi login: test@example.com / test123

# Aggiornamento codice
cd CLAUDIO && git pull origin main
cd backend
docker compose -f docker-compose.yml down
docker compose -f docker-compose.yml up -d --build
```

Il DB si auto-inizializza da `backend/init-complete.sql` solo al primo avvio (volume vuoto).

### Server Ollama Remoto (PC Windows)
```powershell
$env:OLLAMA_HOST = "0.0.0.0:11434"
$env:OLLAMA_ORIGINS = "*"
$env:OLLAMA_NUM_PARALLEL = "1"
ollama serve
```
Poi configurare nelle Settings dell'app: abilita server remoto, inserisci URL e modello.

---

## Architettura

### Flusso analisi foto
1. Upload foto → MinIO
2. Face detection (InsightFace) → salva volti in `faces`
3. Trigger analisi → Ollama API (locale o remoto), prompt in **inglese** con contesto volti/location
4. Risposta → parsing strutturato (sezioni MAIUSCOLE) con fallback naturale
5. Salva in `photo_analysis` (PostgreSQL)
6. Post-analisi automatica: riscrittura IT (text model), aggiornamento physical_description persone, generazione domande memoria
7. Se analisi fallisce → errore salvato in `photos.analysis_error`, visibile nel frontend

### Autenticazione
- JWT in localStorage, header `Authorization: Bearer <token>`
- Admin: `is_admin=True` nel DB

### Prompt AI
- Prompt vision in **inglese** (migliore qualità su tutti i modelli)
- Post-analisi: traduzione e riscrittura in italiano via text model (auto_rewrite_enabled)
- Configurabili via UI: Admin → Configurazione Prompt
- Template default: `structured_detailed` (sezioni MAIUSCOLE)
- Variabili supportate: `{location_hint}`, `{model}`, `{faces_context}`, `{faces_names}`, `{taken_at}`
- Fallback hardcoded se DB non disponibile
- **Rianalizza**: dialog 2-step (selezione modello dinamica → editing prompt) nel dettaglio foto
- Lista modelli caricata dinamicamente da Ollama locale + remoto (non più hardcoded)

### Face Recognition (InsightFace buffalo_l)
- **Motore**: InsightFace buffalo_l (ONNX Runtime CPU, 512-dim embeddings)
- **Metrica**: cosine distance (`<=>` pgvector), soglia match 0.6
- **Detection**: soglia 0.5, det_size 640x640, confidence reale da det_score
- **Clustering**: DBSCAN metric='cosine', eps=0.6
- **Modello**: ~300MB, scaricato al primo uso, persistito in volume Docker `insightface_models`
- **Singleton**: `get_insightface_app()` lazy init, env `INSIGHTFACE_MODEL=buffalo_l`
- Al boot: foto con `face_detection_status=pending/processing` vengono accodate automaticamente
- Consenso GDPR richiesto (tabella `face_recognition_consent`)
- Routes `/api/faces/*` registrate solo se `FACE_RECOGNITION_AVAILABLE=True`
- Graceful degradation: se InsightFace non disponibile, feature disabilitata
- **Volto manuale**: `POST /api/faces/manual/{photo_id}` aggiunge volto senza detection (embedding=NULL)
- `faces.embedding` è **nullable** vector(512) (volti manuali non hanno embedding)
- FaceOverlay ha `drawMode` per disegnare bbox manualmente (click-drag → rettangolo verde)
- Dopo labeling, `faceRefreshKey` incrementa per forzare refresh FaceOverlay senza reload pagina
- **Soft delete volto**: `DELETE /api/faces/{face_id}` imposta `deleted_at` (GDPR)

### Diary API
- `GET /api/diary/person/{person_id}` - Timeline persona con capitoli (gap > 3 giorni)
- `POST /api/diary/person/{person_id}/story` - Genera storia narrativa con Ollama (text model)
- Titoli automatici da location + date range
- Usa server Ollama locale o remoto (configurazione utente)

### Memory API (Memoria Conversazionale)
- **Tabelle**: `memory_index`, `memory_conversations`, `memory_directives`, `memory_questions`
- `POST /api/memory/ask` - Q&A con contesto (ricerca indice + Ollama)
- `POST /api/memory/learn` - Feedback su risposte (positive/negative/corrected)
- `POST /api/memory/reindex` - Reindicizza foto, persone, luoghi, oggetti, testi
- `GET/POST/PATCH/DELETE /api/memory/directives` - CRUD direttive personali
- **Memory Questions**: domande generate post-analisi per arricchire la memoria
  - `POST /api/memory/questions/generate/{photo_id}` - Genera domande per foto
  - `POST /api/memory/questions/{id}/answer` - Rispondi a domanda
  - Tab "Domande" nel dettaglio foto per rispondere inline
- Ricerca testuale ILIKE come fallback (embeddings semantici futuri)

### qwen3-vl
- Usa `think: False` nel payload `/api/generate` per disabilitare reasoning mode
- Senza di esso: `response: ""` + campo `thinking` in inglese (ignorato dal parser)

---

## Regole per Claude

### SEMPRE
- Comunicare in **italiano**
- Commit message in italiano, senza emoji
- **Push su GitHub dopo ogni commit**
- Includere `Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>` nei commit
- Quando si modifica `models.py`, aggiornare **anche** `backend/init-complete.sql`

### MAI
- Commit senza push
- Modificare `docker-compose.yml` senza conferma utente
- Creare file di documentazione non richiesti

### Schema DB
`backend/init-complete.sql` è la **singola fonte di verità** per lo schema.
Deve essere sempre allineato con `backend/backend/models.py`.

### Codice
- Python: snake_case | TypeScript: camelCase | Componenti: PascalCase
- Indentazione: 4 spazi Python, 2 spazi TS/JS

---

## File Critici

| File | Scopo |
|------|-------|
| `backend/init-complete.sql` | Schema DB completo (unica fonte di verità) |
| `backend/docker-compose.yml` | Orchestrazione container |
| `backend/backend/main.py` | Entry point FastAPI + auth + worker analisi |
| `backend/backend/models.py` | SQLAlchemy models |
| `backend/backend/vision.py` | Client Ollama AI + parsing |
| `backend/backend/admin_routes.py` | Route admin + prompt templates CRUD |
| `backend/backend/face_routes.py` | Route face recognition |
| `backend/backend/face_recognition_service.py` | Detection, clustering, labeling volti |
| `backend/backend/diary_routes.py` | API diario persona (timeline + storia) |
| `backend/backend/memory_routes.py` | API memoria conversazionale (Q&A, direttive) |
| `backend/backend/memory_service.py` | Servizio indicizzazione e ricerca semantica |
| `frontend/src/components/FaceOverlay.tsx` | Bounding box volti su foto + drawMode manuale |
| `frontend/src/pages/PhotoDetailPage.tsx` | Dettaglio foto, labeling volti, volto manuale |
| `frontend/src/pages/GalleryPage.tsx` | Gallery principale |
| `frontend/src/pages/SettingsPage.tsx` | Settings utente + server remoto |
| `frontend/src/pages/PromptConfigurationPage.tsx` | Config prompt AI |
| `frontend/src/api/client.ts` | API client Axios (auth, photos, faces, albums, diary, memory) |
| `frontend/src/types/index.ts` | TypeScript interfaces per tutti i tipi |

---

### Note Deploy
- Dopo modifiche a **solo codice Python** (no Dockerfile): `up -d --build api` è sufficiente
- Se il container usa layer cached vecchi: `build --no-cache api` poi `up -d api`
- `restart api` NON ricarica codice (usa immagine esistente)
- **Frontend non containerizzato**: gira direttamente sul server, rebuild con `cd frontend && npm install && npm run build`
- Dopo modifiche frontend: serve rebuild manuale (`npm run build`)
- Dopo modifiche schema DB su DB esistente: servono migration manuali (`ALTER TABLE ...`)

### Migrations pendenti
- **InsightFace migration**: `backend/migration-insightface.sql` (128→512 dim, L2→cosine, reset embeddings)
- **Memory tables**: `memory_index`, `memory_conversations`, `memory_directives` (nuove tabelle P4)
- **analysis_error**: `ALTER TABLE photos ADD COLUMN IF NOT EXISTS analysis_error TEXT;`

### Debug logging
- `[ANALYSIS]` — flusso analisi foto (start, remote/local, completion, failure)
- `[PROMPT-PREVIEW]` — anteprima prompt nel dialog rianalizza
- `[REANALYZE]` — rianalisi avviata (model, custom_prompt, queue_pos)
- `[TEXT_LLM]` — chiamate al text model (url, model, text_use_remote)
- `[REWRITE]` — riscrittura descrizione in background
- `[POST-ANALYSIS]` — errori post-analisi (rewrite, physical_description, domande)

### Stato funzionalità
| Feature | Stato | Note |
|---------|-------|------|
| Upload + analisi AI | Completa | Prompt EN, traduzione IT automatica |
| Rianalizza foto | Completa | Dialog 2-step, modelli dinamici, errore visibile |
| Face recognition | Completa | InsightFace buffalo_l, manuale + auto |
| Diario persona | Completa | Timeline + storia narrativa |
| Memoria Q&A | Completa | Ask, learn, directives, questions |
| Memory questions | Completa | Generazione post-analisi, tab nel dettaglio |
| Server Ollama remoto | Completa | Config in Settings, usato per vision + text |
| Riscrittura IT | Completa | Background, polling frontend, timeout 90s |

---

**Aggiornato**: 2026-02-20 | **Stato**: Production-ready
