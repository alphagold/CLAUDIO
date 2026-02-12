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
cd ../frontend && npm install && npm run build
# Attendi ~60 secondi, poi login: test@example.com / test123

# Aggiornamento codice (solo backend)
cd CLAUDIO && git pull origin main
cd backend && docker compose -f docker-compose.yml up -d --build api

# Aggiornamento codice (solo frontend)
cd CLAUDIO && git pull origin main
cd frontend && npm install && npm run build

# Aggiornamento completo (backend + frontend)
cd CLAUDIO && git pull origin main
cd backend && docker compose -f docker-compose.yml up -d --build api
cd ../frontend && npm install && npm run build
```

Il DB si auto-inizializza da `backend/init-complete.sql` solo al primo avvio (volume vuoto).
Per migration manuali su DB esistente usare:
```bash
docker exec -it photomemory-postgres psql -U photomemory -d photomemory -c "SQL_QUERY_HERE;"
```

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
2. Trigger analisi → Ollama API (locale o remoto)
3. Risposta → parsing strutturato (sezioni MAIUSCOLE) con fallback naturale
4. Salva in `photo_analysis` (PostgreSQL)
5. Genera embedding pgvector per ricerca semantica

### Autenticazione
- JWT in localStorage, header `Authorization: Bearer <token>`
- Admin: `is_admin=True` nel DB

### Prompt AI
- Configurabili via UI: Admin → Configurazione Prompt
- Template default: `structured_detailed` (sezioni MAIUSCOLE)
- Variabili supportate: `{location_hint}`, `{model}`
- Fallback hardcoded se DB non disponibile

### Face Recognition
- **ATTIVA** con `dlib-bin` (wheel pre-compilato, no sorgente)
- `face_recognition_models` installato da GitHub (PyPI omette file .dat)
- `pkg_resources` patchato post-install (setuptools rimosso da pip)
- Al boot: foto con `face_detection_status=pending/processing` vengono accodate automaticamente
- Consenso GDPR richiesto (tabella `face_recognition_consent`)
- Routes `/api/faces/*` registrate solo se `FACE_RECOGNITION_AVAILABLE=True`
- Graceful degradation: `except (Exception, SystemExit)` cattura anche `quit()` di face_recognition

### qwen3-vl
- Usa `think: False` nel payload `/api/generate` per disabilitare reasoning mode
- Senza di esso: `response: ""` + campo `thinking` in inglese (ignorato dal parser)

---

## Regole per Claude

### SEMPRE
- Comunicare in **italiano**
- Commit message in italiano, senza emoji
- **Push su GitHub dopo ogni commit**
- Includere `Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>` nei commit
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
| `frontend/src/components/FaceOverlay.tsx` | Bounding box volti su foto |
| `frontend/src/pages/GalleryPage.tsx` | Gallery principale |
| `frontend/src/pages/SettingsPage.tsx` | Settings utente + server remoto |
| `frontend/src/pages/PromptConfigurationPage.tsx` | Config prompt AI |

---

### Note Deploy
- **Frontend NON è containerizzato**: gira direttamente sul server, servito da Vite (dev) o build statica
- Dopo modifiche a **solo codice Python** (no Dockerfile): `up -d --build api` è sufficiente
- Dopo modifiche a **solo frontend**: `cd frontend && npm install && npm run build`
- Dopo modifiche a **entrambi**: rebuild api + rebuild frontend
- Se il container usa layer cached vecchi: `build --no-cache api` poi `up -d api`
- `restart api` NON ricarica codice (usa immagine esistente)

---

**Aggiornato**: 2026-02-12 | **Stato**: Production-ready
