-- Migration 005: Add configurable prompt templates
-- Permette di configurare i prompt AI tramite UI invece di hardcoded

-- Tabella per prompt templates
CREATE TABLE IF NOT EXISTS prompt_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    prompt_text TEXT NOT NULL,
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index per query rapide
CREATE INDEX idx_prompt_templates_active ON prompt_templates(is_active);
CREATE INDEX idx_prompt_templates_default ON prompt_templates(is_default);

-- Insert default prompt (quello attuale strutturato)
INSERT INTO prompt_templates (name, description, prompt_text, is_default, is_active)
VALUES (
    'structured_detailed',
    'Prompt strutturato con sezioni MAIUSCOLE per analisi dettagliate (default)',
    'Analizza questa immagine in modo MOLTO DETTAGLIATO in italiano.{location_hint}

Organizza la tua analisi in queste sezioni (rispetta esattamente i titoli in MAIUSCOLO):

DESCRIZIONE COMPLETA:
[Scrivi almeno 5-6 frasi molto dettagliate descrivendo:
- Il soggetto principale e contesto generale
- Oggetti visibili e loro posizione nello spazio
- Colori dominanti e atmosfera
- Dettagli importanti (materiali, texture, condizioni)
- Se è interno (indoor) o esterno (outdoor)
- Emozioni o sensazioni trasmesse dalla foto]

OGGETTI IDENTIFICATI:
[Lista di 8-12 oggetti/elementi visibili nell''immagine, separati da virgola.
Includi sia oggetti principali che secondari. Es: laptop, tazza, libro, finestra, lampada, mouse, tastiera, quadro, pianta, scrivania]

PERSONE E VOLTI:
[Numero di persone visibili (anche parzialmente). Formato: "N persone" oppure "Nessuna persona visibile".
Se ci sono persone, descrivi brevemente: età approssimativa, posizione, attività]

TESTO VISIBILE:
[Trascrivi ESATTAMENTE eventuali testi, scritte, etichette, insegne visibili nell''immagine.
Se non c''è testo visibile, scrivi: "Nessun testo"]

CATEGORIA SCENA:
[Una sola parola tra: indoor, outdoor, food, document, people, nature, urban, vehicle, other]

TAG CHIAVE:
[5-8 tag descrittivi ad alta confidenza che riassumono l''immagine. Evita tag troppo generici.
Separa con virgola. Es: lavoro, tecnologia, ambiente-moderno, illuminazione-naturale, minimalista]

CONFIDENZA ANALISI:
[Un numero da 0.0 a 1.0 che indica quanto sei sicuro della tua analisi. Es: 0.85]

Importante: scrivi descrizioni lunghe e ricche di dettagli. Non essere sintetico.',
    TRUE,
    TRUE
);

-- Insert alternative simple prompt
INSERT INTO prompt_templates (name, description, prompt_text, is_default, is_active)
VALUES (
    'simple_natural',
    'Prompt semplice e naturale per analisi rapide',
    'Descrivi in italiano cosa vedi in questa immagine.{location_hint}

Includi nella tua descrizione:
- Cosa c''è nell''immagine (oggetti, persone, ambiente)
- Colori e dettagli importanti
- Se è un luogo interno (indoor) o esterno (outdoor)
- Eventuali testi o scritte visibili nell''immagine

Descrivi in modo naturale e dettagliato.',
    FALSE,
    TRUE
);

-- Insert ultra-detailed prompt for slow models
INSERT INTO prompt_templates (name, description, prompt_text, is_default, is_active)
VALUES (
    'ultra_detailed',
    'Prompt estremamente dettagliato per modelli lenti e precisi (llama3.2-vision)',
    'Analizza questa fotografia in modo ESTREMAMENTE DETTAGLIATO in italiano.{location_hint}

Fornisci un''analisi professionale e completa organizzata in sezioni:

DESCRIZIONE DETTAGLIATA COMPLETA:
[Scrivi almeno 8-10 frasi molto dettagliate che coprono:
- Composizione visiva generale e punto di vista fotografico
- Soggetto/i principale/i con descrizione accurata
- Tutti gli oggetti visibili con posizione spaziale precisa
- Palette colori dominanti e secondari
- Illuminazione: tipo di luce, direzione, qualità (naturale/artificiale, dura/morbida)
- Materiali e texture osservabili
- Condizioni e stato degli elementi (nuovo/usato, pulito/sporco, etc)
- Atmosfera emotiva e mood della scena
- Stile fotografico e composizione (inquadratura, prospettiva)]

CATALOGO OGGETTI COMPLETO:
[Lista di TUTTI gli oggetti identificabili (minimo 12-15), separati da virgola.
Includi oggetti principali, secondari e sullo sfondo. Sii specifico: non "lampada" ma "lampada da scrivania LED", non "libro" ma "libro con copertina blu"]

PERSONE E DETTAGLI UMANI:
[Numero esatto di persone. Per ciascuna persona descrivi:
- Età approssimativa e genere
- Abbigliamento e accessori
- Posizione nella scena
- Attività svolta
- Espressione facciale se visibile]

TESTO E SCRITTE:
[Trascrivi TUTTI i testi visibili nell''immagine:
- Testi principali (titoli, insegne)
- Testi secondari (etichette, scritte piccole)
- Numeri e codici se presenti
Se non c''è testo: "Nessun testo visibile"]

ANALISI TECNICA:
[Qualità immagine: risoluzione apparente, nitidezza, esposizione
Tipo di foto: professionale/amatoriale, smartphone/reflex
Condizioni di scatto: luce del giorno/notturna, interno/esterno]

CATEGORIA E SOTTOCATEGORIA:
[Categoria: indoor, outdoor, food, document, people, nature, urban, vehicle, other
Sottocategoria specifica: es. "ufficio moderno", "cucina domestica", "strada cittadina"]

TAG SEMANTICI ESTESI:
[10-12 tag descrittivi ad alta confidenza organizzati per rilevanza.
Include: oggetti principali, stile, mood, contesto, uso della scena.
Es: workspace-moderno, minimalista, tecnologia, produttività, illuminazione-naturale, design-scandinavo]

METADATI CONTESTUALI:
[Ora del giorno stimata, stagione se identificabile, contesto d''uso probabile della scena]

CONFIDENZA ANALISI:
[Numero da 0.0 a 1.0 con spiegazione: es. "0.92 - alta confidenza, immagine nitida e ben illuminata con molti dettagli riconoscibili"]

Importante: questa è un''analisi professionale. Fornisci il massimo livello di dettaglio possibile.',
    FALSE,
    TRUE
);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_prompt_template_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at
CREATE TRIGGER prompt_template_update_timestamp
    BEFORE UPDATE ON prompt_templates
    FOR EACH ROW
    EXECUTE FUNCTION update_prompt_template_updated_at();

-- Comments
COMMENT ON TABLE prompt_templates IS 'Configurable AI prompt templates for photo analysis';
COMMENT ON COLUMN prompt_templates.name IS 'Unique identifier name for the template';
COMMENT ON COLUMN prompt_templates.description IS 'Human-readable description of when to use this template';
COMMENT ON COLUMN prompt_templates.prompt_text IS 'Template text with {variable} placeholders';
COMMENT ON COLUMN prompt_templates.is_default IS 'Whether this is the default template to use';
COMMENT ON COLUMN prompt_templates.is_active IS 'Whether this template is available for use';
