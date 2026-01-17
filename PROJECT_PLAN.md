# Photo Memory App - Piano Progettuale

## Panoramica
App Android con backend che permette di fotografare, estrarre testo con OCR, e ricercare foto usando linguaggio naturale (es. "quando ho mangiato l'ultima pizza?").

---

## Architettura del Sistema

```
┌─────────────────┐
│  Android App    │
│  (Client)       │
└────────┬────────┘
         │ HTTP/REST
         ▼
┌─────────────────┐
│  Backend API    │
│  (Node.js)      │
└────────┬────────┘
         │
    ┌────┴────┐
    ▼         ▼
┌────────┐  ┌──────────┐
│Database│  │ AI/OCR   │
│PostgreSQL│ │Services  │
└────────┘  └──────────┘
```

---

## Stack Tecnologico

### Backend
- **Framework**: Node.js + Express
- **Database**: PostgreSQL (supporta ricerca full-text e JSON)
- **Storage**:
  - File system locale (dev)
  - AWS S3 / Google Cloud Storage (produzione)
- **OCR**:
  - Tesseract.js (open source)
  - Google Cloud Vision API (migliore accuratezza)
- **AI/NLP**:
  - OpenAI Embeddings API (per ricerca semantica)
  - Anthropic Claude API (per interpretare query in linguaggio naturale)
- **Autenticazione**: JWT tokens

### Android Client
- **Linguaggio**: Kotlin
- **UI**: Jetpack Compose (moderno) o XML tradizionale
- **Networking**: Retrofit + OkHttp
- **Camera**: CameraX API
- **Database locale**: Room (cache offline)
- **Image loading**: Coil o Glide

### DevOps
- **Hosting**:
  - Backend: Railway / Render / DigitalOcean
  - Database: Supabase / Railway
- **CI/CD**: GitHub Actions
- **Monitoring**: Sentry (error tracking)

---

## Schema Database

### Tabella: users
```sql
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

### Tabella: photos
```sql
CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    file_path VARCHAR(512) NOT NULL,
    thumbnail_path VARCHAR(512),
    taken_at TIMESTAMP NOT NULL,
    uploaded_at TIMESTAMP DEFAULT NOW(),
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_name VARCHAR(255)
);
```

### Tabella: photo_texts
```sql
CREATE TABLE photo_texts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    extracted_text TEXT NOT NULL,
    confidence DECIMAL(5, 2), -- OCR confidence score
    language VARCHAR(10),
    processed_at TIMESTAMP DEFAULT NOW(),

    -- Per ricerca full-text
    text_vector tsvector GENERATED ALWAYS AS (to_tsvector('italian', extracted_text)) STORED
);

-- Indice per ricerca full-text veloce
CREATE INDEX idx_text_search ON photo_texts USING GIN(text_vector);
```

### Tabella: photo_embeddings (per ricerca semantica)
```sql
CREATE TABLE photo_embeddings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    embedding_vector VECTOR(1536), -- OpenAI embeddings dimension
    created_at TIMESTAMP DEFAULT NOW()
);

-- Richiede estensione pgvector
CREATE EXTENSION IF NOT EXISTS vector;
CREATE INDEX ON photo_embeddings USING ivfflat (embedding_vector vector_cosine_ops);
```

### Tabella: search_queries (analytics)
```sql
CREATE TABLE search_queries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),
    query_text TEXT NOT NULL,
    results_count INTEGER,
    searched_at TIMESTAMP DEFAULT NOW()
);
```

---

## API Endpoints

### Autenticazione
```
POST   /api/auth/register          - Registrazione utente
POST   /api/auth/login             - Login (ritorna JWT)
POST   /api/auth/logout            - Logout
GET    /api/auth/me                - Info utente corrente
```

### Photos
```
POST   /api/photos                 - Upload foto (multipart/form-data)
GET    /api/photos                 - Lista foto dell'utente (paginata)
GET    /api/photos/:id             - Dettaglio singola foto
DELETE /api/photos/:id             - Elimina foto
GET    /api/photos/:id/download    - Download immagine originale
```

### Search
```
POST   /api/search/natural         - Ricerca in linguaggio naturale
                                     Body: { "query": "quando ho mangiato pizza?" }

POST   /api/search/text            - Ricerca full-text semplice
                                     Body: { "query": "pizza", "dateFrom": "2024-01-01" }

GET    /api/search/timeline        - Timeline foto per data
                                     Query: ?year=2024&month=1
```

### OCR
```
GET    /api/photos/:id/text        - Testo estratto da foto
POST   /api/photos/:id/reprocess   - Ri-processa OCR
```

---

## Flusso Funzionale

### 1. Upload e Processing
```
1. Utente scatta foto su Android
   ↓
2. App invia foto al server (POST /api/photos)
   - Include: immagine, timestamp, GPS coords
   ↓
3. Server:
   a. Salva immagine (S3 o filesystem)
   b. Genera thumbnail
   c. Estrae EXIF metadata
   d. Inserisce record in DB (photos)
   ↓
4. Background job (async):
   a. Esegue OCR (Tesseract/Google Vision)
   b. Salva testo estratto (photo_texts)
   c. Genera embedding vettoriale (OpenAI)
   d. Salva embedding (photo_embeddings)
   ↓
5. Server ritorna photo_id all'app
```

### 2. Ricerca Intelligente
```
1. Utente digita: "quando ho mangiato l'ultima pizza?"
   ↓
2. App invia query a POST /api/search/natural
   ↓
3. Server elabora con AI:
   a. Usa Claude API per interpretare query:
      - Estrae intent: "cerca foto con 'pizza'"
      - Estrae filtro temporale: "più recente"
      - Estrae ordinamento: "DESC per data"

   b. Genera embedding della query (OpenAI)

   c. Esegue ricerca combinata:
      - Full-text search: WHERE text_vector @@ to_tsquery('pizza')
      - Semantic search: ORDER BY embedding_vector <-> query_embedding
      - Filtro data: ORDER BY taken_at DESC LIMIT 1
   ↓
4. Server ritorna:
   {
     "answer": "Hai mangiato pizza il 15 gennaio 2024",
     "photos": [{
       "id": "...",
       "url": "https://...",
       "taken_at": "2024-01-15T19:30:00Z",
       "extracted_text": "Menu Pizza Margherita €8.50...",
       "relevance_score": 0.92
     }]
   }
   ↓
5. App mostra foto + risposta all'utente
```

---

## Fasi di Implementazione

### FASE 1: MVP Backend (Settimana 1-2)
**Obiettivo**: Server funzionante con API base

- [ ] Setup progetto Node.js + Express
- [ ] Database PostgreSQL + schema iniziale
- [ ] Autenticazione JWT
- [ ] Endpoint upload foto (salvataggio locale)
- [ ] Integrazione Tesseract.js per OCR base
- [ ] Endpoint ricerca full-text semplice
- [ ] Test API con Postman

**Deliverable**: API REST testabile

---

### FASE 2: Android App Base (Settimana 2-3)
**Obiettivo**: App che scatta e carica foto

- [ ] Setup progetto Android (Kotlin + Jetpack Compose)
- [ ] Schermata Login/Registro
- [ ] Integrazione CameraX per scattare foto
- [ ] Upload foto al server
- [ ] Galleria foto (RecyclerView o LazyColumn)
- [ ] Visualizzazione dettaglio foto
- [ ] Gestione permessi camera/storage

**Deliverable**: App Android funzionante base

---

### FASE 3: OCR e Ricerca Avanzata (Settimana 3-4)
**Obiettivo**: Sistema di ricerca intelligente

- [ ] Integrazione Google Cloud Vision API (OCR migliorato)
- [ ] Job queue (Bull/BullMQ) per processing asincrono
- [ ] Generazione embeddings (OpenAI API)
- [ ] Setup pgvector per ricerca vettoriale
- [ ] Endpoint ricerca semantica
- [ ] Integrazione Claude API per NLP
- [ ] Cache Redis per query frequenti

**Deliverable**: Ricerca "quando ho mangiato pizza?" funzionante

---

### FASE 4: UI/UX Android (Settimana 4-5)
**Obiettivo**: App user-friendly

- [ ] Schermata ricerca con input vocale
- [ ] Visualizzazione timeline foto
- [ ] Filtri per data/luogo
- [ ] Visualizzazione testo estratto su foto
- [ ] Offline mode (cache locale con Room)
- [ ] Condivisione foto
- [ ] Dark mode

**Deliverable**: App completa e usabile

---

### FASE 5: Ottimizzazioni e Deploy (Settimana 5-6)
**Obiettivo**: App in produzione

**Backend**:
- [ ] Ottimizzazione query DB (indici, EXPLAIN ANALYZE)
- [ ] Rate limiting API
- [ ] Compressione immagini (Sharp.js)
- [ ] CDN per immagini
- [ ] Deploy su Railway/Render
- [ ] Setup monitoring (Sentry)
- [ ] Backup automatico database

**Android**:
- [ ] Ottimizzazione caricamento immagini
- [ ] Gestione errori di rete
- [ ] Analytics (Firebase/Mixpanel)
- [ ] Build release APK
- [ ] Test su dispositivi reali

**Deliverable**: App pubblicabile

---

### FASE 6: Features Avanzate (Opzionale)
- [ ] Riconoscimento oggetti (ML Kit / TensorFlow Lite)
- [ ] Clustering foto simili
- [ ] Esportazione dati (PDF report)
- [ ] Promemoria basati su foto ("Oggi 1 anno fa...")
- [ ] Integrazione calendario
- [ ] Riconoscimento volti
- [ ] Trascrizione audio (se foto contiene QR/barcode)

---

## Esempio Query Processing

### Input Utente
```
"quando ho mangiato l'ultima pizza?"
```

### Step 1: Parsing con Claude API
```javascript
const response = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  messages: [{
    role: "user",
    content: `Analizza questa query e estrai:
    - Cosa cerca l'utente (keyword)
    - Filtri temporali (più recente, più vecchio, range)
    - Ordinamento

    Query: "${userQuery}"

    Rispondi in JSON.`
  }]
});

// Output Claude:
{
  "keywords": ["pizza", "mangiato", "cibo"],
  "temporal_filter": "most_recent",
  "order_by": "taken_at DESC",
  "limit": 1
}
```

### Step 2: Ricerca Database
```sql
WITH text_search AS (
  SELECT
    pt.photo_id,
    p.taken_at,
    pt.extracted_text,
    ts_rank(pt.text_vector, to_tsquery('italian', 'pizza')) as rank
  FROM photo_texts pt
  JOIN photos p ON p.id = pt.photo_id
  WHERE pt.text_vector @@ to_tsquery('italian', 'pizza')
    AND p.user_id = $1
),
semantic_search AS (
  SELECT
    pe.photo_id,
    1 - (pe.embedding_vector <=> $2::vector) as similarity
  FROM photo_embeddings pe
  WHERE pe.photo_id IN (SELECT photo_id FROM text_search)
)
SELECT
  p.*,
  ts.extracted_text,
  (ts.rank * 0.4 + ss.similarity * 0.6) as final_score
FROM photos p
JOIN text_search ts ON ts.photo_id = p.id
JOIN semantic_search ss ON ss.photo_id = p.id
ORDER BY p.taken_at DESC
LIMIT 1;
```

### Step 3: Generazione Risposta
```javascript
const answer = await anthropic.messages.create({
  model: "claude-sonnet-4-5",
  messages: [{
    role: "user",
    content: `L'utente ha chiesto: "${userQuery}"

    Ho trovato questa foto:
    - Data: ${photo.taken_at}
    - Testo estratto: ${photo.extracted_text}

    Genera una risposta naturale in italiano.`
  }]
});

// Output: "Hai mangiato pizza il 15 gennaio 2024 alle 19:30"
```

---

## Costi Stimati (Mensili)

### Servizi Cloud
- **Database** (Supabase free tier): €0
- **Storage** (10GB S3): ~€0.30
- **Hosting Backend** (Railway): €5-10
- **OCR** (Google Vision - 1000 img/mese): ~€1.50
- **OpenAI Embeddings** (100k tokens): ~€2
- **Claude API** (ricerche - 50k tokens): ~€0.75

**Totale**: ~€10-15/mese per 1000 foto/mese

### Scaling (10,000 utenti)
- Database: €25
- Storage: €15
- Hosting: €50
- APIs: €100

**Totale**: ~€200/mese

---

## Rischi e Soluzioni

### Rischio 1: OCR Inaccurato
**Soluzione**:
- Combinare Tesseract + Google Vision
- Permettere correzione manuale
- Training modello custom per casi specifici (scontrini, menu)

### Rischio 2: Ricerca Lenta
**Soluzione**:
- Indici database ottimizzati
- Cache Redis per query frequenti
- Pre-calcolo embeddings
- Pagination aggressiva

### Rischio 3: Costi API Alti
**Soluzione**:
- Tesseract per OCR di base (gratis)
- Google Vision solo per casi complessi
- Batch processing
- Cache risultati

### Rischio 4: Privacy/GDPR
**Soluzione**:
- Crittografia foto a riposo
- HTTPS only
- Cancellazione dati su richiesta
- Privacy policy chiara
- Storage in EU

---

## Quick Start per Sviluppatori

### Backend
```bash
git clone https://github.com/alphagold/photo-memory-api
cd photo-memory-api
npm install
cp .env.example .env  # Configura DB e API keys
npm run migrate       # Setup database
npm run dev          # Avvia server
```

### Android
```bash
git clone https://github.com/alphagold/photo-memory-android
cd photo-memory-android
# Apri in Android Studio
# Configura API_BASE_URL in local.properties
# Run su emulatore o device
```

---

## Metriche di Successo

- **Accuratezza OCR**: >85% per testi stampati
- **Precisione ricerca**: >80% query interpretate correttamente
- **Performance**:
  - Upload foto: <5s
  - Ricerca: <2s
  - OCR processing: <10s
- **UX**:
  - App rating >4.0
  - Crash rate <1%

---

## Prossimi Passi

1. **Setup repository**: Crea `photo-memory-api` e `photo-memory-android`
2. **Kickoff FASE 1**: Inizia backend MVP
3. **Setup CI/CD**: GitHub Actions per test automatici
4. **Design mockup**: UI/UX app Android (Figma)

---

## Domande da Risolvere

- [ ] Limite max foto per utente? (es. 1000 free, poi pagamento)
- [ ] Supporto multi-lingua OCR?
- [ ] Versione iOS futura?
- [ ] Condivisione album tra utenti?
- [ ] Backup automatico Google Drive/Dropbox?

---

**Versione documento**: 1.0
**Ultimo aggiornamento**: 17 Gennaio 2026
**Autore**: Claude Code + alphagold
