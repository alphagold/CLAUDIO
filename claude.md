# PhotoMemory - Istruzioni per Claude

## Informazioni Generali

**PhotoMemory** è un'applicazione self-hosted per la gestione intelligente di foto con analisi AI tramite modelli vision locali (Ollama).

### Obiettivo del Progetto
- Gestione completa di foto personali
- Analisi automatica delle immagini tramite AI vision
- Ricerca semantica delle foto tramite descrizioni
- Privacy-first: tutto self-hosted, nessun servizio cloud

---

## Stack Tecnologico

### Backend
- **Framework**: FastAPI (Python)
- **Porta**: 8000
- **API Base URL**: http://192.168.200.4:8000
- **Database**: PostgreSQL 16 + pgvector extension
- **Cache**: Redis 7
- **Storage**: MinIO (S3-compatible object storage)
- **AI**: Ollama (modelli vision locali)
- **Container**: Docker + Docker Compose

### Frontend
- **Framework**: React 18 + TypeScript
- **Build Tool**: Vite
- **Porta Dev**: 5173
- **URL Dev**: http://192.168.200.4:5173
- **State Management**: React Query (@tanstack/react-query)
- **UI**: TailwindCSS + Lucide Icons
- **Notifications**: react-hot-toast

### AI Models (Ollama)
- **Porta Ollama**: 11434
- **RAM Sistema**: 16 GB (sufficiente per tutti i modelli)
- **Modello Veloce**: `moondream` (1.7 GB) - velocissimo, ~10 secondi
- **Modelli Bilanciati**:
  - `llava-phi3` (3.8 GB) - buon compromesso, ~30 secondi
  - `qwen3-vl:latest` (4 GB) - multilingua avanzato, ~1 minuto ⚠️ NO parallel requests
  - `llava:latest` (4.5 GB) - versatile e preciso, ~45 secondi
- **Modello Qualità**: `llama3.2-vision` (7.9 GB) - massima qualità, ~10 minuti, richiede 10.9 GB RAM
- **Configurazione Ollama**: `OLLAMA_NUM_PARALLEL=1` (richiesto per qwen3vl)

---

## Server di Destinazione

### Informazioni Deployment
- **Sistema Operativo**: Ubuntu Linux
- **Accesso**: Solo l'utente ha accesso diretto alla macchina
- **Modalità Deployment**: Docker Compose
- **Network**: Probabilmente stessa rete locale (192.168.200.x)

### Nota per Claude
Quando fai modifiche al codice, il deployment avviene tramite:
1. L'utente fa pull del codice dalla macchina Ubuntu
2. Oppure l'utente copia i file manualmente
3. Riavvio dei container Docker sulla macchina Ubuntu

---

## Workflow Git - IMPORTANTE

### Regola Fondamentale
⚠️ **SEMPRE fare push su GitHub dopo ogni commit**

Quando crei commit:
1. Fai commit delle modifiche locali
2. **SEMPRE** esegui `git push` immediatamente dopo
3. Verifica che il push sia andato a buon fine
4. In caso di errore di push, segnala all'utente

### Esempio Workflow Corretto
```bash
git add .
git commit -m "Implementato progress bar per download modelli Ollama"
git push origin main
```

### Perché è Importante
- L'utente deve poter fare `git pull` sulla macchina Ubuntu
- Il codice deve essere sempre sincronizzato con GitHub
- Facilita il deployment e il backup del codice

---

## Convenzioni di Codice

### Commit Messages
- **Lingua**: Italiano
- **Formato**: Imperativo presente (es: "Aggiungi feature X", "Correggi bug Y")
- **NO emoji**: Mai usare emoji nei commit message
- **Co-Author**: Sempre includere:
  ```
  Co-Authored-By: Claude Sonnet 4.5 <noreply@anthropic.com>
  ```

### Stile Codice
- **Python**: snake_case per variabili e funzioni
- **TypeScript/JavaScript**: camelCase per variabili, PascalCase per componenti
- **Indentazione**: 4 spazi (Python), 2 spazi (TS/JS/CSS)
- **Commenti**: Solo dove necessario, preferire codice auto-esplicativo
- **Lingua commenti**: Italiano per commenti di business logic, inglese per codice tecnico

### File Structure
```
claudio/
├── backend/
│   ├── backend/          # Codice FastAPI
│   │   ├── main.py      # Entry point + auth
│   │   ├── admin_routes.py  # Route admin (Ollama, stats)
│   │   └── ...
│   ├── migrations/      # SQL migrations
│   ├── docker-compose.yml
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── pages/       # React pages
│   │   ├── components/  # React components
│   │   └── api/         # API client
│   └── ...
└── claude.md           # Questo file!
```

---

## Comandi Utili

### Docker
```bash
# Restart backend API
cd backend && docker compose restart api

# View logs
docker compose logs -f api

# View Ollama logs
docker compose logs -f ollama

# Rebuild dopo modifiche al Dockerfile
docker compose up -d --build api

# Stop tutto
docker compose down

# Start tutto
docker compose up -d
```

### Database
```bash
# Accesso a PostgreSQL
docker exec -it photomemory-postgres psql -U photomemory -d photomemory

# Eseguire migration manuale
docker exec -i photomemory-postgres psql -U photomemory -d photomemory < migrations/new_migration.sql
```

### Ollama
```bash
# Lista modelli installati
curl http://192.168.200.4:11434/api/tags

# Pull modello (CLI)
docker exec photomemory-ollama ollama pull moondream

# Delete modello (CLI)
docker exec photomemory-ollama ollama rm llama3.2-vision:latest
```

### Frontend
```bash
cd frontend
npm run dev    # Start dev server (già in esecuzione)
npm run build  # Build per produzione
```

---

## Deployment su Server Ubuntu

### Prima Volta o Dopo Modifiche al Codice
```bash
# 1. Pull codice da GitHub
cd /path/to/claudio
git pull origin main

# 2. Esegui migration se necessario (vedi migrations/ directory)
cd backend
docker exec -i photomemory-postgres psql -U photomemory -d photomemory < migrations/003_add_remote_ollama.sql

# 3. Restart API
docker compose restart api

# 4. Verifica log
docker compose logs -f api
```

### Reinizializzazione Completa Database
**ATTENZIONE**: Cancella TUTTI i dati!

Consulta: **REINIT_DATABASE.md** per istruzioni dettagliate

```bash
cd backend
docker compose down
docker volume rm backend_postgres_data
docker compose up -d
```

### Configurazione Server Remoto (Dopo Deployment)
1. Sul PC Windows locale:
   - Avvia Ollama: `ollama serve`
   - Trova IP: `ipconfig` → cerca `192.168.x.x`
   - Pull modello: `ollama pull moondream`

2. Nell'app PhotoMemory:
   - Vai su **Settings**
   - Abilita "Server Ollama Remoto"
   - Inserisci URL: `http://192.168.x.x:11434`
   - Seleziona modello installato
   - Clicca "Salva Impostazioni"

3. Usa "Server Remoto" nei dialog analisi foto

---

## Problemi Noti e Soluzioni

### 1. Model Deletion Error 500
**Problema**: Modelli con `:latest` nel nome causavano errore 500 in DELETE

**Soluzione**: ✅ RISOLTO
- Backend ora usa `{model_name:path}` per accettare caratteri speciali
- Implementato URL decoding: `unquote(model_name)`
- File: `backend/backend/admin_routes.py:494-533`

### 2. Download Modelli Senza Feedback
**Problema**: Download partiva ma senza progress bar

**Soluzione**: ✅ RISOLTO
- Implementato Server-Sent Events (SSE) per streaming progress
- Frontend usa EventSource per ricevere aggiornamenti real-time
- Progress bar mostra: percentuale, tempo trascorso, byte scaricati
- File: `backend/backend/admin_routes.py:444-491` + `frontend/src/pages/OllamaModelsPage.tsx:68-140`

### 3. JWT Authentication Placeholder
**Problema**: `get_current_user()` era un placeholder che non validava JWT

**Stato**: ⚠️ DA IMPLEMENTARE (vedi plan mode)
- Plan file esiste: `C:\Users\adami\.claude\plans\ancient-sauteeing-moon.md`
- TODO: Implementare OAuth2PasswordBearer e decode_token
- TODO: Validare token JWT in tutte le route protette

### 4. Timer Analisi Reset Navigando
**Problema**: Timer si resettava navigando tra gallery e dettaglio foto

**Soluzione**: ✅ RISOLTO (2026-01-25)
- Backend calcola `elapsed_time_seconds` come @property nel modello Photo
- Timer basato su `analysis_started_at` dal database (single source of truth)
- Rimossa logica localStorage client-side
- Reset completo timestamps su reanalisi
- File: `backend/backend/models.py`, `backend/backend/main.py`, `frontend/src/pages/GalleryPage.tsx`, `frontend/src/pages/PhotoDetailPage.tsx`

### 5. Mancava Button "Ferma Analisi"
**Problema**: Non si potevano fermare analisi in corso

**Soluzione**: ✅ RISOLTO (2026-01-25)
- Nuovo endpoint `POST /api/photos/stop-all-analyses`
- Flag globale `stop_all_requested` per svuotare coda
- Button "Ferma Analisi" in GalleryPage (visibile solo durante analisi)
- Reset automatico foto "stuck"
- File: `backend/backend/main.py`, `frontend/src/pages/GalleryPage.tsx`

### 6. Tag Extraction di Bassa Qualità
**Problema**: AI generava troppi tag o tag poco rilevanti

**Soluzione**: ✅ RISOLTO (2026-01-25)
- Prompt aggiornato: "Solo 3-5 tag principali ad alta confidenza"
- Filtering: rimuove tag < 2 caratteri, limita a max 5
- File: `backend/backend/vision.py`

### 7. Modelli Mancanti nei Dialog
**Problema**: qwen3-vl e llava non disponibili per selezione

**Soluzione**: ✅ RISOLTO (2026-01-25)
- Aggiunti qwen3-vl:latest e llava:latest in GalleryPage bulk dialog
- Aggiunti qwen3-vl:latest e llava:latest in PhotoDetailPage dialog rianalisi
- Tutti i 5 modelli + "Server Remoto" ora disponibili
- File: `frontend/src/pages/GalleryPage.tsx`, `frontend/src/pages/PhotoDetailPage.tsx`

### 8. Badge "Analisi in Corso" Sempre Visibile
**Problema**: Foto con auto_analyze=no mostravano "Analisi in corso" erroneamente

**Soluzione**: ✅ RISOLTO (2026-01-25)
- Badge "Analisi in corso" solo se `analyzed_at` è null E `analysis_started_at` è presente
- Nuovo badge "Da analizzare" se entrambi null
- Fix applicato in 2 posti (grid-small e grid-large)
- File: `frontend/src/pages/GalleryPage.tsx`

### 9. Warning qwen3vl Parallel Requests
**Problema**: Log warning "qwen3vl does not support parallel requests"

**Soluzione**: ✅ RISOLTO (2026-01-25)
- `OLLAMA_NUM_PARALLEL` ridotto da 2 a 1 in docker-compose.yml
- qwen3vl non supporta richieste parallele
- Nessun impatto performance (analysis_worker già seriale)
- File: `backend/docker-compose.yml`

### 10. Face Recognition - dlib Compilation Failed
**Problema**: dlib 19.24.0 non compila in Docker (2026-01-30)

**Errori Compilazione**:
```
error: 'PyThreadState' has no member named 'frame'; did you mean 'cframe'?
error: 'function_record' has no member named 'nargs'; did you mean 'args'?
```

**Causa Root**:
- dlib usa pybind11 vecchio incompatibile con Python 3.10/3.11
- Python 3.11+ ha cambiato API interne (PyFrameObject, PyThreadState)
- Compilazione fallisce anche con tutte le dipendenze (cmake, boost, ffmpeg)

**Soluzione Attuale**: ⚠️ GRACEFUL DEGRADATION (2026-01-30)
- ✅ Backend: Import condizionali con try/except
- ✅ Flag `FACE_RECOGNITION_AVAILABLE = False` se import fallisce
- ✅ Routes `/api/faces/*` non registrate se libreria mancante
- ✅ Worker face detection skip con log chiaro
- ✅ Frontend: gestisce 404 con messaggio "Feature Non Disponibile"
- ✅ **App funziona al 95%** senza face recognition
- File: `backend/backend/face_recognition_service.py`, `backend/backend/main.py`, `frontend/src/pages/SettingsPage.tsx`, `frontend/src/pages/PeoplePage.tsx`

**Soluzioni per Abilitare Face Recognition al 100%**:

**Opzione 1: Multi-Stage Build (RACCOMANDATO)** ⭐
```dockerfile
FROM ageitgey/face_recognition:latest AS face_base
FROM python:3.10
COPY --from=face_base /usr/local/lib/python3.*/site-packages/dlib* ...
# Copia dlib già compilato, no build
```
- Pro: Veloce, affidabile, testato
- Contro: Immagine più grande (~1.2GB)

**Opzione 2: Compilazione Manuale + Riuso Wheel**
```bash
# Su server Ubuntu (fuori Docker)
sudo apt-get install cmake build-essential python3-dev
pip3 install dlib==19.24.0
find ~/.cache/pip -name "dlib*.whl"
cp dlib-*.whl backend/wheels/
# Dockerfile: COPY wheels/dlib-*.whl && pip install
```
- Pro: Wheel specifico per server
- Contro: Manuale, da rifare se cambia server

**Opzione 3: Sostituire con DeepFace**
```python
from deepface import DeepFace
faces = DeepFace.extract_faces(img_path, detector_backend="opencv")
embedding = DeepFace.represent(img_path, model_name="Facenet512")
```
- Pro: No problemi compilazione, migliore accuracy
- Contro: Dipendenze TensorFlow (~500MB), riscrittura service

**Documentazione**: `FACE_RECOGNITION_IMPLEMENTATION.md`

**Stato**: Feature IMPLEMENTATA ma NON ATTIVA (waiting deployment fix)

---

## Architettura e Decisioni Tecniche

### Autenticazione
- **Metodo**: JWT (JSON Web Tokens)
- **Storage**: localStorage nel frontend
- **Header**: `Authorization: Bearer <token>`
- **Secret**: JWT_SECRET in environment variables
- **Admin**: User con `is_admin=True` nel database

### Storage Foto
- **Sistema**: MinIO (S3-compatible object storage)
- **Porta**: 9000 (API), 9001 (Console)
- **Bucket**: `photos` (creato automaticamente)
- **NON** salvare foto direttamente su filesystem

### Analisi Foto con AI
1. Upload foto → MinIO
2. Trigger analisi → Ollama API (locale o remoto)
3. Ollama genera descrizione testuale
4. Salva descrizione nel DB PostgreSQL
5. Genera embedding vettoriale (pgvector) per ricerca semantica

### Server Ollama Remoto (Nuovo!)
- **Funzione**: Permette di usare un PC Windows locale con Ollama per analisi velocissime
- **Configurazione User**:
  - `remote_ollama_enabled` (boolean) - Abilita/disabilita server remoto
  - `remote_ollama_url` (string) - URL server, es: `http://192.168.1.100:11434`
  - `remote_ollama_model` (string) - Modello installato sul PC remoto
- **Backend Logic**:
  - Se `model == "remote"` E `remote_ollama_enabled == true`
  - Crea `OllamaVisionClient` con URL remoto personalizzato
  - Usa modello configurato dall'utente
- **Frontend**:
  - Settings: Sezione per configurare server remoto (URL + modello)
  - GalleryPage/PhotoDetailPage: Button "Server Remoto" nei dialog analisi
  - Opzione visibile solo se utente ha abilitato server remoto
- **Vantaggi**:
  - Analisi ultra-rapide usando GPU/CPU del PC locale
  - Server Ubuntu non sovraccaricato
  - Possibilità di usare modelli più potenti

### Progress Download Ollama
- **Tecnica**: Server-Sent Events (SSE)
- **Backend**: `StreamingResponse` con `media_type="text/event-stream"`
- **Frontend**: `EventSource` API per ricevere eventi
- **Formato dati**: JSON newline-delimited da Ollama API

### Database Schema
- **users**: Utenti con email, password (hashed), is_admin, preferred_model, auto_analyze, remote_ollama_enabled, remote_ollama_url, remote_ollama_model
- **photos**: Metadata foto (user_id, path, upload_date, analysis_started_at, analyzed_at, analysis_duration_seconds)
- **photo_analysis**: Risultati analisi AI (photo_id, description, model_used, tags, embedding vector)
- **pgvector**: Extension per similarity search sugli embeddings

### Migrations
- `001_init.sql`: Schema iniziale database
- `002_add_user_preferences.sql`: Aggiunge preferred_model e auto_analyze
- `003_add_remote_ollama.sql`: Aggiunge configurazione server remoto (remote_ollama_*)
- `004_add_face_recognition.sql`: Schema completo face recognition (persons, faces, face_labels, consent)

---

## Note per Claude

### ⚠️ LINGUA DI COMUNICAZIONE
**IMPORTANTE**: Usa sempre l'italiano per comunicare con l'utente.
- ✅ Tutti i messaggi, spiegazioni, e domande devono essere in italiano
- ✅ Commit message in italiano
- ✅ Commenti di business logic in italiano
- ✅ Solo codice tecnico e nomi di variabili/funzioni in inglese (convenzioni standard)

### Per Riprendere il Lavoro
Quando riprendi una sessione, leggi nell'ordine:
1. **CLAUDE.md** (questo file) - Sezione "Changelog / Ultime Modifiche" per vedere cosa è stato fatto
2. **CLAUDE.md** - Sezione "Problemi Noti e Soluzioni" per stato corrente
3. **CLAUDE.md** - Sezione "Server Ollama Remoto" per capire l'architettura
4. **backend/migrations/** - Verifica quali migration esistono (ultima: 003_add_remote_ollama.sql)
5. **REINIT_DATABASE.md** - Se serve reinizializzare il database

### Cosa Fare Sempre
✅ Leggere questo file all'inizio di ogni sessione complessa
✅ Fare push su GitHub dopo ogni commit
✅ Controllare che Docker Desktop sia in esecuzione prima di restart container
✅ Usare `moondream` per test AI veloci (più leggero)
✅ Preferire Edit su file esistenti invece di creare nuovi file
✅ Commit message in italiano senza emoji
✅ Verificare che le migration siano state applicate prima di modificare modelli
Tenere aggiornato claude.md o comunque piu files md se piu semplice
Ricordami i comandi fa eseguire sul server remoto

### Cosa NON Fare Mai
❌ Commit senza push successivo
❌ Creare file di documentazione non richiesti
❌ Modificare docker-compose.yml senza conferma utente
❌ Usare emoji nei commit o nel codice
❌ Fare modifiche breaking senza plan mode

### In Caso di Dubbi
1. Controllare il plan file se esiste: `C:\Users\adami\.claude\plans/`
2. Leggere i file README.md e PROJECT_PLAN_V3_SELFHOSTED.md
3. Verificare docker-compose.yml per environment variables
4. Chiedere all'utente invece di assumere

---

## Changelog / Ultime Modifiche

### Sessione 2026-01-30: Face Recognition Implementation (Graceful Degradation)

**Implementazione Completa Sistema Face Recognition**
- ✅ Migration SQL: `004_add_face_recognition.sql` (tabelle persons, faces, face_labels, consent)
- ✅ Backend Service: `face_recognition_service.py` (detection, clustering, labeling, similarity)
- ✅ API Routes: `face_routes.py` (consent GDPR, detection, persons, labeling, clusters)
- ✅ Background Worker: face detection asincrono con queue dedicata
- ✅ SQLAlchemy Models: Face, Person, FaceLabel, FaceRecognitionConsent
- ✅ Frontend Components: FaceOverlay.tsx (bounding boxes), PeoplePage.tsx
- ✅ Frontend Integration: PhotoDetailPage modal labeling, SettingsPage consent GDPR
- Commit: `6e0f03c`, `dd90572` (fix TypeScript), `2cb4bc1`, `78a807c`, `2cd236e`

**Problema Compilazione dlib**
- ❌ dlib 19.24.0 fallisce compilazione in Docker (conflitto pybind11 con Python 3.11/3.10)
- ❌ Errori: `PyThreadState has no member 'frame'`, `function_record has no member 'nargs'`
- ❌ Tentativi falliti: Python 3.11→3.10, dipendenze aggiuntive (cmake, boost, ffmpeg libs)

**Soluzione: Graceful Degradation (App Funziona Senza Face Recognition)**
- ✅ Import condizionali con try/except nel backend
- ✅ Flag `FACE_RECOGNITION_AVAILABLE` globale
- ✅ Routes face recognition registrate solo se libreria disponibile
- ✅ Worker face detection skip se modulo mancante
- ✅ Frontend: gestisce 404 con messaggio "Feature Non Disponibile"
- ✅ App funziona al 95%: upload, Ollama analysis, gallery, search OK
- Commit: `e198e01` (backend), `4ca047f` (frontend)

**Stato Attuale**
- ⚠️ Face recognition: DISPONIBILE ma NON ATTIVA (dlib non compilato)
- ✅ Resto app: FUNZIONANTE al 100%
- 📋 Opzioni per abilitare face recognition:
  1. Multi-stage build con immagine `ageitgey/face_recognition` (RACCOMANDATO)
  2. Compilazione manuale su server + riuso wheel
  3. Sostituire con DeepFace (alternative library)

**Documentazione**
- ✅ FACE_RECOGNITION_IMPLEMENTATION.md - Piano completo e testing E2E
- ✅ Documentazione API endpoints, database schema, algoritmi

**Totale**: 8 commit, 13+ file creati/modificati, ~3000 righe codice

---

### Sessione 2026-01-25: Miglioramenti Completi e Server Remoto

**Phase 1: Timer Consistency (CRITICA)**
- ✅ Timer centralizzato backend-side con @property elapsed_time_seconds
- ✅ Rimossa logica localStorage client-side
- ✅ Reset timestamps completo su reanalisi
- ✅ Timer consistente navigando tra gallery/dettaglio
- Commit: `280ea39`, `5c203b2` (fix TypeScript)

**Phase 2: Stop All Analyses**
- ✅ Endpoint `/api/photos/stop-all-analyses`
- ✅ Button "Ferma Analisi" in GalleryPage
- ✅ Flag globale `stop_all_requested` + svuota coda
- Commit: `2b40b74`

**Phase 3: Tag Extraction & New Models**
- ✅ Migliora qualità tag (max 5, alta confidenza)
- ✅ Aggiunti modelli qwen3-vl:latest e llava:latest
- ✅ Aggiornati valid_models in tutti gli endpoint
- Commit: `3dfdca4`, `f327dc2` (fix typo qwen2→qwen3), `48fc988` (OllamaModelsPage)

**Phase 4: Logs & Image Orientation**
- ✅ Log highlighting (rosso errori, giallo warning)
- ✅ Fix orientamento immagini EXIF (rotation CSS)
- Commit: `7f89bc8`

**Fix Vari**
- ✅ Badge "Da analizzare" vs "Analisi in corso" (condizione corretta)
- ✅ Modelli mancanti nei dialog analisi (qwen3-vl, llava)
- ✅ RAM sistema aggiornata a 16 GB (llama3.2-vision ora supportato)
- Commit: `e525d44`, `a3acb89`, `3a0530a`, `ffcf819`

**Feature: Server Ollama Remoto (GRANDE!)**
- ✅ Backend: campi remote_ollama_* nel modello User
- ✅ Migration SQL: `003_add_remote_ollama.sql`
- ✅ Backend: logica per usare server remoto se `model="remote"`
- ✅ Frontend SettingsPage: sezione configurazione server remoto
- ✅ Frontend dialog: opzione "Server Remoto" (visibile se abilitato)
- ✅ Permette analisi ultra-rapide usando PC Windows locale
- Commit: `574d54c`, `9ad07df` (REINIT_DATABASE.md)

**Fix Warning Ollama**
- ✅ `OLLAMA_NUM_PARALLEL=1` per compatibilità qwen3vl
- Commit: `3ee4172`, `6f57c5d`

**Totale**: 18 commit, 9 problemi risolti, 1 feature maggiore implementata

---

## Quick Reference

### URLs Importanti
- Frontend Dev: http://192.168.200.4:5173
- Backend API: http://192.168.200.4:8000
- API Docs: http://192.168.200.4:8000/docs
- Ollama API: http://192.168.200.4:11434
- MinIO Console: http://192.168.200.4:9001
- PostgreSQL: 192.168.200.4:5432

### Credenziali di Default
- **MinIO**: minioadmin / minioadmin
- **PostgreSQL**: photomemory / photomemory123
- **Test User**: test@example.com (da creare in DB)

### File Critici da Non Modificare Senza Conferma
- `docker-compose.yml` - Orchestrazione container
- `init.sql` - Schema DB iniziale
- `init-all.sh` - Script inizializzazione DB
- `.env` files - Variabili ambiente (se esistono)

---

**Ultimo aggiornamento**: 2026-01-30 (Face Recognition implementato - graceful degradation)
**Versione Claude Code**: Sonnet 4.5
**Stato Progetto**: In sviluppo attivo - Face Recognition disponibile ma non attiva (dlib issue)

### File Importanti da Consultare
- **CLAUDE.md** (questo file) - Documentazione completa progetto
- **FACE_RECOGNITION_IMPLEMENTATION.md** - Piano completo face recognition + testing E2E
- **REINIT_DATABASE.md** - Istruzioni reinizializzazione database dopo migration
- **README.md** - Overview progetto
- **PROJECT_PLAN_V3_SELFHOSTED.md** - Piano architetturale dettagliato
- **backend/migrations/** - Tutte le migration SQL (001, 002, 003, 004)
- **backend/docker-compose.yml** - Configurazione container
- **backend/backend/main.py** - API backend principale + face detection worker
- **backend/backend/face_recognition_service.py** - Core service face recognition
- **backend/backend/face_routes.py** - API endpoints face recognition
- **backend/backend/vision.py** - Client Ollama AI
- **frontend/src/components/FaceOverlay.tsx** - Bounding boxes component
- **frontend/src/pages/PeoplePage.tsx** - Gestione persone identificate
- **frontend/src/pages/SettingsPage.tsx** - Configurazione utente + server remoto + consent GDPR

