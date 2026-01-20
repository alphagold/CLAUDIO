# Photo Memory AI - Piano v3.0 🚀
## Self-Hosted, Zero Costi, Ultra-Veloce, Bellissimo

> **Filosofia**: Niente cloud API a pagamento. Tutto gira su tuo server/PC. Privacy totale. Velocità massima. UX da sogno.

---

## 🎯 Vision Statement

Non una semplice "app per foto". Ma un **secondo cervello fotografico** che:
- **Vede** le tue foto come le vedi tu
- **Ricorda** tutto quello che fotografi
- **Risponde** istantaneamente a linguaggio naturale
- **Zero friction** - 2 tap per scattare e cercare
- **Offline-first** - funziona ovunque
- **Tua** - dati sempre sul tuo hardware

---

## 🏗️ Architettura Self-Hosted

```
┌─────────────────────────────────────────┐
│         Android App (Kotlin)            │
│  • CameraX real-time preview            │
│  • Voice commands                       │
│  • Gesture navigation                   │
│  • Local ML (on-device OCR lite)        │
└──────────────┬──────────────────────────┘
               │ REST API / WebSocket
               ▼
┌─────────────────────────────────────────┐
│    Backend Server (FastAPI/Python)      │
│  • Photo upload & processing            │
│  • Search engine                        │
│  • Job queue (Celery)                   │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    ▼                     ▼
┌──────────┐        ┌─────────────┐
│ Ollama   │        │ PostgreSQL  │
│ (Vision  │        │ + pgvector  │
│  Models) │        │ + FTS       │
└──────────┘        └─────────────┘
     ▼
┌─────────────────────────────┐
│  Vision Models (self-hosted)│
│  • Llama 3.2 Vision (11B)   │
│  • MoondreamV2 (2B) - veloce│
│  • PaddleOCR - OCR migliore │
└─────────────────────────────┘
```

---

## 🤖 Stack Tecnologico (100% Open Source)

### Backend
- **Framework**: FastAPI (Python) - velocissimo, async nativo
- **Database**: PostgreSQL 16 + pgvector + pgroonga (full-text JP)
- **Cache**: Redis (session + result caching)
- **Queue**: Celery + Redis (async processing)
- **Vision AI**:
  - **Ollama** - serve modelli locali (facile come Docker)
  - **Llama 3.2 Vision 11B** - ottimo bilancio qualità/velocità
  - **Moondream V2 2B** - ultra-veloce per preview real-time
  - **PaddleOCR** - OCR migliore di Tesseract, supporta 80+ lingue
- **Embeddings**:
  - **sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2**
  - Funziona in italiano, veloce, 384 dimensioni
- **Storage**: MinIO (S3-compatible, self-hosted)
- **Reverse Proxy**: Caddy (HTTPS automatico)

### Android App
- **Linguaggio**: Kotlin
- **UI**: Jetpack Compose (Material 3)
- **Architecture**: MVVM + Clean Architecture
- **Camera**: CameraX
- **Local ML**:
  - **ML Kit** (Google, gratis, on-device) - OCR real-time leggero
  - **TensorFlow Lite** - object detection on-device
- **Database locale**: Room + SQLite FTS5
- **Networking**: Ktor Client (Kotlin-native, async)
- **Image loading**: Coil (Compose-native)
- **Speech**: Android SpeechRecognizer (offline dopo download)

### Deployment
- **Docker Compose** - tutto in container
- **Traefik** - load balancer + SSL
- **Watchtower** - auto-update containers
- **Portainer** - gestione UI
- **Grafana + Prometheus** - monitoring (opzionale)

---

## 💾 Schema Database Ottimizzato

### photos
```sql
CREATE TABLE photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,

    -- File paths
    original_path VARCHAR(512) NOT NULL,
    thumbnail_128_path VARCHAR(512), -- lista foto
    thumbnail_512_path VARCHAR(512), -- dettaglio

    -- Timestamps
    taken_at TIMESTAMPTZ NOT NULL,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    analyzed_at TIMESTAMPTZ,

    -- Location
    latitude DECIMAL(10, 8),
    longitude DECIMAL(11, 8),
    location_name VARCHAR(255), -- reverse geocoding

    -- Quick filters
    has_text BOOLEAN DEFAULT FALSE,
    has_faces BOOLEAN DEFAULT FALSE,
    is_food BOOLEAN DEFAULT FALSE,
    is_document BOOLEAN DEFAULT FALSE,

    -- Metadata
    exif_data JSONB,
    file_size INTEGER,
    width INTEGER,
    height INTEGER,

    -- Soft delete
    deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_photos_user_taken ON photos(user_id, taken_at DESC);
CREATE INDEX idx_photos_location ON photos USING GIST(ll_to_earth(latitude, longitude));
CREATE INDEX idx_photos_filters ON photos(user_id, is_food, is_document) WHERE deleted_at IS NULL;
```

### photo_analysis
```sql
CREATE TABLE photo_analysis (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE UNIQUE,

    -- Vision AI output
    description_full TEXT NOT NULL, -- descrizione completa
    description_short VARCHAR(200), -- 1 frase per thumbnail

    -- Extracted content
    extracted_text TEXT, -- OCR completo
    detected_objects TEXT[], -- ["pizza", "tavolo", "persona"]
    detected_faces INTEGER DEFAULT 0,

    -- Classification
    scene_category VARCHAR(50), -- "food", "document", "receipt", "outdoor", "indoor", "people"
    scene_subcategory VARCHAR(50), -- "restaurant", "home_cooking", "street_food"

    -- Tags (multi-language)
    tags_it TEXT[], -- ["cibo", "pizza", "ristorante"]
    tags_en TEXT[], -- ["food", "pizza", "restaurant"]

    -- Structured data extraction (per documenti/scontrini)
    structured_data JSONB, -- {"total": 47.50, "merchant": "Esselunga", "items": [...]}

    -- Search vectors
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('italian', COALESCE(description_full, '')), 'A') ||
        setweight(to_tsvector('italian', COALESCE(extracted_text, '')), 'B') ||
        setweight(to_tsvector('italian', COALESCE(array_to_string(tags_it, ' '), '')), 'C')
    ) STORED,

    -- Embeddings
    embedding vector(384), -- paraphrase-multilingual-MiniLM-L12-v2

    -- Metadata
    model_version VARCHAR(50),
    processing_time_ms INTEGER,
    confidence_score DECIMAL(3, 2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indici per ricerca velocissima
CREATE INDEX idx_analysis_search ON photo_analysis USING GIN(search_vector);
CREATE INDEX idx_analysis_tags ON photo_analysis USING GIN(tags_it);
CREATE INDEX idx_analysis_objects ON photo_analysis USING GIN(detected_objects);
CREATE INDEX idx_analysis_category ON photo_analysis(scene_category, scene_subcategory);
CREATE INDEX idx_analysis_embedding ON photo_analysis USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
```

### search_history (per migliorare col tempo)
```sql
CREATE TABLE search_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),

    query_text TEXT NOT NULL,
    query_embedding vector(384),

    -- Risultati
    results_count INTEGER,
    top_photo_id UUID REFERENCES photos(id),

    -- User feedback
    clicked_photo_id UUID REFERENCES photos(id), -- quale ha cliccato
    was_relevant BOOLEAN, -- thumb up/down

    search_time_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_search_user_time ON search_history(user_id, created_at DESC);
```

### collections (album intelligenti)
```sql
CREATE TABLE collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id),

    name VARCHAR(255) NOT NULL,
    description TEXT,

    -- Auto-collection rules
    is_smart BOOLEAN DEFAULT FALSE,
    rules JSONB, -- {"scene_category": "food", "date_range": [...]}

    -- Visual
    cover_photo_id UUID REFERENCES photos(id),
    color_theme VARCHAR(7), -- hex color

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE collection_photos (
    collection_id UUID REFERENCES collections(id) ON DELETE CASCADE,
    photo_id UUID REFERENCES photos(id) ON DELETE CASCADE,
    added_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (collection_id, photo_id)
);
```

---

## 🎨 UX/UI - "Magia Invisibile"

### Principi Design
1. **Zero Learning Curve** - apri e funziona, nessun tutorial
2. **Gesture-First** - tutto a portata di pollice
3. **Voice-Native** - parla invece di digitare
4. **Predictive** - anticipa cosa vuoi fare
5. **Beautiful** - animazioni fluide, transizioni naturali

### Schermata Principale - "Timeline Infinita"

```
┌─────────────────────────┐
│  🔍  [Cerca o chiedi]   │ ← Voice input, tap per keyboard
├─────────────────────────┤
│                         │
│  📅 Oggi                │
│  ┌──┬──┬──┐            │
│  │  │  │  │  3 foto    │ ← Thumbnail, tap = fullscreen
│  └──┴──┴──┘            │
│                         │
│  📅 Ieri                │
│  ┌──┬──┬──┬──┐         │
│  │  │  │  │  │  4 foto │
│  └──┴──┴──┴──┘         │
│                         │
│  📅 Questa settimana    │
│  ┌──┬──┐               │
│  │  │  │  "Pizza Da    │ ← Smart caption da AI
│  └──┴──┘    Mario"     │
│                         │
│  ⋮ [infinite scroll]    │
│                         │
└─────────────────────────┘
   [🏠] [📸] [💭] [⚙️]    ← Bottom nav
```

**Gestures:**
- **Pull down** → refresh/sync
- **Swipe left su foto** → delete
- **Swipe right su foto** → favorite/star
- **Long press** → multi-select mode
- **Pinch** → grid size (2-6 colonne)
- **Double tap** → zoom

### Schermata Camera - "Instant Intelligence"

```
┌─────────────────────────┐
│ ← [Flash] [⚡HDR] [⚙]   │
│                         │
│                         │
│    [LIVE PREVIEW]       │
│                         │
│  ┌─────────────────┐   │
│  │ "MENU PIZZERIA" │   │ ← OCR real-time overlay
│  │  MARGHERITA €12 │   │    (opzionale, toggle)
│  └─────────────────┘   │
│                         │
│   🏷️ "Cibo • Menu"     │ ← AI detection real-time
│                         │
├─────────────────────────┤
│  [📷] Scatta            │ ← Gigante, centrale
│  [🎤] "Fai foto menu"   │ ← Voice shutter
│  [🖼️] Galleria          │
└─────────────────────────┘
```

**Features:**
- **Smart shutter** - rileva quando inquadri qualcosa e suggerisce scatto
- **Voice commands**:
  - "Fai una foto" → scatta
  - "Menu" → scatta + tag come "document"
  - "Pizza" → scatta + tag "food"
- **Live OCR** - mostra testo in overlay (toggle on/off)
- **Live classification** - "Rilevato: Cibo • Ristorante"

### Schermata Ricerca - "Conversazionale"

```
┌─────────────────────────┐
│ 🎤 Cosa cerchi?         │ ← Auto-focus
├─────────────────────────┤
│                         │
│ Suggerimenti:           │
│ • Quando ho mangiato    │
│   pizza?                │
│ • Mostrami foto di ieri │
│ • Tutti i documenti     │
│ • Foto con persone      │
│                         │
│ Ricerche recenti:       │
│ • scontrini Esselunga   │
│ • ricette cucina        │
│                         │
│ Categorie:              │
│ [🍕 Cibo] [📄 Documenti]│
│ [🌍 Viaggi] [👥 Persone]│
└─────────────────────────┘
```

**Durante ricerca:**
```
┌─────────────────────────┐
│ "quando ho mangiato     │
│  pizza?"                │
│  🔍 Ricerca...          │ ← Animazione
├─────────────────────────┤
│ 💡 Risposta:            │
│ "Hai mangiato pizza     │
│  il 15 gennaio 2024     │
│  alle 19:30 alla        │
│  Pizzeria Da Mario"     │
│                         │
│  ┌──────────┐           │
│  │  [FOTO]  │           │ ← Risultato principale
│  │  Pizza   │           │
│  └──────────┘           │
│  📅 15 gen, 19:30       │
│  📍 Pizzeria Da Mario   │
│                         │
│ Altre foto simili: (3)  │
│  [▢] [▢] [▢]           │
└─────────────────────────┘
```

### Schermata Dettaglio Foto - "Tutto a Portata"

```
┌─────────────────────────┐
│ ← [⭐] [🔗] [🗑] [⋮]    │
├─────────────────────────┤
│                         │
│                         │
│     [FOTO GRANDE]       │
│                         │
│   [Pinch to zoom]       │
│                         │
├─────────────────────────┤
│ 💬 "Pizza margherita    │
│     su tavolo in        │
│     ristorante..."      │ ← AI description
│                         │
│ 📝 Testo:               │
│ "PIZZERIA DA MARIO      │
│  Menu - Margherita €12" │ ← OCR extracted
│  [📋 Copia testo]       │
│                         │
│ 🏷️ Tags:                │
│ #cibo #pizza #ristorante│
│                         │
│ 🎯 Oggetti:             │
│ Pizza • Tavolo • Vino   │
│                         │
│ 📅 15 gennaio 2024      │
│ 🕐 19:30                │
│ 📍 Pizzeria Da Mario    │
│     Via Roma 123        │
│     [🗺️ Mappa]         │
│                         │
│ 💭 Chiedi qualcosa:     │
│ [Quanto costava?]       │
│ [Che tipo di vino?]     │
│ [Ricetta pizza?]        │ ← Quick actions
└─────────────────────────┘
```

**Quick Actions:**
- Tap su testo → copia automaticamente
- Tap su tag → cerca foto simili
- Tap su oggetto → "mostrami altre foto con pizza"
- Tap su mappa → apri Google Maps
- Swipe up → mostra foto simili

### Widget Android - "Instant Search"

```
┌─────────────────┐
│ Photo Memory    │
│                 │
│ 🎤 Cerca...     │ ← Tap = voce
│ ┌─┬─┬─┐         │
│ │ │ │ │ Recenti │ ← 3 foto più recenti
│ └─┴─┴─┘         │
└─────────────────┘
```

Tap voce → registra query → apri app con risultati

---

## ⚡ Ottimizzazioni Velocità - "Istantaneo"

### 1. Tier Multi-Level Processing

```
Upload foto
    ↓
┌─────────────────────┐
│ INSTANT (0-500ms)   │ ← On-device/server veloce
│ • EXIF extraction   │
│ • Thumbnail gen     │
│ • Hash duplicate    │
│ • ML Kit OCR lite   │
│ • TFLite objects    │
└─────────────────────┘
    ↓ (user vede subito foto in galleria)
┌─────────────────────┐
│ FAST (1-3s)         │ ← Moondream 2B
│ • Quick description │
│ • Scene category    │
│ • Main objects      │
│ • Basic tags        │
└─────────────────────┘
    ↓ (UI si aggiorna, ricerca già funziona)
┌─────────────────────┐
│ DEEP (5-10s)        │ ← Llama 3.2 Vision 11B
│ • Full description  │
│ • PaddleOCR         │
│ • Embeddings        │
│ • Structured data   │
└─────────────────────┘
    ↓ (analisi completa per ricerche complesse)
```

**Risultato**: Utente vede foto in <500ms, può cercarla in 3s, analisi completa in 10s.

### 2. Quantizzazione Modelli

```python
# Llama 3.2 Vision 11B
# • FP16: 22GB VRAM, 800ms/foto
# • 8-bit: 11GB VRAM, 900ms/foto ← Good balance
# • 4-bit: 6GB VRAM, 1200ms/foto ← Per GPU piccole

# Moondream V2 2B
# • 4-bit: 1.5GB VRAM, 200ms/foto ← Instant tier
```

### 3. Caching Aggressivo

```python
# Redis cache layers
L1_CACHE = "analysis:{photo_hash}" # analisi completa, TTL=forever
L2_CACHE = "search:{query_hash}" # risultati ricerca, TTL=1h
L3_CACHE = "embedding:{text_hash}" # embeddings, TTL=forever
```

### 4. Batch Processing

```python
# Invece di 10 foto = 10 chiamate Vision API
# → 1 chiamata con 10 immagini = 5x più veloce
batch_photos = photos[:10]
results = vision_model.batch_analyze(batch_photos)
```

### 5. Pre-processing On-Device

```kotlin
// Android app fa pre-processing locale
// Prima di upload → riduce latenza server
fun preprocessPhoto(bitmap: Bitmap): ProcessedPhoto {
    return ProcessedPhoto(
        thumbnail128 = bitmap.resize(128),
        thumbnail512 = bitmap.resize(512),
        exif = bitmap.extractExif(),
        hash = bitmap.perceptualHash(),
        quickOCR = MLKit.extractText(bitmap), // 200ms
        quickObjects = TFLite.detectObjects(bitmap) // 300ms
    )
}
```

### 6. WebSocket per Updates Real-time

```kotlin
// Invece di polling per status analisi
// → WebSocket push quando ready
websocket.on("photo_analyzed") { event ->
    val analysis = event.data
    updateUI(analysis)
}
```

### 7. Prefetching Intelligente

```python
# Quando user apre foto #5
# → prefetch analisi di foto #4 e #6
# → prefetch foto simili
# → preload embeddings vicini
```

---

## 🚀 Features Innovative - "Ultrathink"

### 1. **Voice-First Photography**

```
User: "Fai una foto del menu"
App:
  → Attiva camera
  → Inquadra automaticamente documento
  → Aspetta stabilizzazione
  → SCATTA
  → Analizza
  → "Ho salvato il menu. Costa €12 la Margherita."
```

**Implementation:**
- Android SpeechRecognizer
- Intent parsing: "fai foto" + "menu" → trigger camera + tag "document"
- Auto-focus su testo (ML Kit text detection)
- Auto-shutter quando stabile

### 2. **Smart Collections Auto-Generate**

```python
# Ogni notte, background job analizza foto
# → Crea album intelligenti automatici

collections = [
    "Tutti i piatti fotografati" (food),
    "Documenti e ricevute" (documents),
    "Viaggi a Milano" (geo clustering),
    "Colazioni" (food + time 7-10am),
    "Cene al ristorante" (food + restaurant + time 19-23),
    "Scontrini Esselunga" (OCR match "Esselunga"),
]
```

**UI:**
```
┌─────────────────────────┐
│ 💡 Nuova raccolta!      │
│                         │
│ "Cene al Ristorante"    │
│ Ho trovato 23 foto      │
│ [Vedi] [Ignora]         │
└─────────────────────────┘
```

### 3. **Live Camera Intelligence**

Mentre inquadri, prima ancora di scattare:

```
┌─────────────────────────┐
│                         │
│    [LIVE VIEW]          │
│                         │
│  ┌─────────────┐        │
│  │ DETECTED    │        │
│  │ • Menu      │        │
│  │ • €12.50    │        │ ← Live OCR
│  │ • Pizza     │        │
│  └─────────────┘        │
│                         │
│ 💡 Suggerimento:        │
│ Inquadra meglio il      │
│ prezzo per OCR preciso  │
└─────────────────────────┘
```

Usa ML Kit on-device (gratis, veloce 60fps)

### 4. **Duplicate Detection Smart**

```python
# Hai fotografato stesso piatto da 3 angoli?
# → App rileva duplicati semantici

duplicates = detect_similar_photos(
    time_window=10_minutes,
    visual_similarity > 0.85,
    same_scene_category
)

# UI mostra:
"Ho trovato 3 foto simili. Vuoi tenere solo la migliore?"
[Mostra le 3] [Auto-select best] [Tieni tutte]
```

### 5. **Natural Language Actions**

Non solo ricerca, ma azioni:

```
User: "cancella tutte le foto sfocate"
App: → Analizza blur score → Chiede conferma → Elimina

User: "crea album con tutti i viaggi"
App: → Clustering geo + date → Genera album

User: "esporta tutti gli scontrini di gennaio in PDF"
App: → Filtra by OCR + date → PDF con tabella

User: "quanto ho speso in totale questo mese?"
App: → Estrae importi da scontrini → Somma → "€347.50"
```

### 6. **Contextual Quick Actions**

App capisce contesto e suggerisce azioni:

```
Foto rilevata: Scontrino
Quick actions:
  [💰 Aggiungi a spese]
  [📊 Vedi totale mese]
  [📋 Copia importo]

Foto rilevata: Ricetta
Quick actions:
  [👨‍🍳 Salva ricetta]
  [🛒 Lista ingredienti]
  [⏲️ Imposta timer]

Foto rilevata: Biglietto da visita
Quick actions:
  [📱 Salva contatto]
  [📧 Invia email]
  [💼 Aggiungi a LinkedIn]
```

### 7. **Timeline Stories Auto-Generated**

```python
# Ogni domenica, genera "story" della settimana
story = generate_weekly_story(user_photos)

# Output:
"Questa settimana hai:
 • Mangiato pizza 2 volte (Lunedì e Venerdì)
 • Speso €147 in supermercato
 • Visitato 3 nuovi ristoranti
 • Fotografato 12 documenti

 [📸 Rivedi highlights] [📊 Statistiche]"
```

### 8. **Offline-First con Sync Intelligente**

```python
# App funziona 100% offline
# Quando torna online:

sync_strategy = {
    "wifi": "full_resolution_upload + full_analysis",
    "4g_unlimited": "compressed_upload + quick_analysis",
    "4g_limited": "thumbnail_only + defer_analysis",
    "offline": "local_analysis_only"
}
```

### 9. **Gesture Shortcuts Power User**

```
Swipe down from top → Voice search
Swipe up from bottom → Camera
3-finger tap → "Find similar"
Shake → Undo last delete
Double-tap status bar → Jump to today
```

### 10. **Predictive Loading**

```python
# ML model predice cosa user cercherà
# Basato su:
# - Ora del giorno (sera → cerca cibo)
# - Giorno settimana (lunedì → documenti lavoro)
# - Location (in supermercato → lista spesa)
# - Pattern storici

if hour == 19 and location == "restaurant":
    preload_cache("food photos recent")
    preload_suggestions(["Quanto ho speso stasera?", "Mostra foto cibo"])
```

### 11. **Cross-Photo Intelligence**

```
User fotografa:
  1. Menu ristorante
  2. Piatto pizza
  3. Scontrino €35

App auto-link le 3 foto:
"Ho collegato 3 foto della tua cena:
 • Menu Pizzeria Da Mario
 • Pizza Margherita
 • Conto €35

 [Crea evento "Cena Da Mario"]"
```

### 12. **Live Translation Overlay**

```
# Camera punta a menu in inglese
# → OCR real-time
# → Traduzione IT in overlay
# → Sovrapposto sulla preview

[LIVE CAMERA]
  Menu
  ┌──────────────────┐
  │ Margherita Pizza │ → "Pizza Margherita"
  │ €12              │ → "€12"
  │ Fresh mozzarella │ → "Mozzarella fresca"
  └──────────────────┘
```

---

## 🎨 Design System - "Material You + Custom"

### Color Palette Dinamica

```kotlin
// Estrai colore dominante da ultima foto
val dominantColor = photos.last().extractDominantColor()

// Applica a UI (Material You style)
MaterialTheme(
    colorScheme = dynamicColorScheme(dominantColor),
    // UI si adatta al contenuto
)
```

### Animazioni Fluide

```kotlin
// Ogni transizione è naturale, mai brusca
AnimatedContent(
    transitionSpec = {
        fadeIn(tween(300)) + slideInVertically() with
        fadeOut(tween(300)) + slideOutVertically()
    }
)

// Esempio: Tap foto thumbnail → fullscreen
SharedElement(photo) {
    // Thumbnail si espande fluido a fullscreen
    // Hero animation tipo iOS Photos
}
```

### Typography Dinamica

```kotlin
// Testo descrizioni adatta size a lunghezza
description.adaptiveTextSize(
    short = 18.sp,    // <50 char
    medium = 16.sp,   // 50-100 char
    long = 14.sp      // >100 char
)
```

### Haptic Feedback Contestuale

```kotlin
// Ogni azione ha feedback tattile appropriato
onPhotoDelete() -> vibrate(HapticPattern.WARNING)
onPhotoSaved() -> vibrate(HapticPattern.SUCCESS)
onSearchResult() -> vibrate(HapticPattern.LIGHT_TICK)
```

---

## 🔧 Hardware Requirements

### Server/PC per Self-Hosting

#### Tier 1: "Budget" (Funziona, non velocissimo)
- **CPU**: Intel i5 / Ryzen 5 (6+ core)
- **RAM**: 16GB
- **GPU**: **NESSUNA** (CPU-only mode)
- **Storage**: 256GB SSD + 1TB HDD
- **Modelli**:
  - Moondream V2 2B (quantized 4-bit)
  - PaddleOCR
  - MiniLM embeddings
- **Performance**: ~5-8s per foto
- **Costo**: ~€400 (PC usato) o gratis se hai già PC
- **Consumo**: ~100W

#### Tier 2: "Ideale" (Fast & Smooth) ⭐ CONSIGLIATO
- **CPU**: Intel i7 / Ryzen 7
- **RAM**: 32GB
- **GPU**: NVIDIA RTX 3060 12GB o RTX 4060 Ti 16GB
- **Storage**: 512GB NVMe + 2TB HDD
- **Modelli**:
  - Llama 3.2 Vision 11B (8-bit)
  - Moondream V2 (fallback veloce)
  - PaddleOCR
- **Performance**: ~1-2s per foto
- **Costo**: ~€1,000 (nuovo) o €600 (usato)
- **Consumo**: ~250W

#### Tier 3: "Enthusiast" (Ultra-Fast)
- **CPU**: Intel i9 / Ryzen 9
- **RAM**: 64GB
- **GPU**: RTX 4080 16GB o RTX 4090 24GB
- **Storage**: 1TB NVMe + 4TB HDD
- **Modelli**:
  - Llama 3.2 Vision 11B (FP16)
  - CogVLM (17B per casi complessi)
  - Batch processing
- **Performance**: ~500ms per foto
- **Costo**: ~€2,500+

#### Tier 4: "Budget Cloud" (No hardware tuo)
- **Hetzner Cloud GPU**: CAX41 (16 vCPU, 32GB RAM, RTX 4000)
- **Costo**: €45/mese
- **Pro**: No hardware tuo, sempre online
- **Contro**: Costo ricorrente

### Android Device
- **Minimo**: Android 10+, 4GB RAM
- **Ideale**: Android 13+, 8GB RAM, camera decente
- **Opzionale**: NPU per on-device ML (Google Tensor, Snapdragon 8 Gen2+)

---

## 💰 Costi Reali

### Setup Iniziale (One-time)
- **Server Tier 2**: €1,000 (o €0 se usi PC esistente)
- **Dominio** (opzionale): €10/anno
- **Zero costi API**: €0 ✅

### Costi Ricorrenti
- **Elettricità**: ~€15/mese (250W × 24h × €0.25/kWh)
  - Ottimizzato: €5/mese (spegni quando non usi)
- **Internet**: €0 (già lo hai)
- **Totale**: **€5-15/mese** vs €45/mese API cloud

### ROI
- Cloud API approach: €45/mese = €540/anno
- Self-hosted: €1,000 + €180/anno elettricità
- **Break-even**: 2 anni
- **Dopo 5 anni**: Risparmi €1,700

---

## 📦 Docker Compose Setup

```yaml
# docker-compose.yml
version: '3.8'

services:
  # Backend API
  api:
    build: ./backend
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/photomemory
      - REDIS_URL=redis://redis:6379
      - OLLAMA_HOST=http://ollama:11434
      - MINIO_ENDPOINT=minio:9000
    depends_on:
      - db
      - redis
      - ollama
      - minio
    volumes:
      - ./uploads:/app/uploads
    restart: unless-stopped

  # Ollama - Vision Models
  ollama:
    image: ollama/ollama:latest
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    environment:
      - OLLAMA_NUM_PARALLEL=2
      - OLLAMA_MAX_LOADED_MODELS=2
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: 1
              capabilities: [gpu]
    restart: unless-stopped

  # PostgreSQL + Extensions
  db:
    image: pgvector/pgvector:pg16
    environment:
      - POSTGRES_DB=photomemory
      - POSTGRES_USER=user
      - POSTGRES_PASSWORD=pass
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./init.sql:/docker-entrypoint-initdb.d/init.sql
    ports:
      - "5432:5432"
    restart: unless-stopped

  # Redis Cache
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
    restart: unless-stopped

  # MinIO Object Storage
  minio:
    image: minio/minio
    ports:
      - "9000:9000"
      - "9001:9001" # Console
    environment:
      - MINIO_ROOT_USER=admin
      - MINIO_ROOT_PASSWORD=password
    volumes:
      - minio_data:/data
    command: server /data --console-address ":9001"
    restart: unless-stopped

  # Celery Worker (async tasks)
  worker:
    build: ./backend
    command: celery -A app.worker worker --loglevel=info
    environment:
      - DATABASE_URL=postgresql://user:pass@db:5432/photomemory
      - REDIS_URL=redis://redis:6379
      - OLLAMA_HOST=http://ollama:11434
    depends_on:
      - db
      - redis
      - ollama
    volumes:
      - ./uploads:/app/uploads
    restart: unless-stopped

  # Nginx Reverse Proxy
  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - api
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
  minio_data:
  ollama_data:
```

### Quick Start

```bash
# 1. Clone repo
git clone https://github.com/alphagold/photo-memory-selfhosted
cd photo-memory-selfhosted

# 2. Avvia tutto
docker-compose up -d

# 3. Download modelli Vision
docker exec -it ollama ollama pull llama3.2-vision:11b
docker exec -it ollama ollama pull moondream

# 4. Setup database
docker exec -it db psql -U user -d photomemory -f /init.sql

# 5. Test
curl http://localhost:8000/health
# {"status": "ok", "ollama": "connected"}

# 6. Apri app Android, configura server IP
# Settings → Server: http://192.168.1.100:8000
```

**Fatto! Sistema pronto.**

---

## 🎯 Implementation Roadmap

### FASE 0: Setup Infra (Giorno 1-2)
- [ ] Docker Compose setup
- [ ] PostgreSQL + pgvector + extensions
- [ ] Ollama + download Llama 3.2 Vision + Moondream
- [ ] Redis + MinIO
- [ ] Test modelli Vision con foto di esempio
- [ ] Nginx reverse proxy

**Deliverable**: Infra funzionante, modelli Vision rispondono

### FASE 1: Backend MVP (Settimana 1)
- [ ] FastAPI project setup
- [ ] User auth (JWT)
- [ ] Upload endpoint (multipart)
- [ ] Celery task queue setup
- [ ] Vision analysis task:
  - Moondream quick (1-2s)
  - Llama Vision deep (5-10s)
  - PaddleOCR
- [ ] Embedding generation (sentence-transformers)
- [ ] Save to PostgreSQL
- [ ] Basic search endpoint (full-text + vector)

**Deliverable**: API che accetta foto e le analizza

### FASE 2: Android App Base (Settimana 2)
- [ ] Kotlin + Compose project
- [ ] Material 3 theme
- [ ] Login/Register screens
- [ ] Camera con CameraX
- [ ] Photo picker (gallery)
- [ ] Upload service (Ktor)
- [ ] Timeline view (LazyColumn)
- [ ] Photo detail screen
- [ ] Room database (offline cache)

**Deliverable**: App Android che scatta, carica, mostra foto

### FASE 3: Search Intelligence (Settimana 3)
- [ ] Backend: NLP query parsing (spaCy italiano)
- [ ] Backend: Hybrid search (FTS + vector + filters)
- [ ] Backend: Query understanding:
  - Temporal: "ieri", "settimana scorsa", "gennaio"
  - Category: "cibo", "documenti", "persone"
  - Intent: "quando", "mostrami", "trova"
- [ ] Android: Search screen con voice
- [ ] Android: Search suggestions
- [ ] Android: Results con relevance score
- [ ] WebSocket per real-time updates

**Deliverable**: Ricerca "quando ho mangiato pizza?" funziona

### FASE 4: UX Polish (Settimana 4)
- [ ] Gesture navigation (swipe, long-press, pinch)
- [ ] Animazioni hero (thumbnail → fullscreen)
- [ ] Haptic feedback
- [ ] Voice commands camera
- [ ] Live OCR overlay (ML Kit)
- [ ] Quick actions contestuali
- [ ] Widget Android
- [ ] Dark mode dinamico
- [ ] Adaptive color scheme

**Deliverable**: App fluida e bella

### FASE 5: Intelligence Features (Settimana 5)
- [ ] Smart collections auto-generate
- [ ] Duplicate detection
- [ ] Cross-photo linking
- [ ] Natural language actions
- [ ] Weekly story generation
- [ ] Structured data extraction (scontrini)
- [ ] Predictive loading
- [ ] Offline-first sync

**Deliverable**: Features "wow"

### FASE 6: Performance & Deploy (Settimana 6)
- [ ] Backend: Caching ottimizzato
- [ ] Backend: Batch processing
- [ ] Backend: Model quantization testing
- [ ] Android: Image compression
- [ ] Android: Lazy loading
- [ ] Android: Background sync
- [ ] Monitoring (Prometheus + Grafana)
- [ ] Backup automation
- [ ] SSL/HTTPS setup
- [ ] Performance testing (1000+ foto)

**Deliverable**: Sistema production-ready

---

## 🚀 Beyond MVP - Future Ideas

### Fase 7+: Advanced Features
- [ ] **Face recognition** (local, InsightFace)
  - "Mostrami foto con Marco"
  - Face clustering automatico
- [ ] **Multi-user** con permissioning
  - Family sharing
  - Collaborative albums
- [ ] **Desktop app** (Electron o Tauri)
  - Sync bidirezionale
  - Drag & drop upload
- [ ] **Browser extension**
  - Screenshot → auto-save
  - Right-click image → save to PhotoMemory
- [ ] **Smart reminders**
  - "Oggi 1 anno fa..."
  - "Scadenza documento" (se OCR rileva date)
- [ ] **Voice assistant integration**
  - "Ok Google, chiedi a PhotoMemory quando ho mangiato pizza"
- [ ] **Export professionale**
  - PDF reports con tabelle
  - Excel export scontrini
  - Photobook auto-generated
- [ ] **Advanced analytics**
  - "Ho speso €X in cibo questo mese"
  - "Ho visitato Y ristoranti"
  - "Piatto più fotografato"
- [ ] **Plugins system**
  - Community può estendere
  - Custom Vision models
  - Custom export formats

---

## 📊 Success Metrics

### Performance
- Photo upload: <500ms (to show in gallery)
- Quick analysis (Moondream): <2s
- Deep analysis (Llama Vision): <10s
- Search query: <1s
- UI transitions: 60fps
- Cache hit rate: >70%

### Quality
- OCR accuracy: >95% (printed text)
- Object detection: >85% (main objects)
- Scene classification: >90%
- Search relevance: >85% (user clicks top 3)
- Zero crash rate: <0.1%

### UX
- Time to first photo: <10s (from app install)
- Time to first search: <20s
- User retention: >60% (1 week)
- Daily active usage: >3 searches/day
- Net Promoter Score: >50

---

## 🤔 FAQ

### Q: Funziona senza internet?
**A**: Sì! App Android funziona 100% offline con analisi on-device (ML Kit OCR + TFLite). Sincronizza quando torna online.

### Q: Serve GPU obbligatoriamente?
**A**: No, funziona anche CPU-only (più lento ~8s/foto vs 2s). Ma GPU è fortemente raccomandata.

### Q: Posso usare da più dispositivi?
**A**: Sì, installa app su più phone/tablet, tutti sincronizzano con stesso server.

### Q: Privacy delle foto?
**A**: 100% tuo controllo. Foto mai inviate a terzi. Restano sul tuo server. Puoi anche criptare storage.

### Q: Quanto storage serve?
**A**: ~5MB per foto (originale + thumbnails + metadata). 1000 foto = ~5GB.

### Q: Posso migrare da Google Photos?
**A**: Sì, tool di import (Google Takeout → batch upload con date preservation).

### Q: Accuracy Vision AI vs Cloud API?
**A**: Llama 3.2 Vision è quasi pari a GPT-4V per molti task. PaddleOCR migliore di Tesseract. Per uso personale è più che sufficiente.

### Q: E se voglio provare senza installare server?
**A**: Demo online disponibile (hosted su mio server per testing) - ma poi self-host per privacy.

---

## 💡 Final Thoughts

Questa non è solo "un'app per foto". È:

1. **Un secondo cervello** - ricorda tutto quello che fotografi
2. **Privacy-first** - dati tuoi, sempre
3. **Zero lock-in** - codice open, dati esportabili
4. **Beautiful** - UX da sogno, non compromessi
5. **Fast** - istantaneo, non aspetti
6. **Smart** - AI che capisce davvero

**La differenza con Google Photos?**
- Google: Foto nel cloud → privacy? → lock-in → costi
- Noi: Foto tue → controllo totale → gratis → open source

**La differenza con altre app OCR?**
- Altri: Solo testo → keyword search → limitato
- Noi: Vision completa → linguaggio naturale → infinito

---

**Prossimi Step:**

Vuoi che inizi con:
1. **Setup Docker infra** - preparo tutto il backend
2. **Backend MVP** - API con Vision AI funzionante
3. **Android app base** - UI mockup + camera + upload
4. **Full demo** - mostro funzionamento end-to-end

Dimmi e partiamo! 🚀

---

**Versione**: 3.0 - Self-Hosted Revolution
**Data**: 17 Gennaio 2026
**Autore**: Claude Code + alphagold
**License**: MIT (quando pubblichiamo)
