# PhotoMemory - v1.0

Sistema self-hosted per la gestione intelligente di foto con AI, analisi automatica e geolocalizzazione.

## 🚀 Caratteristiche Principali

### Gestione Foto
- **Upload multiplo** con drag & drop
- **Analisi AI automatica** con Llama Vision (llama3.2-vision)
- **Estrazione EXIF completa** con supporto GPS
- **Generazione automatica descrizioni** brevi e dettagliate
- **Rilevamento oggetti, volti, scene e testi**
- **Tag automatici** per categorizzazione intelligente

### Geolocalizzazione
- **Estrazione coordinate GPS** da EXIF
- **Reverse geocoding automatico** (OpenStreetMap Nominatim)
- **Mappa interattiva** con Leaflet per ogni foto
- **Visualizzazione località e data** su mappa

### Ricerca e Organizzazione
- **Ricerca semantica** basata su contenuto AI
- **Filtri per tag dinamici** generati dall'AI
- **Multi-selezione e cancellazione bulk**
- **Ordinamento** per data, giorno, mese, anno
- **Visualizzazione relativa** tempo trascorso

### Interfaccia Utente
- **Galleria responsive** con grid adattivo
- **Dettaglio foto completo** con tutti i metadati
- **Editor metadati** (data, GPS, località)
- **Ri-analisi** con scelta modello AI
- **Dark mode ready** (preparato per future implementazioni)

### Amministrazione
- **Gestione utenti** con ruoli (admin, editor, viewer)
- **Monitoraggio sistema** con status container
- **Visualizzazione log** backend e Ollama
- **Statistiche** foto, analisi, spazio disco
- **Refresh manuale** per log e status

## 🛠️ Stack Tecnologico

### Backend
- **FastAPI** - Framework web Python asincrono
- **PostgreSQL** - Database relazionale
- **SQLAlchemy** - ORM Python
- **Ollama** - Server AI locale per Vision models
- **Pillow** - Elaborazione immagini e EXIF
- **httpx** - Client HTTP asincrono
- **Redis** - Caching e queue

### Frontend
- **React 19** con TypeScript
- **Vite** - Build tool veloce
- **TailwindCSS** - Styling utility-first
- **React Query** - Data fetching e caching
- **React Router** - Routing SPA
- **Leaflet** - Mappe interattive
- **Zustand** - State management
- **Lucide Icons** - Icone moderne

### Infrastruttura
- **Docker Compose** - Orchestrazione container
- **MinIO** - Object storage S3-compatible (opzionale)
- **Nginx** - Reverse proxy (configurazione separata)

## 📦 Installazione

### Requisiti
- Docker e Docker Compose
- Git
- Server Ubuntu (consigliato) o qualsiasi sistema Linux

### Setup

```bash
# 1. Clone repository
git clone https://github.com/alphagold/CLAUDIO.git
cd CLAUDIO

# 2. Configura backend
cd backend
cp .env.example .env
# Modifica .env con le tue configurazioni

# 3. Avvia i servizi
docker compose up -d

# 4. Verifica che tutto sia avviato
docker compose ps

# 5. Installa dipendenze frontend
cd ../frontend
npm install

# 6. Build frontend
npm run build

# 7. Accedi all'applicazione
# http://localhost:5173 (dev) o http://localhost:8000 (production)
```

### Prima Configurazione

1. **Crea primo utente admin** (esegui nel container backend):
```bash
docker compose exec api python -c "
from database import SessionLocal
from models import User
from passlib.context import CryptContext

db = SessionLocal()
pwd_context = CryptContext(schemes=['bcrypt'], deprecated='auto')

admin = User(
    email='admin@example.com',
    password_hash=pwd_context.hash('admin123'),
    full_name='Admin',
    role='admin',
    is_admin=True
)
db.add(admin)
db.commit()
print('Admin user created!')
"
```

2. **Accedi** con le credenziali create

3. **Carica le prime foto** e lascia che l'AI le analizzi automaticamente

## 🔧 Configurazione

### Variabili Ambiente Backend (.env)

```env
# Database
DATABASE_URL=postgresql://user:password@postgres:5432/photomemory

# Security
JWT_SECRET=your-secret-key-here
JWT_ALGORITHM=HS256
JWT_EXPIRATION=43200  # 30 giorni in minuti

# Ollama
OLLAMA_HOST=http://ollama:11434
DEFAULT_VISION_MODEL=llama3.2-vision

# App
APP_NAME=PhotoMemory
VERSION=1.0.0
UPLOAD_DIR=/app/uploads
```

### Variabili Ambiente Frontend

Crea `frontend/.env`:
```env
VITE_API_URL=http://your-server-ip:8000
```

## 🎯 Utilizzo

### Upload Foto
1. Vai alla **Galleria**
2. Clicca **"Carica Foto"** o trascina file
3. Seleziona una o più foto
4. Clicca **"Carica"**
5. L'analisi AI parte automaticamente in background

### Ricerca
1. Usa la **barra di ricerca** in galleria
2. Cerca per contenuto: "cibo italiano", "paesaggio montagna", ecc.
3. Oppure filtra per **tag** cliccando sui pill sotto la ricerca

### Multi-selezione
1. Clicca **"Seleziona"** nella galleria
2. Clicca sulle foto da selezionare
3. Usa **"Elimina"** per cancellazione bulk

### Visualizza Posizione
1. Apri una foto con GPS
2. Scorri in basso per vedere la **mappa interattiva**
3. Clicca sul marker per dettagli

### Gestione Utenti (Admin)
1. Vai su **Admin** > **Gestione Utenti**
2. Crea, modifica o elimina utenti
3. Assegna ruoli: admin, editor, viewer

## 🔐 Ruoli e Permessi

| Ruolo | Upload | Modifica | Elimina | Gestione Utenti | Visualizza Log |
|-------|--------|----------|---------|-----------------|----------------|
| **Admin** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Editor** | ✅ | ✅ | ✅ | ❌ | ❌ |
| **Viewer** | ❌ | ❌ | ❌ | ❌ | ❌ |

## 📊 API Endpoints

### Autenticazione
- `POST /api/auth/login` - Login utente
- `POST /api/auth/register` - Registrazione (se abilitata)
- `GET /api/auth/me` - Profilo utente corrente

### Foto
- `GET /api/photos` - Lista foto con filtri
- `POST /api/photos` - Upload foto
- `GET /api/photos/{id}` - Dettaglio foto
- `PATCH /api/photos/{id}` - Modifica metadati
- `DELETE /api/photos/{id}` - Elimina foto
- `POST /api/photos/{id}/reanalyze` - Ri-analizza con nuovo modello
- `GET /api/photos/tags/all` - Lista tutti i tag

### Admin
- `GET /api/admin/status` - Status sistema
- `GET /api/admin/logs/{service}` - Log servizi
- `GET /api/admin/users` - Lista utenti
- `POST /api/admin/users` - Crea utente
- `PATCH /api/admin/users/{id}` - Modifica utente
- `DELETE /api/admin/users/{id}` - Elimina utente

## 🐛 Troubleshooting

### Foto non viene analizzata
- Controlla log: `docker compose logs -f api`
- Verifica Ollama: `docker compose logs -f ollama`
- Controlla coda: `curl http://localhost:8000/api/photos/queue-status`

### GPS non viene estratto
- Verifica che la foto abbia dati GPS nei metadati EXIF
- Controlla log per errori di conversione
- Riprova upload se necessario

### Mappa non si carica
- Verifica connessione internet (serve per tile OpenStreetMap)
- Controlla console browser per errori JavaScript
- Ricarica la pagina

### Errore "Database connection failed"
- Verifica che PostgreSQL sia avviato: `docker compose ps`
- Controlla .env per DATABASE_URL corretta
- Riavvia servizi: `docker compose restart`

## 🤝 Contributi

Questo è un progetto self-hosted personale. Fork, modifiche e suggerimenti sono benvenuti!

## 📝 Changelog

### v1.0.0 (2026-01-23)
- ✨ Release iniziale
- 🗺️ Geolocalizzazione con mappe interattive
- 🤖 Analisi AI automatica con Llama Vision
- 🏷️ Tag dinamici e ricerca semantica
- 📱 Interfaccia responsive completa
- 👥 Sistema multi-utente con ruoli
- 🔍 Multi-selezione e bulk operations
- 📊 Pannello admin con monitoraggio

## 📄 Licenza

Progetto personale open source. Usa liberamente.

## 🙏 Ringraziamenti

- **Ollama** per il runtime AI locale
- **OpenStreetMap** per mappe e geocoding
- **Leaflet** per la visualizzazione mappe
- **FastAPI** per il framework backend
- **Claude** per il supporto allo sviluppo

---

**Sviluppato con ❤️ e AI**
