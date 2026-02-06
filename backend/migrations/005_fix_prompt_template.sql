-- Fix prompt template: semplifica formato per evitare ripetizioni
-- Esegui questo se il modello AI ripete il prompt invece di analizzare

UPDATE prompt_templates
SET prompt_text = 'Analizza questa immagine in italiano e fornisci informazioni dettagliate.{location_hint}

Rispondi usando ESATTAMENTE questo formato:

DESCRIZIONE COMPLETA:
Scrivi 4-5 frasi che descrivono cosa vedi: soggetto principale, oggetti visibili, colori, atmosfera, se è interno o esterno, dettagli importanti.

OGGETTI IDENTIFICATI:
laptop, mouse, tastiera, tazza, libro, finestra, lampada, scrivania, sedia, telefono
(elenca 8-12 oggetti separati da virgola)

PERSONE E VOLTI:
2 persone
(oppure: Nessuna persona visibile)

TESTO VISIBILE:
Welcome to Italy
(oppure: Nessun testo)

CATEGORIA SCENA:
indoor
(scegli una: indoor, outdoor, food, document, people, nature, urban, vehicle, other)

TAG CHIAVE:
lavoro, tecnologia, ufficio, moderno, professionale
(5-8 tag separati da virgola)

CONFIDENZA ANALISI:
0.85
(numero da 0.0 a 1.0)

Importante: non ripetere queste istruzioni, rispondi solo con le informazioni richieste.',
    updated_at = CURRENT_TIMESTAMP
WHERE name = 'structured_detailed';
