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
  - `qwen2-vl:latest` (4 GB) - multilingua avanzato, ~1 minuto
  - `llava:latest` (4.5 GB) - versatile e preciso, ~45 secondi
- **Modello Qualità**: `llama3.2-vision` (7.9 GB) - massima qualità, ~10 minuti, richiede 10.9 GB RAM

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
2. Trigger analisi → Ollama API
3. Ollama genera descrizione testuale
4. Salva descrizione nel DB PostgreSQL
5. Genera embedding vettoriale (pgvector) per ricerca semantica

### Progress Download Ollama
- **Tecnica**: Server-Sent Events (SSE)
- **Backend**: `StreamingResponse` con `media_type="text/event-stream"`
- **Frontend**: `EventSource` API per ricevere eventi
- **Formato dati**: JSON newline-delimited da Ollama API

### Database Schema
- **users**: Utenti con email, password (hashed), is_admin
- **photos**: Metadata foto (user_id, path, upload_date, analisi_status)
- **photo_analysis**: Risultati analisi AI (photo_id, description, model_used, embedding vector)
- **pgvector**: Extension per similarity search sugli embeddings

---

## Note per Claude

### Cosa Fare Sempre
✅ Leggere questo file all'inizio di ogni sessione complessa
✅ Fare push su GitHub dopo ogni commit
✅ Controllare che Docker Desktop sia in esecuzione prima di restart container
✅ Usare `moondream` per test AI veloci (più leggero)
✅ Preferire Edit su file esistenti invece di creare nuovi file
✅ Commit message in italiano senza emoji

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

**Ultimo aggiornamento**: 2026-01-24
**Versione Claude Code**: Sonnet 4.5
**Stato Progetto**: In sviluppo attivo
