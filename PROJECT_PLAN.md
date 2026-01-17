# Photo Memory App - Piano Progettuale

## Panoramica
App Android con backend che permette di fotografare, analizzare immagini con AI Vision (Claude/GPT-4), e ricercare foto usando linguaggio naturale (es. "quando ho mangiato l'ultima pizza?"). L'AI "vede" le foto e le descrive completamente, riconoscendo oggetti, persone, testo, scene e contesto.

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
┌────────┐  ┌──────────────┐
│Database│  │ Vision LLM   │
│PostgreSQL│ │Claude/GPT-4  │
└────────┘  └──────────────┘
```

---

## Perché Vision AI invece di OCR Tradizionale?

### OCR Tradizionale (Tesseract, Google Vision)
**Pro**:
- Economico (~€1.50/1000 immagini)
- Veloce (1-2s per foto)
- Ottimo per testo stampato

**Contro**:
- **Solo testo**: non "vede" cosa c'è nella foto
- **Zero contesto**: non sa se è una pizza o un documento
- **Nessuna comprensione**: estrae "PIZZA €12" ma non sa che hai mangiato pizza
- **Ricerca limitata**: solo keyword matching
- Richiede post-processing manuale per categorizzare

### Vision AI con LLM (Claude Vision, GPT-4V)
**Pro**:
- **Comprensione completa**: "vede" e capisce cosa c'è nella foto
- **Descrizioni naturali**: genera testo ricco e searchable
- **Multi-tasking**: OCR + object detection + scene understanding in un colpo
- **Ricerca semantica**: capisce "quando ho mangiato l'ultima pizza?" anche senza keyword esatte
- **Flessibilità**: può rispondere a domande specifiche sulla foto
- **Auto-tagging**: genera tags automaticamente
- **Zero training**: funziona out-of-the-box

**Contro**:
- Più costoso (~€3-6/1000 immagini con caching)
- Più lento (3-5s per foto)
- Richiede connessione internet

### Confronto Pratico

**Foto**: Pizza su tavolo in ristorante con menu visibile

| Feature | OCR Tradizionale | Vision AI |
|---------|------------------|-----------|
| Testo estratto | "PIZZERIA DA MARIO MENU €12.50" | "PIZZERIA DA MARIO MENU €12.50" |
| Descrizione | ❌ Nessuna | ✅ "Pizza margherita su tavolo legno in ristorante italiano, sera, bicchiere vino rosso" |
| Oggetti | ❌ Nessuno | ✅ ["pizza", "tavolo", "bicchiere", "vino", "menu"] |
| Contesto | ❌ Nessuno | ✅ "ristorante", "cena", "cucina italiana" |
| Tags | ❌ Manuali | ✅ Auto-generati |
| Ricerca "pizza" | ✅ Solo se nel testo | ✅ Sempre (vede la pizza) |
| Ricerca "quando cenato fuori?" | ❌ Non trova | ✅ Trova (capisce contesto) |
| Risposta domande | ❌ Impossibile | ✅ "Che tipo di pizza?" → "Margherita" |

### Verdetto
**Vision AI** è la scelta giusta per questa app perché:
1. L'obiettivo è ricerca intelligente, non solo estrarre testo
2. Gli utenti vogliono cercare con linguaggio naturale ("quando ho mangiato pizza?")
3. Le foto contengono più informazioni del solo testo (oggetti, scene, contesto)
4. Il costo extra (~€35/mese per uso personale) è accettabile per l'esperienza utente superiore

**Ottimizzazione costi**: Usare Vision AI solo per analisi iniziale, poi cachare risultati per sempre.

---

## Stack Tecnologico

### Backend
- **Framework**: Node.js + Express
- **Database**: PostgreSQL (supporta ricerca full-text e JSON)
- **Storage**:
  - File system locale (dev)
  - AWS S3 / Google Cloud Storage (produzione)
- **Vision AI**:
  - **Claude Vision API** (Anthropic) - Raccomandato per migliore comprensione
  - GPT-4 Vision (OpenAI) - Alternativa
  - Capacità: descrizione scene, OCR, riconoscimento oggetti/persone, analisi contesto
- **AI/NLP**:
  - OpenAI Embeddings API (per ricerca semantica vettoriale)
  - Claude API (per interpretare query in linguaggio naturale)
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

### Tabella: photo_analysis (analisi Vision AI)
```sql
CREATE TABLE photo_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,

    -- Descrizione completa generata da LLM
    description TEXT NOT NULL,

    -- Testo estratto (se presente nella foto)
    extracted_text TEXT,

    -- Oggetti/entità rilevate (JSON array)
    detected_objects JSONB, -- ["pizza", "tavolo", "bicchiere", "persona"]

    -- Scene/contesto
    scene_type VARCHAR(100), -- "restaurant", "outdoor", "home", etc.

    -- Tags per ricerca veloce
    tags TEXT[], -- {"cibo", "pizza", "ristorante"}

    -- Metadata
    model_used VARCHAR(50), -- "claude-3-5-sonnet", "gpt-4-vision"
    confidence DECIMAL(5, 2),
    processed_at TIMESTAMP DEFAULT NOW(),

    -- Per ricerca full-text su descrizione + testo
    search_vector tsvector GENERATED ALWAYS AS (
        to_tsvector('italian', COALESCE(description, '') || ' ' || COALESCE(extracted_text, ''))
    ) STORED
);

-- Indici per ricerca ottimizzata
CREATE INDEX idx_photo_analysis_search ON photo_analysis USING GIN(search_vector);
CREATE INDEX idx_photo_analysis_tags ON photo_analysis USING GIN(tags);
CREATE INDEX idx_photo_analysis_objects ON photo_analysis USING GIN(detected_objects);
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

### Vision Analysis
```
GET    /api/photos/:id/analysis    - Analisi completa della foto (descrizione, oggetti, testo)
POST   /api/photos/:id/reanalyze   - Ri-analizza foto con Vision AI
GET    /api/photos/:id/ask         - Fai una domanda specifica sulla foto
                                     Query: ?question=ci%20sono%20persone%20in%20questa%20foto?
```

---

## Flusso Funzionale

### 1. Upload e Processing
```
1. Utente scatta foto o seleziona dal rullino su Android
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
4. Background job (async) - Analisi Vision AI:
   a. Invia immagine a Claude Vision API con prompt:
      "Descrivi questa immagine in dettaglio. Includi:
       - Cosa vedi (oggetti, persone, luoghi)
       - Eventuale testo presente
       - Contesto/scena (ristorante, casa, outdoor, etc.)
       - Tags rilevanti per ricerca"

   b. Claude risponde con:
      {
        "description": "Una pizza margherita su un tavolo di legno in un ristorante...",
        "extracted_text": "Menu Pizzeria €8.50",
        "detected_objects": ["pizza", "tavolo", "bicchiere", "posate"],
        "scene_type": "restaurant",
        "tags": ["cibo", "pizza", "ristorante", "cena"]
      }

   c. Salva analisi in photo_analysis table

   d. Genera embedding vettoriale della descrizione (OpenAI)

   e. Salva embedding in photo_embeddings
   ↓
5. Server ritorna photo_id all'app
   ↓
6. App può richiedere l'analisi con GET /api/photos/:id/analysis
```

### 2. Ricerca Intelligente (con Vision AI)
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

   c. Esegue ricerca combinata nel database:
      - Full-text: WHERE search_vector @@ to_tsquery('pizza')
      - Tags: WHERE 'pizza' = ANY(tags)
      - Objects: WHERE detected_objects @> '["pizza"]'
      - Semantic: ORDER BY embedding_vector <-> query_embedding
      - Temporal: ORDER BY taken_at DESC

   d. Prende top 5 foto candidate

   e. (OPZIONALE) Re-ranking con Vision AI:
      - Invia immagini candidate + query a Claude Vision
      - Claude "vede" le foto e conferma quale risponde meglio alla domanda
   ↓
4. Server ritorna:
   {
     "answer": "Hai mangiato pizza il 15 gennaio 2024 alle 19:30 alla Pizzeria Da Mario",
     "photos": [{
       "id": "...",
       "url": "https://...",
       "thumbnail_url": "https://...",
       "taken_at": "2024-01-15T19:30:00Z",
       "description": "Pizza margherita su tavolo in ristorante...",
       "extracted_text": "Menu Pizzeria Da Mario €8.50",
       "detected_objects": ["pizza", "tavolo", "bicchiere"],
       "relevance_score": 0.95,
       "location": "Via Roma 123, Milano"
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
- [ ] Integrazione Claude Vision API (analisi base)
- [ ] Job queue (Bull/BullMQ) per processing asincrono
- [ ] Endpoint ricerca full-text semplice
- [ ] Test API con Postman

**Deliverable**: API REST testabile

---

### FASE 2: Android App Base (Settimana 2-3)
**Obiettivo**: App che scatta, seleziona e carica foto

- [ ] Setup progetto Android (Kotlin + Jetpack Compose)
- [ ] Schermata Login/Registro
- [ ] Integrazione CameraX per scattare foto
- [ ] Photo picker per selezionare dal rullino (Android Photo Picker API)
- [ ] Upload foto al server (con progress indicator)
- [ ] Galleria foto dell'utente (LazyColumn con thumbnail)
- [ ] Visualizzazione dettaglio foto + analisi AI
- [ ] Gestione permessi camera/storage

**Deliverable**: App Android funzionante base

---

### FASE 3: Vision AI e Ricerca Avanzata (Settimana 3-4)
**Obiettivo**: Sistema di ricerca intelligente con Vision AI

- [ ] Ottimizzazione prompt Claude Vision per analisi foto
- [ ] Generazione embeddings descrizioni (OpenAI API)
- [ ] Setup pgvector per ricerca semantica vettoriale
- [ ] Endpoint ricerca semantica + full-text combinata
- [ ] Integrazione Claude API per parsing query naturali
- [ ] Re-ranking risultati con Vision AI (opzionale)
- [ ] Cache Redis per query frequenti e analisi foto
- [ ] Batch processing foto multiple

**Deliverable**: Ricerca "quando ho mangiato pizza?" funzionante

---

### FASE 4: UI/UX Android (Settimana 4-5)
**Obiettivo**: App user-friendly

- [ ] Schermata ricerca con input vocale (Speech-to-Text)
- [ ] Visualizzazione timeline foto (raggruppate per data)
- [ ] Filtri per data/luogo/tags
- [ ] Card dettaglio foto con:
  - Descrizione AI
  - Testo estratto (se presente)
  - Tags/oggetti rilevati
  - Mappa se GPS disponibile
- [ ] "Chiedi alla foto" - input per domande specifiche
- [ ] Offline mode (cache locale con Room)
- [ ] Condivisione foto + descrizione
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

**Sfruttando Vision AI**:
- [ ] **Conversazioni con foto**: chat persistente per ogni foto
  - "Quante calorie ha questo piatto?"
  - "Qual è il vino nella foto?"
- [ ] **Clustering foto simili**: Vision AI identifica foto duplicate/simili
- [ ] **Smart albums automatici**: "Tutti i pranzi", "Viaggi", "Ricevute"
- [ ] **Riconoscimento volti**: "Mostrami foto con Marco"
- [ ] **Estrazione dati strutturati**:
  - Scontrini → JSON (importo, data, negozio)
  - Biglietti da visita → contatti
  - Ricette → ingredienti + procedimento

**Productivity**:
- [ ] **Promemoria basati su foto**: "Oggi 1 anno fa..."
- [ ] **Integrazione calendario**: foto automaticamente in eventi
- [ ] **Export PDF**: report mensili con foto + spese
- [ ] **OCR traduzione**: testo in foto tradotto real-time
- [ ] **Scan documenti**: multi-page PDF da foto

**Social/Condivisione**:
- [ ] **Album condivisi**: invita amici, collaborazione
- [ ] **Link pubblici**: condividi foto con descrizione AI
- [ ] **Story generation**: "racconta la mia settimana" con foto

---

## Esempi Vision AI in Azione

### Esempio 1: Analisi Foto Cibo

**Input**: Foto di una pizza su un tavolo di ristorante

**Prompt a Claude Vision**:
```
Analizza questa foto e rispondi in JSON con:
- description: descrizione dettagliata in italiano
- extracted_text: eventuale testo visibile
- detected_objects: array di oggetti/cibo rilevati
- scene_type: tipo di scena (restaurant/home/outdoor/etc)
- tags: array di tag rilevanti per ricerca
- metadata: informazioni extra (es. tipo di cucina, momento del giorno)
```

**Risposta Claude**:
```json
{
  "description": "Una pizza margherita appena sfornata su un tavolo di legno in un ristorante italiano. La pizza ha mozzarella sciolta, basilico fresco e pomodoro. Accanto ci sono un bicchiere di vino rosso e posate avvolte in un tovagliolo bianco. L'illuminazione calda suggerisce sera.",
  "extracted_text": "Pizzeria Da Mario - Menu €12.50",
  "detected_objects": [
    "pizza margherita",
    "tavolo legno",
    "bicchiere vino rosso",
    "posate",
    "tovagliolo",
    "menu"
  ],
  "scene_type": "restaurant",
  "tags": ["cibo", "pizza", "ristorante", "italiano", "cena", "vino"],
  "metadata": {
    "cuisine": "italiana",
    "meal_type": "cena",
    "dish_type": "pizza margherita",
    "setting": "ristorante tradizionale",
    "time_of_day": "sera"
  }
}
```

### Esempio 2: Ricerca con Domanda Complessa

**Query utente**: "quando ho mangiato l'ultima pizza?"

**Step 1 - Parsing query con Claude**:
```json
{
  "intent": "find_food_photo",
  "food_type": "pizza",
  "temporal_filter": "most_recent",
  "keywords": ["pizza", "mangiato", "cibo"],
  "query_type": "when",
  "expected_answer_format": "date_and_photo"
}
```

**Step 2 - Query Database**:
```sql
SELECT p.*, pa.*
FROM photos p
JOIN photo_analysis pa ON pa.photo_id = p.id
WHERE
  -- Full-text search
  pa.search_vector @@ to_tsquery('italian', 'pizza')
  -- Tag search
  OR 'pizza' = ANY(pa.tags)
  -- Object detection
  OR pa.detected_objects @> '["pizza"]'::jsonb
  AND p.user_id = 'user-123'
ORDER BY p.taken_at DESC
LIMIT 1;
```

**Step 3 - Generazione risposta naturale**:
```
Query: "quando ho mangiato l'ultima pizza?"
Foto trovata: 15 gennaio 2024, 19:30
Descrizione: "Pizza margherita alla Pizzeria Da Mario"

Risposta: "Hai mangiato pizza il 15 gennaio 2024 alle 19:30. Era una pizza margherita alla Pizzeria Da Mario!"
```

### Esempio 3: Conversazione con Foto

**Foto**: Scontrino supermercato

**Utente**: "quanto ho speso?"
**Claude Vision** (analizza foto): "Hai speso €47.35 al supermercato Esselunga il 10/01/2024"

**Utente**: "cosa ho comprato?"
**Claude Vision**: "Hai comprato: latte (€2.50), pane (€1.20), pasta Barilla (€1.80), pomodori (€3.45), mozzarella (€2.90), vino Chianti (€8.50), detersivo (€5.20), carta igienica (€4.80), acqua naturale (€2.00), totale €47.35"

**Utente**: "aggiungi al budget mensile"
**App**: Salva spesa in categoria "Spesa" con importo €47.35

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

### Servizi Cloud (Uso Personale - 1000 foto/mese)
- **Database** (Supabase free tier): €0
- **Storage** (10GB S3): ~€0.30
- **Hosting Backend** (Railway): €5-10
- **Claude Vision API** (1000 immagini):
  - Input: ~1000 immagini × ~1000 tokens = 1M input tokens
  - Output: ~500 tokens/foto = 500k output tokens
  - Costo: ~€6 (input) + ~€30 (output) = **~€36**
- **OpenAI Embeddings** (100k tokens): ~€2
- **Claude API** (ricerche NLP - 50k tokens): ~€1

**Totale**: ~€45-50/mese per 1000 foto/mese

**Ottimizzazioni per ridurre costi**:
- Cache analisi per 30 giorni (€35/mese)
- Batch processing (€30/mese)
- Usare GPT-4o-mini Vision per foto semplici (€15/mese)

### Scaling (10,000 utenti - ~50k foto/mese)
- Database: €25
- Storage (500GB): €15
- Hosting: €50
- Claude Vision (con caching): €1,200
- OpenAI APIs: €50

**Totale**: ~€1,350/mese

**Abbonamento suggerito**: €5/mese per utente (illimitato con fair use)

---

## Rischi e Soluzioni

### Rischio 1: Costi Vision AI Elevati
**Soluzione**:
- **Caching aggressivo**: analisi salvate per sempre, re-analisi solo su richiesta
- **Tiered processing**:
  - GPT-4o-mini Vision per foto semplici (80% casi) - €0.15/1k immagini
  - Claude Vision solo per foto complesse - €3/1k immagini
- **Batch processing**: analizzare 10+ foto in un singolo messaggio (sconto volume)
- **Prompt caching**: riutilizzo istruzioni sistema (50% sconto)
- **Limiti utente**: max 100 foto/mese tier gratuito

### Rischio 2: Analisi Lenta (Vision AI richiede 2-5s per foto)
**Soluzione**:
- Processing asincrono con job queue
- Analisi in background dopo upload
- Thumbnail mostrate subito, analisi caricata via WebSocket/polling
- Pre-processing batch notturno per foto vecchie
- Progress bar realtime per l'utente

### Rischio 3: Ricerca Inaccurata
**Soluzione**:
- **Ricerca ibrida**:
  - Full-text search (veloce, precisa per keyword)
  - Semantic search (coglie sinonimi e contesto)
  - Tag-based (oggetti rilevati)
- **Re-ranking con Vision**: top 5 candidati re-analizzati visivamente
- **Feedback loop**: utente conferma risultati corretti → training
- Permettere all'utente di editare tags/descrizioni

### Rischio 4: Privacy/GDPR (foto sensibili inviate a API esterne)
**Soluzione**:
- **Consenso esplicito**: utente accetta invio a Anthropic/OpenAI
- **Opt-in Vision AI**: modalità base senza AI (solo metadata EXIF)
- **Storage in EU**: Anthropic ha endpoint EU, OpenAI no
- **Data retention**: politica chiara su quanto Anthropic conserva immagini
- **Crittografia**: E2E encryption opzionale (foto cifrate, chiave su device)
- **GDPR compliance**:
  - Right to deletion (cancellazione completa)
  - Data export (JSON + zip immagini)
  - Privacy policy trasparente

### Rischio 5: Rate Limiting API
**Soluzione**:
- Queue con retry exponential backoff
- Monitoring usage in real-time
- Fallback su tier inferiore (GPT-4o-mini)
- Alert quando si avvicina a limiti mensili

---

## Codice di Esempio - Integrazione Vision AI

### Backend: Analisi Foto con Claude Vision

```javascript
// services/visionService.js
import Anthropic from '@anthropic-ai/sdk';
import fs from 'fs';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

export async function analyzePhotoWithVision(photoPath) {
  // Leggi immagine e converti in base64
  const imageBuffer = fs.readFileSync(photoPath);
  const base64Image = imageBuffer.toString('base64');
  const mimeType = 'image/jpeg'; // o 'image/png'

  const response = await anthropic.messages.create({
    model: 'claude-3-5-sonnet-20241022',
    max_tokens: 1024,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType,
            data: base64Image
          }
        },
        {
          type: 'text',
          text: `Analizza questa foto e rispondi SOLO con JSON valido:
{
  "description": "descrizione dettagliata in italiano",
  "extracted_text": "eventuale testo visibile",
  "detected_objects": ["oggetto1", "oggetto2"],
  "scene_type": "restaurant/home/outdoor/office/other",
  "tags": ["tag1", "tag2"],
  "metadata": {
    "cuisine": "tipo cucina se cibo",
    "meal_type": "colazione/pranzo/cena se cibo",
    "setting": "contesto generale"
  }
}`
        }
      ]
    }],
    // Prompt caching per ridurre costi (riusa istruzioni sistema)
    system: [{
      type: 'text',
      text: 'Sei un assistente che analizza foto per un\'app di memory fotografica.',
      cache_control: { type: 'ephemeral' }
    }]
  });

  const analysisJson = JSON.parse(response.content[0].text);
  return analysisJson;
}

// Esempio uso
const analysis = await analyzePhotoWithVision('/uploads/photo123.jpg');
console.log(analysis);
// {
//   "description": "Pizza margherita su tavolo...",
//   "detected_objects": ["pizza", "tavolo", "bicchiere"],
//   ...
// }
```

### Backend: Processing Queue con Bull

```javascript
// queues/photoQueue.js
import Queue from 'bull';
import { analyzePhotoWithVision } from '../services/visionService.js';
import { generateEmbedding } from '../services/embeddingService.js';
import { db } from '../db.js';

export const photoProcessingQueue = new Queue('photo-processing', {
  redis: process.env.REDIS_URL
});

// Worker che processa foto
photoProcessingQueue.process(async (job) => {
  const { photoId, photoPath } = job.data;

  // Step 1: Vision AI analysis
  job.progress(25);
  const analysis = await analyzePhotoWithVision(photoPath);

  // Step 2: Salva analisi in DB
  job.progress(50);
  await db.query(`
    INSERT INTO photo_analysis (photo_id, description, extracted_text, detected_objects, scene_type, tags, model_used)
    VALUES ($1, $2, $3, $4, $5, $6, 'claude-3-5-sonnet')
  `, [photoId, analysis.description, analysis.extracted_text, JSON.stringify(analysis.detected_objects), analysis.scene_type, analysis.tags]);

  // Step 3: Genera embedding per ricerca semantica
  job.progress(75);
  const embeddingText = `${analysis.description} ${analysis.extracted_text || ''}`;
  const embedding = await generateEmbedding(embeddingText);

  // Step 4: Salva embedding
  job.progress(90);
  await db.query(`
    INSERT INTO photo_embeddings (photo_id, embedding_vector)
    VALUES ($1, $2)
  `, [photoId, `[${embedding.join(',')}]`]);

  job.progress(100);
  return { success: true, analysis };
});

// Aggiungi foto alla queue
export async function queuePhotoAnalysis(photoId, photoPath) {
  await photoProcessingQueue.add({
    photoId,
    photoPath
  }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    }
  });
}
```

### Backend: Endpoint Upload Foto

```javascript
// routes/photos.js
import express from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { queuePhotoAnalysis } from '../queues/photoQueue.js';
import { db } from '../db.js';

const router = express.Router();
const upload = multer({ dest: 'uploads/' });

router.post('/photos', upload.single('photo'), async (req, res) => {
  try {
    const photoId = uuidv4();
    const userId = req.user.id; // da JWT middleware
    const file = req.file;
    const { taken_at, latitude, longitude } = req.body;

    // Salva record foto
    await db.query(`
      INSERT INTO photos (id, user_id, file_path, taken_at, latitude, longitude)
      VALUES ($1, $2, $3, $4, $5, $6)
    `, [photoId, userId, file.path, taken_at, latitude, longitude]);

    // Aggiungi a queue per analisi asincrona
    await queuePhotoAnalysis(photoId, file.path);

    res.json({
      success: true,
      photo_id: photoId,
      message: 'Foto caricata, analisi in corso...'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

### Android: Upload Foto da Rullino

```kotlin
// MainActivity.kt
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*

@Composable
fun PhotoPickerScreen() {
    var selectedImageUri by remember { mutableStateOf<Uri?>(null) }

    // Launcher per Photo Picker
    val photoPickerLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.PickVisualMedia()
    ) { uri: Uri? ->
        selectedImageUri = uri
        uri?.let { uploadPhoto(it) }
    }

    Button(
        onClick = {
            photoPickerLauncher.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
            )
        }
    ) {
        Text("Seleziona dal Rullino")
    }
}

// Funzione upload
suspend fun uploadPhoto(uri: Uri) {
    val context = LocalContext.current
    val file = uriToFile(context, uri)

    val requestBody = file.asRequestBody("image/*".toMediaTypeOrNull())
    val multipartBody = MultipartBody.Part.createFormData("photo", file.name, requestBody)

    val response = apiService.uploadPhoto(
        photo = multipartBody,
        takenAt = System.currentTimeMillis(),
        latitude = currentLocation?.latitude,
        longitude = currentLocation?.longitude
    )

    if (response.isSuccessful) {
        // Mostra success
    }
}
```

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

- **Accuratezza Vision AI**:
  - Descrizione rilevante: >90% foto descritte accuratamente
  - Oggetti rilevati: >85% oggetti principali identificati
  - OCR testo: >90% testo stampato estratto correttamente
- **Precisione ricerca**:
  - >85% query interpretate correttamente
  - >80% risultati rilevanti in top 3
  - <10% "nessun risultato" per query valide
- **Performance**:
  - Upload foto: <3s
  - Vision AI analysis: <5s (asincrona)
  - Ricerca: <2s
  - Cache hit rate: >60%
- **UX**:
  - App rating >4.2
  - Crash rate <1%
  - Retention 7 giorni: >40%
- **Costi**:
  - <€0.05 per foto analizzata (con caching)
  - <€0.01 per ricerca

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

**Versione documento**: 2.0 (aggiornato con Vision AI)
**Ultimo aggiornamento**: 17 Gennaio 2026
**Autore**: Claude Code + alphagold

**Changelog v2.0**:
- ✅ Sostituito OCR tradizionale con Vision AI (Claude Vision / GPT-4V)
- ✅ Schema database aggiornato per analisi completa (descrizioni, oggetti, tags)
- ✅ Aggiunta funzionalità upload da rullino Android
- ✅ Esempi codice completi per integrazione Vision AI
- ✅ Confronto dettagliato OCR vs Vision AI
- ✅ Analisi costi aggiornata
- ✅ Esempi conversazionali con foto
