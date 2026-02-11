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
        allow_fallback: bool = True
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

        # Prepare prompt WITH location context and model-specific optimizations
        prompt = self._get_analysis_prompt(location_name=location_name, model=selected_model)

        # Adjust parameters based on model
        is_qwen = "qwen" in selected_model.lower()
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

        print(f"[VISION] Making request to: {target_url} with model: {selected_model}")
        print(f"[VISION] self.host = {self.host!r}")
        print(f"[VISION] Timeout: {self.timeout} seconds")
        print(f"[VISION] Image size: {len(image_b64)} bytes (base64)")
        print(f"[VISION] Prompt length: {len(prompt)} characters")
        print(f"[VISION] Prompt preview (first 200 chars): {prompt[:200]}")
        print(f"[VISION] API endpoint: {target_url.split('/')[-1]}, num_predict={num_predict}")
        payload_size = len(json.dumps(payload))
        print(f"[VISION] Total payload size: {payload_size} bytes ({payload_size/1024/1024:.2f} MB)")

        # Use requests library in thread for better large payload handling
        # httpx has issues with large payloads (4+ MB)
        print(f"[VISION] Using requests library for large payload compatibility...")

        def _sync_post():
            """Synchronous POST using requests library with aggressive timeout"""
            import threading
            from requests.adapters import HTTPAdapter
            from urllib3.util.retry import Retry

            print(f"[VISION] _sync_post called in thread: {threading.current_thread().name}")
            print(f"[VISION] Target URL: {target_url}")
            print(f"[VISION] About to call requests.post()...")

            try:
                # Create session with retry strategy and large timeouts
                session = requests.Session()
                retry_strategy = Retry(
                    total=3,
                    status_forcelist=[429, 500, 502, 503, 504],
                    backoff_factor=1
                )
                adapter = HTTPAdapter(max_retries=retry_strategy)
                session.mount("http://", adapter)
                session.mount("https://", adapter)

                # Timeout: 5 minuti connect, self.timeout (900s) read
                # Necessario per payload grandi (4-8 MB) su rete remota
                resp = session.post(
                    target_url,
                    json=payload,
                    timeout=(300, self.timeout),  # 300s connect/upload, 900s read/analysis
                    headers={"Content-Type": "application/json"}
                )
                print(f"[VISION] requests.post() returned!")
                print(f"[VISION] POST completed, status: {resp.status_code}")
                resp.raise_for_status()
                result = resp.json()
                print(f"[VISION] Response parsed as JSON successfully")
                session.close()
                return result
            except Exception as e:
                print(f"[VISION] ❌ Exception in _sync_post: {type(e).__name__}: {e}")
                raise

        try:
            # Run synchronous requests call in thread pool
            print(f"[VISION] Calling asyncio.to_thread(_sync_post)...")
            result = await asyncio.to_thread(_sync_post)
            print(f"[VISION] asyncio.to_thread() completed!")
            print(f"[VISION] ✅ Response received successfully from {self.host}")

            # Debug: log entire Ollama response structure
            print(f"[VISION] Full Ollama response keys: {list(result.keys())}")
            print(f"[VISION] Full Ollama response: {json.dumps(result, indent=2, ensure_ascii=False)[:2000]}")

            # Parse response from /api/generate (used for all models now)
            analysis_text = result.get("response", "")
            print(f"[VISION] Using /api/generate response format")

            # Fallback to "thinking" field if response is empty
            # BUT ONLY if thinking contains structured format (not just reasoning)
            if not analysis_text.strip() and "thinking" in result:
                thinking_text = result.get("thinking", "")
                print(f"[VISION] ⚠️ Response empty, checking 'thinking' field")
                print(f"[VISION] Thinking field length: {len(thinking_text)} chars")

                # Check if thinking contains structured format (Italian sections)
                has_structured_format = (
                    "DESCRIZIONE DETTAGLIATA:" in thinking_text and
                    "CATEGORIA:" in thinking_text
                )

                if has_structured_format:
                    print(f"[VISION] ✅ Thinking field contains structured format, using it")
                    analysis_text = thinking_text
                else:
                    print(f"[VISION] ⚠️ Thinking field is just reasoning (English), skipping it")
                    print(f"[VISION] Thinking preview: {thinking_text[:200]}")
                    # Use generic fallback - don't fail the whole analysis
                    analysis_text = "Immagine analizzata (dettagli non disponibili da questo modello)"

            processing_time = int((time.time() - start_time) * 1000)
            print(f"[VISION] Analysis completed in {processing_time}ms")
            print(f"[VISION] Response text length: {len(analysis_text)} chars")
            print(f"[VISION] Response text preview: {analysis_text[:500]}")

            # Parse JSON from response
            analysis_data = self._parse_analysis_response(analysis_text)
            analysis_data["processing_time_ms"] = processing_time
            analysis_data["model_version"] = selected_model

            return analysis_data

        except requests.exceptions.Timeout as e:
            processing_time = int((time.time() - start_time) * 1000)
            print(f"[VISION] ❌ Timeout error from {self.host}: {type(e).__name__}: {e}")

            if not allow_fallback:
                print(f"[VISION] Fallback disabled - propagating timeout error")
                raise

            print(f"[VISION] Returning fallback analysis")
            return self._get_fallback_analysis(processing_time)

        except requests.exceptions.HTTPError as e:
            processing_time = int((time.time() - start_time) * 1000)
            print(f"[VISION] ❌ HTTP error from {self.host}: {type(e).__name__}: {e}")
            if e.response is not None:
                print(f"[VISION] Response status: {e.response.status_code}")
                print(f"[VISION] Response body: {e.response.text[:500]}")

            if not allow_fallback:
                print(f"[VISION] Fallback disabled - propagating HTTP error")
                raise

            print(f"[VISION] Returning fallback analysis")
            return self._get_fallback_analysis(processing_time)

        except Exception as e:
            processing_time = int((time.time() - start_time) * 1000)
            print(f"[VISION] ❌ Unexpected error from {self.host}: {type(e).__name__}: {e}")

            if not allow_fallback:
                print(f"[VISION] Fallback disabled - propagating error")
                raise

            print(f"[VISION] Returning fallback analysis")
            return self._get_fallback_analysis(processing_time)

    def _get_analysis_prompt(self, location_name: Optional[str] = None, model: str = None) -> str:
        """Get prompt from database or fallback to hardcoded default"""

        location_hint = f" La foto è stata scattata a {location_name}." if location_name else ""

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
                    prompt_text = template.prompt_text.replace("{location_hint}", location_hint)
                    prompt_text = prompt_text.replace("{model}", model or "default")
                    return prompt_text
                else:
                    print(f"[VISION] No default template found, using hardcoded prompt")
            finally:
                db.close()
        except Exception as e:
            print(f"[VISION] Failed to load prompt from database: {e}, using hardcoded fallback")

        # Fallback hardcoded - descrizione libera, nessuna struttura richiesta
        return f"Descrivi in italiano questa immagine nel modo più dettagliato possibile.{location_hint} Descrivi tutto ciò che vedi: oggetti, persone, colori, atmosfera, ambiente (interno o esterno), e qualsiasi testo visibile."

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

    def _parse_analysis_response(self, response_text: str) -> Dict:
        """Parse Vision AI response - estrae struttura dal testo libero"""

        print(f"[VISION] Parsing response (length: {len(response_text)} chars)")

        result = self._extract_from_text(response_text)
        result = self._complete_analysis_dict(result)

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

        # Rilevamento oggetti con word boundaries (evita falsi positivi da parole composite)
        common_objects = [
            # Elettronica
            "laptop", "computer", "telefono", "smartphone", "tablet", "monitor",
            "schermo", "tastiera", "mouse", "cuffie", "stampante", "fotocamera",
            "orologio", "televisore", "router", "cavo",
            # Mobili (escluso "porta": troppo ambiguo in italiano, è anche verbo comune)
            "tavolo", "sedia", "scrivania", "letto", "divano", "poltrona", "armadio",
            "scaffale", "libreria", "specchio", "lampada", "finestra",
            # Cibo
            "piatto", "tazza", "bicchiere", "bottiglia", "pane", "pizza", "pasta",
            "carne", "verdura", "frutta",
            # Natura
            "albero", "fiore", "pianta", "foglia", "giardino", "montagna",
            "fiume", "lago", "mare", "spiaggia", "roccia", "cielo",
            # Veicoli
            "automobile", "bicicletta", "motocicletta", "camion", "autobus", "treno", "aereo", "barca",
            # Persone
            "persona", "uomo", "donna", "bambino", "ragazzo", "ragazza",
            # Industria/tecnica
            "macchina", "motore", "pompa", "valvola", "tubo", "cavo", "pannello",
            "quadro elettrico", "interruttore", "generatore", "turbina", "serbatoio",
            "scala", "ponteggio", "impianto",
            # Altri
            "libro", "penna", "documento", "edificio", "casa", "ponte", "cartello",
        ]

        objects = []
        for obj in common_objects:
            # Word boundary: evita match dentro parole composite
            if re.search(rf'\b{re.escape(obj)}\b', text_lower) and obj not in objects:
                objects.append(obj)
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
        except:
            return False


# Global instance
vision_client = OllamaVisionClient()
