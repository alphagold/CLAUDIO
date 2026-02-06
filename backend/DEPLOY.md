# PhotoMemory - Deploy in Produzione

## Deploy Automatico Completo

Il sistema è configurato per inizializzarsi **completamente in automatico** al primo avvio.

### Cosa viene inizializzato automaticamente

✅ **Database PostgreSQL**:
- Schema completo con pgvector extension
- Tutte le migrations (001, 002, 003, 004, 005 + fix)
- Prompt templates configurati
- Ottimizzazioni performance PostgreSQL

✅ **Utente di default**:
- Email: `test@example.com`
- Password: `test123`
- Preferred model: `moondream`
- Auto-analyze: attivo

✅ **Servizi**:
- FastAPI backend con health checks
- Redis cache con persistence
- MinIO object storage
- Ollama AI models server

---

## Comandi Deploy

### 1. Deploy Pulito (Prima Installazione)

```bash
# Clone repository
git clone https://github.com/alphagold/CLAUDIO.git
cd CLAUDIO/backend

# Start tutti i servizi
docker compose up -d --build

# Attendi 60 secondi per inizializzazione
sleep 60

# Verifica stato
docker compose ps
docker compose logs postgres | grep "✅"
docker compose logs api | grep "🚀"
```

### 2. Aggiornamento Sistema Esistente

```bash
cd CLAUDIO
git pull origin main

cd backend
docker compose down
docker compose up -d --build
```

### 3. Reset Completo Database (ATTENZIONE: Cancella Tutti i Dati)

```bash
cd backend

# Stop e cancella volumi
docker compose down -v

# Rebuild e restart (re-inizializza tutto)
docker compose up -d --build
```

---

## Verifica Deploy

### 1. Verifica Servizi Attivi

```bash
docker compose ps
```

Tutti i container devono essere `healthy` o `running`:
- ✅ photomemory-api (healthy)
- ✅ photomemory-postgres (healthy)
- ✅ photomemory-redis (healthy)
- ✅ photomemory-minio (running)
- ✅ photomemory-ollama (running)

### 2. Verifica Database Inizializzato

```bash
# Verifica tabelle create
docker exec photomemory-postgres psql -U photomemory -d photomemory -c "\dt"

# Verifica utente test
docker exec photomemory-postgres psql -U photomemory -d photomemory -c "SELECT email, is_admin FROM users;"

# Verifica prompt templates
docker exec photomemory-postgres psql -U photomemory -d photomemory -c "SELECT name, is_default FROM prompt_templates;"
```

### 3. Verifica API Backend

```bash
# Health check
curl http://localhost:8000/docs

# Dovrebbe restituire pagina HTML di Swagger
```

### 4. Test Login Frontend

1. Apri browser: `http://localhost:5173` (o IP server)
2. Login con: `test@example.com` / `test123`
3. Verifica caricamento Gallery

---

## Configurazione Produzione

### Variabili da Modificare per Produzione

Nel file `docker-compose.yml`, modifica:

```yaml
environment:
  # CRITICO: Cambia JWT secret in produzione!
  - JWT_SECRET=<genera-stringa-random-64-caratteri>

  # CRITICO: Cambia password database!
  - POSTGRES_PASSWORD=<password-sicura>

  # CRITICO: Cambia credenziali MinIO!
  - MINIO_ROOT_USER=<admin-user>
  - MINIO_ROOT_PASSWORD=<password-sicura>

  # Opzionale: URL pubblico MinIO
  - MINIO_BROWSER_REDIRECT_URL=https://tuodominio.com:9001
```

### Cambia Utente di Default

Modifica `backend/init-db.sh` righe 35-45:

```sql
INSERT INTO users (email, hashed_password, is_admin, preferred_model, auto_analyze)
VALUES (
    'admin@tuazienda.com',  -- ← Email personalizzata
    '$2b$12$...',            -- ← Hash password personalizzata (vedi sotto)
    true,                    -- ← true per admin
    'qwen3-vl-clean:latest',
    true
);
```

Per generare hash password:
```python
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
print(pwd_context.hash("tua-password-sicura"))
```

---

## Struttura File Deploy

```
backend/
├── docker-compose.yml        # Orchestrazione servizi
├── init-db.sh                # Init automatico database + utente
├── migrations/               # Migrations SQL (montate in postgres)
│   ├── 001_init.sql
│   ├── 002_add_user_preferences.sql
│   ├── 003_add_remote_ollama.sql
│   ├── 004_add_face_recognition.sql
│   ├── 005_add_prompt_templates.sql
│   └── 005_fix_prompt_template.sql
├── backend/
│   ├── Dockerfile            # Build FastAPI container
│   ├── init-migrations.sh    # Script avvio FastAPI (attende postgres)
│   ├── main.py               # FastAPI app
│   └── ...
└── DEPLOY.md                 # Questa guida
```

---

## Meccanismo di Inizializzazione

### Flow Startup

1. **docker compose up** avvia tutti i container
2. **PostgreSQL** esegue automaticamente `/docker-entrypoint-initdb.d/01-init-db.sh`
   - Legge tutte le migrations da `/docker-entrypoint-initdb.d/migrations/`
   - Crea schema completo database
   - Crea utente di default
   - Stampa verifica tabelle e utenti creati
3. **API container** attende che postgres sia pronto (health check)
4. **FastAPI** si avvia con `uvicorn`

### Idempotenza

- Lo script `init-db.sh` viene eseguito **solo alla prima creazione** del volume postgres
- Se il volume esiste già, PostgreSQL **NON riesegue** lo script
- Per forzare re-inizializzazione: `docker compose down -v`

---

## Troubleshooting

### Problema: Utente non creato

**Soluzione**: Ricrea volume postgres
```bash
docker compose down -v
docker compose up -d
```

### Problema: Migrations non applicate

**Verifica log postgres**:
```bash
docker compose logs postgres | grep "init-db"
```

Se lo script non è stato eseguito, il volume esisteva già. Ricrea.

### Problema: API non si avvia

**Verifica log API**:
```bash
docker compose logs api
```

Controlla:
- PostgreSQL è healthy? `docker compose ps`
- Database esiste? `docker exec photomemory-postgres psql -U photomemory -l`

### Problema: Login fallisce

**Verifica utente esistente**:
```bash
docker exec photomemory-postgres psql -U photomemory -d photomemory -c "SELECT email FROM users;"
```

Se vuoto, ricrea volume postgres.

---

## Backup e Restore

### Backup Database

```bash
# Backup completo
docker exec photomemory-postgres pg_dump -U photomemory photomemory > backup_$(date +%Y%m%d).sql

# Backup solo dati utenti e foto
docker exec photomemory-postgres pg_dump -U photomemory -t users -t photos -t photo_analysis photomemory > backup_data_$(date +%Y%m%d).sql
```

### Restore Database

```bash
# Restore completo
docker exec -i photomemory-postgres psql -U photomemory photomemory < backup_20260206.sql
```

### Backup Volumi Docker

```bash
# Backup volumi (postgres, minio, redis, ollama)
docker run --rm -v backend_postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres_data.tar.gz /data
docker run --rm -v backend_minio_data:/data -v $(pwd):/backup alpine tar czf /backup/minio_data.tar.gz /data
```

---

## Monitoring

### Resource Usage

```bash
# Stats containers
docker stats

# Logs real-time
docker compose logs -f api
docker compose logs -f ollama
```

### Health Checks

Tutti i servizi hanno health check configurati:

```bash
# Verifica health status
docker inspect photomemory-api | grep -A 5 "Health"
docker inspect photomemory-postgres | grep -A 5 "Health"
docker inspect photomemory-redis | grep -A 5 "Health"
```

---

## Sicurezza Produzione

### Checklist Sicurezza

- [ ] JWT_SECRET generato random e unico
- [ ] POSTGRES_PASSWORD cambiata (non usare `photomemory123`)
- [ ] MINIO_ROOT_USER e MINIO_ROOT_PASSWORD cambiati
- [ ] Utente di default cambiato (non usare `test@example.com` / `test123`)
- [ ] Firewall configurato (esponi solo porte necessarie)
- [ ] HTTPS configurato con reverse proxy (nginx/caddy)
- [ ] Backup automatici configurati
- [ ] Volumi Docker con permessi corretti
- [ ] Log rotation attivo (configurato in docker-compose.yml)

### Porte Esposte

- `5173` - Frontend (dev only, usa reverse proxy in prod)
- `8000` - API Backend
- `5432` - PostgreSQL (chiudi in produzione!)
- `6379` - Redis (chiudi in produzione!)
- `9000` - MinIO API
- `9001` - MinIO Console (chiudi o proteggi in produzione!)
- `11434` - Ollama API (chiudi in produzione!)

**Raccomandazione**: Esponi solo `8000` (API) e usa reverse proxy per frontend.

---

## Support

Per problemi o domande:
- GitHub Issues: https://github.com/alphagold/CLAUDIO/issues
- Documentazione completa: `CLAUDE.md`

---

**Ultima revisione**: 2026-02-06
**Versione sistema**: 1.0
**Deploy-ready**: ✅ Production-ready
