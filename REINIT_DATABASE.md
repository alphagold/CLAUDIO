# Reinizializzazione Database PhotoMemory

## Comandi per reinizializzare completamente il database

**ATTENZIONE:** Questo cancellerà TUTTI i dati (foto, utenti, analisi)!

```bash
# 1. Ferma tutti i container
cd backend
docker compose down

# 2. Cancella il volume del database (DATI PERSI!)
docker volume rm backend_postgres_data

# 3. Riavvia tutto (verrà ricreato il DB con tutte le migration)
docker compose up -d

# 4. Verifica i log per confermare che le migration sono state eseguite
docker compose logs postgres | grep -i migration

# 5. Verifica che l'API sia attiva
docker compose logs -f api
```

## Verifica migration eseguita

```bash
# Controlla che le colonne remote_ollama esistano
docker exec -it photomemory-postgres psql -U photomemory -d photomemory -c "\d users"

# Dovresti vedere:
# - remote_ollama_enabled
# - remote_ollama_url
# - remote_ollama_model
```

## Alternative: Solo Migration (senza cancellare dati)

Se vuoi solo eseguire la nuova migration senza perdere dati:

```bash
# Esegui solo la migration 003
docker exec -i photomemory-postgres psql -U photomemory -d photomemory < migrations/003_add_remote_ollama.sql

# Verifica
docker exec -it photomemory-postgres psql -U photomemory -d photomemory -c "\d users"
```
