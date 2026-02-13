"""
Ollama Vision AI client for photo analysis
"""
import httpx
import requests  # For large payload compatibility
import base64
import json
import asyncio
from typing import Dict, Optional, List
from pathlib import Path
from config import settings
import time

# Blacklist tag troppo generici
GENERIC_TAGS_BLACKLIST = {
    "oggetto", "cosa", "elemento", "foto", "immagine", "scena",
    "ambiente", "spazio", "luogo", "area", "zona", "parte",
    "vista", "dettaglio", "sezione", "componente"
}


class OllamaVisionClient:
    """Client for Ollama Vision models"""

    def __init__(self, host: str = None, model: str = None):
        self.host = host or settings.OLLAMA_HOST
        self.model = model or settings.OLLAMA_MODEL_FAST
        self.timeout = settings.ANALYSIS_TIMEOUT

    def _encode_image(self, image_path: str) -> str:
        """Encode image to base64"""
        with open(image_path, "rb") as image_file:
            return base64.b64encode(image_file.read()).decode("utf-8")

    async def analyze_photo(
        self,
        image_path: str,
        model: Optional[str] = None,
        detailed: bool = False,
        location_name: Optional[str] = None,
        allow_fallback: bool = True,
        faces_context: Optional[str] = None
    ) -> Dict:
        """
        Analyze photo with Vision AI

        Args:
            image_path: Path to image file
            model: Ollama model to use (default: moondream)
            detailed: Use detailed model (llama3.2-vision) if True
            location_name: Location name from GPS EXIF data (for geo-aware tags)

        Returns:
            Analysis results dict
        """
        start_time = time.time()

        # Select model
        selected_model = model or (
            settings.OLLAMA_MODEL_DEEP if detailed else settings.OLLAMA_MODEL_FAST
        )

        # Encode image
        image_b64 = self._encode_image(image_path)

        # Prepare prompt WITH location context, faces context, and model-specific optimizations
        prompt = self._get_analysis_prompt(location_name=location_name, model=selected_model, faces_context=faces_context)

        # Adjust parameters based on model
        is_qwen = "qwen" in selected_model.lower()

        # Per qwen3-vl: anteponi /no_think per disabilitare reasoning mode
        # Più affidabile del parametro "think": False (funziona con tutte le versioni Ollama)
        if is_qwen:
            prompt = "/no_think\n" + prompt
        # Aumentato num_predict per permettere descrizioni dettagliate (2000 token = ~2500-3000 caratteri)
        num_predict = 2000

        # qwen3-vl: match Modelfile defaults (temp=1, top_p=0.95, top_k=20)
        if is_qwen:
            options = {
                "temperature": 1.0,
                "top_p": 0.95,
                "top_k": 20,
                "num_predict": num_predict,
            }
        else:
            options = {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_predict": num_predict,
            }

        # Use /api/generate for ALL models to avoid context pollution between requests
        # /api/chat can maintain conversation context which causes confusion in batch analysis
        target_url = f"{self.host}/api/generate"
        payload = {
            "model": selected_model,
            "prompt": prompt,
            "images": [image_b64],
            "stream": False,
            "options": options,
            "think": False  # Disabilita reasoning mode (qwen3-vl): response diretta senza thinking
        }

        print(f"[VISION] Request to {self.host} model={selected_model}, image={len(image_b64)//1024}KB")

        def _sync_post():
            """Synchronous POST using requests library with aggressive timeout"""
            from requests.adapters import HTTPAdapter
            from urllib3.util.retry import Retry

            retry_strategy = Retry(
                total=3,
                status_forcelist=[429, 500, 502, 503, 504],
                backoff_factor=1
            )
            adapter = HTTPAdapter(max_retries=retry_strategy)

            with requests.Session() as session:
                session.mount("http://", adapter)
                session.mount("https://", adapter)

                resp = session.post(
                    target_url,
                    json=payload,
                    timeout=(300, self.timeout),
                    headers={"Content-Type": "application/json"}
                )
                resp.raise_for_status()
                return resp.json()

        try:
            # Retry loop: riprova se la risposta è vuota o troppo corta
            # (qwen3-vl a volte ignora /no_think e risponde solo nel campo thinking)
            MAX_ATTEMPTS = 3
            MIN_RESPONSE_LEN = 100  # Risposta valida deve avere almeno 100 chars

            result = None
            analysis_text = ""
            for attempt in range(MAX_ATTEMPTS):
                if attempt > 0:
                    print(f"[VISION] Retry {attempt}/{MAX_ATTEMPTS - 1}")
                    await asyncio.sleep(2)

                result = await asyncio.to_thread(_sync_post)

                # Parse response from /api/generate
                analysis_text = result.get("response", "").strip()

                # Fallback a campo "thinking" se response vuota (qwen3-vl)
                if not analysis_text and "thinking" in result:
                    thinking_text = result.get("thinking", "")
                    has_structured_format = any(kw in thinking_text for kw in [
                        "DESCRIZIONE COMPLETA:", "CATEGORIA SCENA:", "OGGETTI IDENTIFICATI:", "TAG CHIAVE:"
                    ])
                    if has_structured_format:
                        analysis_text = thinking_text

                if len(analysis_text) >= MIN_RESPONSE_LEN:
                    break

            if not analysis_text or len(analysis_text) < MIN_RESPONSE_LEN:
                analysis_text = "Immagine analizzata (dettagli non disponibili da questo modello)"

            processing_time = int((time.time() - start_time) * 1000)
            print(f"[VISION] Completed in {processing_time}ms, response={len(analysis_text)} chars")

            # Parse JSON from response
            analysis_data = self._parse_analysis_response(analysis_text)
            analysis_data["processing_time_ms"] = processing_time
            analysis_data["model_version"] = selected_model

            return analysis_data

        except requests.exceptions.Timeout as e:
            processing_time = int((time.time() - start_time) * 1000)
            print(f"[VISION] Timeout from {self.host}: {e}")
            if not allow_fallback:
                raise
            return self._get_fallback_analysis(processing_time)

        except requests.exceptions.HTTPError as e:
            processing_time = int((time.time() - start_time) * 1000)
            status = e.response.status_code if e.response is not None else "N/A"
            print(f"[VISION] HTTP error from {self.host}: status={status}")
            if not allow_fallback:
                raise
            return self._get_fallback_analysis(processing_time)

        except Exception as e:
            processing_time = int((time.time() - start_time) * 1000)
            print(f"[VISION] Error from {self.host}: {type(e).__name__}: {e}")
            if not allow_fallback:
                raise
            return self._get_fallback_analysis(processing_time)

    def _get_analysis_prompt(self, location_name: Optional[str] = None, model: str = None, faces_context: Optional[str] = None) -> str:
        """Get prompt from database or fallback to hardcoded default"""

        location_hint = f" La foto è stata scattata a {location_name}." if location_name else ""
        faces_hint = f" {faces_context}" if faces_context else ""

        # Try to load prompt from database
        try:
            from database import SessionLocal
            from models import PromptTemplate

            db = SessionLocal()
            try:
                template = db.query(PromptTemplate).filter(
                    PromptTemplate.is_default == True,
                    PromptTemplate.is_active == True
                ).first()

                if template:
                    print(f"[VISION] Using prompt template: {template.name}")
                    prompt_text = template.prompt_text

                    # Sostituisci placeholder se presenti nel template
                    prompt_text = prompt_text.replace("{location_hint}", location_hint)
                    prompt_text = prompt_text.replace("{model}", model or "default")
                    prompt_text = prompt_text.replace("{faces_hint}", faces_hint)

                    # Se il template non conteneva i placeholder, aggiungi contesto alla fine
                    if location_hint and location_hint not in prompt_text:
                        prompt_text += location_hint
                    if faces_hint and faces_hint not in prompt_text:
                        prompt_text += faces_hint

                    if faces_hint or location_hint:
                        print(f"[VISION] Prompt context: location='{location_hint.strip()}', faces='{faces_hint.strip()}'")

                    return prompt_text
                else:
                    print(f"[VISION] No default template found, using hardcoded prompt")
            finally:
                db.close()
        except Exception as e:
            print(f"[VISION] Failed to load prompt from database: {e}, using hardcoded fallback")

        # Fallback hardcoded - descrizione libera in italiano
        print(f"[VISION] Using hardcoded fallback prompt, location='{location_hint.strip()}', faces='{faces_hint.strip()}'")
        return f"IMPORTANTE: Rispondi ESCLUSIVAMENTE in lingua italiana. Non usare inglese.\n\nDescrivi questa immagine nel modo più dettagliato possibile.{location_hint}{faces_hint} Descrivi tutto ciò che vedi: oggetti principali, persone (quante e cosa fanno), colori, atmosfera, ambiente (interno o esterno). Se nell'immagine è presente testo leggibile (scritte, etichette, insegne), trascrivilo esattamente tra virgolette."

    def _validate_analysis_quality(self, analysis: Dict) -> tuple[bool, List[str]]:
        """Valida qualità analisi e restituisce warnings"""

        warnings = []
        is_valid = True

        # Check descrizione lunghezza
        desc_len = len(analysis.get("description_full", ""))
        if desc_len < 200:
            warnings.append(f"Descrizione troppo breve ({desc_len} char, min 200)")
            is_valid = False
        elif desc_len < 400:
            warnings.append(f"Descrizione breve ({desc_len} char, consigliato 500+)")

        # Check oggetti rilevati
        objects = analysis.get("detected_objects", [])
        if len(objects) < 3:
            warnings.append(f"Pochi oggetti rilevati ({len(objects)}, min 3)")

        # Check categoria valida
        valid_categories = ["indoor", "outdoor", "food", "document", "people",
                           "nature", "urban", "vehicle", "other"]
        if analysis.get("scene_category") not in valid_categories:
            warnings.append(f"Categoria non valida: {analysis.get('scene_category')}")
            is_valid = False

        # Check tags
        tags = analysis.get("tags", [])
        if len(tags) < 3:
            warnings.append(f"Pochi tag ({len(tags)}, min 3)")

        # Check confidence
        conf = analysis.get("confidence_score", 0)
        if conf < 0.5:
            warnings.append(f"Confidenza bassa ({conf:.2f})")

        return is_valid, warnings

    def _complete_analysis_dict(self, partial: Dict) -> Dict:
        """Completa dizionario analisi con valori di default per campi mancanti"""
        defaults = {
            "description_full": "Immagine analizzata",
            "description_short": "Foto",
            "extracted_text": None,
            "detected_objects": [],
            "detected_faces": 0,
            "scene_category": "other",
            "scene_subcategory": None,
            "tags": [],
            "confidence_score": 0.5,
        }

        # Merge con defaults
        result = {**defaults, **partial}

        # Genera description_short se mancante
        if "description_short" not in partial and "description_full" in partial:
            import re
            sentences = re.split(r'[.!?]+', partial["description_full"])
            result["description_short"] = sentences[0].strip()[:200] if sentences else "Foto"

        return result

    # Mappa tag inglesi → italiani (il modello a volte risponde in inglese)
    _TAG_TRANSLATIONS = {
        # Categorie
        "nature": "natura", "natural": "natura", "outdoor": "esterno", "outdoors": "esterno",
        "indoor": "interno", "indoors": "interno", "people": "persone", "person": "persona",
        "food": "cibo", "document": "documento", "vehicle": "veicolo", "vehicles": "veicoli",
        "urban": "urbano",
        # Natura
        "sky": "cielo", "tree": "albero", "trees": "alberi", "flower": "fiore",
        "flowers": "fiori", "beach": "spiaggia", "sea": "mare", "ocean": "oceano",
        "mountain": "montagna", "mountains": "montagne", "river": "fiume", "lake": "lago",
        "forest": "foresta", "garden": "giardino", "grass": "erba", "rock": "roccia",
        "cloud": "nuvola", "clouds": "nuvole", "rain": "pioggia", "snow": "neve",
        "sun": "sole", "moon": "luna", "field": "campo", "hill": "collina",
        # Citta/edifici
        "city": "città", "building": "edificio", "buildings": "edifici",
        "road": "strada", "street": "strada", "bridge": "ponte", "tower": "torre",
        "church": "chiesa", "house": "casa", "wall": "muro", "gate": "cancello",
        "park": "parco", "square": "piazza", "sidewalk": "marciapiede",
        # Persone
        "man": "uomo", "woman": "donna", "child": "bambino", "children": "bambini",
        "boy": "ragazzo", "girl": "ragazza", "baby": "neonato", "group": "gruppo",
        "crowd": "folla", "couple": "coppia",
        # Veicoli
        "car": "auto", "bus": "autobus", "truck": "camion", "train": "treno",
        "airplane": "aereo", "plane": "aereo", "boat": "barca", "ship": "nave",
        "bicycle": "bicicletta", "bike": "bicicletta", "motorcycle": "motocicletta",
        # Animali
        "animal": "animale", "animals": "animali", "dog": "cane", "cat": "gatto",
        "bird": "uccello", "birds": "uccelli", "fish": "pesce", "horse": "cavallo",
        # Cibo
        "drink": "bevanda", "drinks": "bevande", "water": "acqua", "wine": "vino",
        "coffee": "caffè", "plate": "piatto", "dish": "piatto", "meal": "pasto",
        "fruit": "frutta", "bread": "pane", "cake": "torta", "glass": "bicchiere",
        "bottle": "bottiglia", "cup": "tazza",
        # Oggetti/interni
        "table": "tavolo", "chair": "sedia", "desk": "scrivania", "bed": "letto",
        "sofa": "divano", "couch": "divano", "lamp": "lampada", "mirror": "specchio",
        "window": "finestra", "door": "porta", "stairs": "scale", "shelf": "scaffale",
        "carpet": "tappeto", "curtain": "tenda", "pillow": "cuscino",
        # Elettronica
        "phone": "telefono", "computer": "computer", "screen": "schermo",
        "keyboard": "tastiera", "camera": "fotocamera", "watch": "orologio",
        "television": "televisore", "tv": "televisore",
        # Abbigliamento
        "shirt": "camicia", "hat": "cappello", "shoes": "scarpe", "bag": "borsa",
        "clothes": "vestiti", "dress": "vestito", "jacket": "giacca",
        # Concetti
        "travel": "viaggio", "family": "famiglia", "friends": "amici", "friend": "amico",
        "sport": "sport", "sports": "sport", "art": "arte", "work": "lavoro",
        "technology": "tecnologia", "tech": "tecnologia", "night": "notte",
        "day": "giorno", "sunset": "tramonto", "sunrise": "alba",
        "landscape": "paesaggio", "portrait": "ritratto", "architecture": "architettura",
        "text": "testo", "sign": "insegna", "light": "luce", "shadow": "ombra",
        "color": "colore", "bright": "luminoso", "dark": "scuro",
        "old": "antico", "new": "nuovo", "modern": "moderno", "ancient": "antico",
        "beautiful": "bello", "small": "piccolo", "large": "grande", "big": "grande",
        "warm": "caldo", "cold": "freddo", "quiet": "tranquillo", "busy": "affollato",
    }

    def _normalize_tags(self, tags: list) -> list:
        """Normalizza tag inglesi in italiano"""
        normalized = []
        for tag in tags:
            lower = tag.strip().lower()
            normalized.append(self._TAG_TRANSLATIONS.get(lower, tag.strip()))
        return normalized

    def _parse_analysis_response(self, response_text: str) -> Dict:
        """Parse Vision AI response - estrae struttura dal testo libero"""

        print(f"[VISION] Parsing response (length: {len(response_text)} chars)")

        result = self._extract_from_text(response_text)
        result = self._complete_analysis_dict(result)

        # Normalizza tag inglesi → italiani
        if result.get("tags"):
            result["tags"] = self._normalize_tags(result["tags"])

        is_valid, warnings = self._validate_analysis_quality(result)
        if warnings:
            print(f"[VISION] Quality warnings: {', '.join(warnings)}")

        return result

    def _extract_from_text(self, text: str) -> Dict:
        """Extract structured data from free-form text response"""
        import re

        # Pulizia markdown completa - LLM spesso genera **bold**, ## headers, elenchi puntati
        text_cleaned = text.strip()
        # Strip **bold** *italic* ***bold-italic***
        text_cleaned = re.sub(r'\*{1,3}([^*\n]*?)\*{1,3}', r'\1', text_cleaned)
        # Strip __underline__ _italic_
        text_cleaned = re.sub(r'_{1,2}([^_\n]*?)_{1,2}', r'\1', text_cleaned)
        # Strip `code`
        text_cleaned = re.sub(r'`([^`]*)`', r'\1', text_cleaned)
        # Strip ## headers
        text_cleaned = re.sub(r'^#{1,4}\s+', '', text_cleaned, flags=re.MULTILINE)
        # Strip sezioni numerate (es: "1. Struttura predominante:")
        text_cleaned = re.sub(r'^\s*\d+\.\s+[^\n:]{1,50}:\s*$', '', text_cleaned, flags=re.MULTILINE)
        # Strip bullet points
        text_cleaned = re.sub(r'^\s*[-•]\s+', '', text_cleaned, flags=re.MULTILINE)
        # Appiattisci struttura: newline → spazio (prosa continua)
        text_cleaned = re.sub(r'\s*\n\s*', ' ', text_cleaned)
        # Rimuovi spazi multipli
        text_cleaned = re.sub(r'\s{2,}', ' ', text_cleaned).strip()
        # Rimuovi trattini/punti iniziali residui
        text_cleaned = text_cleaned.strip(' :-')

        text_lower = text_cleaned.lower()

        description_full = text_cleaned if text_cleaned else "Immagine analizzata"

        # Prima frase come descrizione breve
        sentences = re.split(r'[.!?]+', text_cleaned)
        short_desc = sentences[0].strip()[:200] if sentences and sentences[0].strip() else "Foto"

        # Testo visibile nell'immagine
        # Il modello mette tra virgolette il testo che legge dall'immagine → estraiamo tutto
        extracted_texts = []

        # 1. Tutto il testo tra virgolette doppie (il modello usa le virgolette per testo reale)
        for q in re.findall(r'"([^"]{1,200})"', text_cleaned):
            q = q.strip()
            if q and q not in extracted_texts:
                extracted_texts.append(q)

        # 2. Pattern espliciti di menzione testo (senza virgolette)
        for pattern in [
            r'(?:la scritta|etichetta|label|sticker|riporta)[:\s]+([^\n".]{5,100})',
            r'(?:il testo|testo visibile)[:\s]+([^\n".]{3,100})',
        ]:
            for m in re.finditer(pattern, text_cleaned, re.IGNORECASE):
                t = m.group(1).strip(' :-')
                if t and t not in extracted_texts:
                    extracted_texts.append(t)

        # Se il modello dice esplicitamente che non c'è testo visibile, svuota
        no_text_keywords = ["nessun testo", "non è presente testo", "non ci sono scritte", "no text visible", "no visible text"]
        if any(kw in text_lower for kw in no_text_keywords):
            extracted_texts = []

        extracted_text = '\n'.join(extracted_texts[:20]) if extracted_texts else None

        # Rilevamento categoria con word boundaries (evita match parziali)
        def has_keyword(keywords):
            return any(re.search(rf'\b{re.escape(kw)}\b', text_lower) for kw in keywords)

        food_keywords = ["cibo", "piatto", "pasto", "ristorante", "cucina", "food", "plate", "dish", "meal", "pranzo", "cena", "colazione"]
        doc_keywords = ["documento", "ricevuta", "fattura", "contratto", "certificato", "modulo", "receipt", "invoice", "form"]
        outdoor_keywords = ["esterno", "fuori", "all'aperto", "outdoor", "outside", "strada", "parco", "giardino", "cielo", "paesaggio"]
        indoor_keywords = ["interno", "dentro", "stanza", "ufficio", "indoor", "inside", "room", "office", "soggiorno", "cucina"]
        people_keywords = ["persona", "persone", "gente", "donna", "uomo", "bambino", "ragazzo", "ragazza", "person", "people"]
        nature_keywords = ["foresta", "bosco", "montagna", "collina", "lago", "mare", "spiaggia", "natura", "nature", "prato", "campo"]
        vehicle_keywords = ["automobile", "autobus", "camion", "treno", "aereo", "nave", "bicicletta", "motocicletta"]

        if has_keyword(food_keywords):
            category = "food"
        elif has_keyword(doc_keywords):
            category = "document"
        elif has_keyword(nature_keywords):
            category = "nature"
        elif has_keyword(vehicle_keywords):
            category = "vehicle"
        elif has_keyword(people_keywords):
            category = "people"
        elif has_keyword(outdoor_keywords):
            category = "outdoor"
        elif has_keyword(indoor_keywords):
            category = "indoor"
        else:
            category = "other"

        # Rilevamento oggetti: cerca sia in italiano che in inglese, output sempre in italiano
        # Formato: (keyword_da_cercare, nome_italiano_output)
        _object_patterns = [
            # Elettronica
            ("laptop", "laptop"), ("computer", "computer"), ("telefono", "telefono"),
            ("smartphone", "smartphone"), ("phone", "telefono"), ("tablet", "tablet"),
            ("monitor", "monitor"), ("schermo", "schermo"), ("screen", "schermo"),
            ("tastiera", "tastiera"), ("keyboard", "tastiera"), ("mouse", "mouse"),
            ("cuffie", "cuffie"), ("headphones", "cuffie"), ("stampante", "stampante"),
            ("fotocamera", "fotocamera"), ("camera", "fotocamera"),
            ("orologio", "orologio"), ("watch", "orologio"), ("clock", "orologio"),
            ("televisore", "televisore"), ("television", "televisore"), ("tv", "televisore"),
            # Mobili
            ("tavolo", "tavolo"), ("table", "tavolo"), ("sedia", "sedia"), ("chair", "sedia"),
            ("scrivania", "scrivania"), ("desk", "scrivania"), ("letto", "letto"), ("bed", "letto"),
            ("divano", "divano"), ("sofa", "divano"), ("couch", "divano"),
            ("poltrona", "poltrona"), ("armadio", "armadio"), ("scaffale", "scaffale"),
            ("shelf", "scaffale"), ("libreria", "libreria"), ("bookshelf", "libreria"),
            ("specchio", "specchio"), ("mirror", "specchio"),
            ("lampada", "lampada"), ("lamp", "lampada"), ("finestra", "finestra"), ("window", "finestra"),
            # Cibo
            ("piatto", "piatto"), ("plate", "piatto"), ("dish", "piatto"),
            ("tazza", "tazza"), ("cup", "tazza"), ("bicchiere", "bicchiere"), ("glass", "bicchiere"),
            ("bottiglia", "bottiglia"), ("bottle", "bottiglia"),
            ("pane", "pane"), ("bread", "pane"), ("pizza", "pizza"), ("pasta", "pasta"),
            ("carne", "carne"), ("meat", "carne"), ("verdura", "verdura"),
            ("frutta", "frutta"), ("fruit", "frutta"), ("torta", "torta"), ("cake", "torta"),
            # Natura
            ("albero", "albero"), ("tree", "albero"), ("fiore", "fiore"), ("flower", "fiore"),
            ("pianta", "pianta"), ("plant", "pianta"), ("foglia", "foglia"), ("leaf", "foglia"),
            ("giardino", "giardino"), ("garden", "giardino"),
            ("montagna", "montagna"), ("mountain", "montagna"),
            ("fiume", "fiume"), ("river", "fiume"), ("lago", "lago"), ("lake", "lago"),
            ("mare", "mare"), ("sea", "mare"), ("spiaggia", "spiaggia"), ("beach", "spiaggia"),
            ("roccia", "roccia"), ("rock", "roccia"), ("cielo", "cielo"), ("sky", "cielo"),
            # Veicoli
            ("automobile", "automobile"), ("car", "automobile"),
            ("bicicletta", "bicicletta"), ("bicycle", "bicicletta"), ("bike", "bicicletta"),
            ("motocicletta", "motocicletta"), ("motorcycle", "motocicletta"),
            ("camion", "camion"), ("truck", "camion"),
            ("autobus", "autobus"), ("bus", "autobus"),
            ("treno", "treno"), ("train", "treno"),
            ("aereo", "aereo"), ("airplane", "aereo"), ("plane", "aereo"),
            ("barca", "barca"), ("boat", "barca"),
            # Persone
            ("persona", "persona"), ("person", "persona"),
            ("uomo", "uomo"), ("man", "uomo"), ("donna", "donna"), ("woman", "donna"),
            ("bambino", "bambino"), ("child", "bambino"), ("ragazzo", "ragazzo"), ("boy", "ragazzo"),
            ("ragazza", "ragazza"), ("girl", "ragazza"),
            # Industria/tecnica
            ("macchina", "macchina"), ("motore", "motore"), ("engine", "motore"),
            ("pompa", "pompa"), ("pump", "pompa"), ("tubo", "tubo"), ("pipe", "tubo"),
            ("pannello", "pannello"), ("panel", "pannello"),
            ("interruttore", "interruttore"), ("switch", "interruttore"),
            ("scala", "scala"), ("stairs", "scala"),
            # Altri
            ("libro", "libro"), ("book", "libro"), ("penna", "penna"), ("pen", "penna"),
            ("documento", "documento"), ("edificio", "edificio"), ("building", "edificio"),
            ("casa", "casa"), ("house", "casa"), ("ponte", "ponte"), ("bridge", "ponte"),
            ("cartello", "cartello"), ("sign", "cartello"),
            ("porta", "porta"), ("door", "porta"),
            ("borsa", "borsa"), ("bag", "borsa"),
            ("cappello", "cappello"), ("hat", "cappello"),
        ]

        objects = []
        for keyword, italian_name in _object_patterns:
            if re.search(rf'\b{re.escape(keyword)}\b', text_lower) and italian_name not in objects:
                objects.append(italian_name)
                if len(objects) >= 12:
                    break

        # Rilevamento persone/volti
        # Supporta sia cifre ("2 persone") che parole italiane ("due persone")
        italian_numbers = {
            'una': 1, 'un': 1, 'due': 2, 'tre': 3, 'quattro': 4,
            'cinque': 5, 'sei': 6, 'sette': 7, 'otto': 8, 'nove': 9, 'dieci': 10
        }
        detected_faces = 0
        # Pattern con cifre: "2 persone", "3 volti"
        digit_match = re.search(r'(\d+)\s*(?:persone|persona|volti|volto)', text_lower)
        if digit_match:
            detected_faces = int(digit_match.group(1))
        else:
            # Pattern con parole italiane: "due persone", "una donna", "tre uomini"
            word_match = re.search(
                r'\b(una?|due|tre|quattro|cinque|sei|sette|otto|nove|dieci)\s+'
                r'(?:persone?|volti?|uomin[io]|donn[ae]|bambin[io]|ragazz[io])\b',
                text_lower
            )
            if word_match:
                detected_faces = italian_numbers.get(word_match.group(1), 1)
        if re.search(r'\b(?:nessuna persona|nessun volto|non ci sono persone|nessuna persona visibile)\b', text_lower):
            detected_faces = 0

        # Tag semantici
        tags = []
        if category != "other":
            tags.append(category)
        for obj in objects[:3]:
            if obj not in tags:
                tags.append(obj)
        semantic_keywords = [
            "moderno", "antico", "luminoso", "scuro", "grande", "piccolo",
            "industriale", "professionale", "naturale", "artificiale",
            "tecnologia", "lavoro", "viaggio", "sport", "arte"
        ]
        for kw in semantic_keywords:
            if re.search(rf'\b{re.escape(kw)}\b', text_lower) and kw not in tags:
                tags.append(kw)
                if len(tags) >= 8:
                    break

        # Confidence dinamico
        confidence = 0.5
        if len(description_full) > 300: confidence += 0.1
        if len(description_full) > 600: confidence += 0.1
        if len(objects) >= 5: confidence += 0.1
        if detected_faces > 0: confidence += 0.05
        if extracted_text: confidence += 0.05
        if len(tags) >= 4: confidence += 0.05
        confidence = min(confidence, 0.90)

        return {
            "description_full": description_full[:2000],
            "description_short": short_desc,
            "extracted_text": extracted_text,
            "detected_objects": objects,
            "detected_faces": detected_faces,
            "scene_category": category,
            "scene_subcategory": None,
            "tags": tags,
            "confidence_score": confidence,
        }

    def _get_fallback_analysis(self, processing_time: int) -> Dict:
        """Fallback analysis if Vision AI fails"""
        return {
            "description_full": "Immagine caricata. Analisi non disponibile.",
            "description_short": "Foto caricata",
            "extracted_text": None,
            "detected_objects": [],
            "detected_faces": 0,
            "scene_category": "other",
            "scene_subcategory": None,
            "tags": [],
            "confidence_score": 0.0,
            "processing_time_ms": processing_time,
            "model_version": "fallback",
        }

    async def test_connection(self) -> bool:
        """Test if Ollama is reachable"""
        try:
            async with httpx.AsyncClient(timeout=5) as client:
                response = await client.get(f"{self.host}/api/tags")
                return response.status_code == 200
        except Exception:
            return False


# Global instance
vision_client = OllamaVisionClient()
