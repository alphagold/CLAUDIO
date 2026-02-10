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
            "options": options
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

        # Clean up markdown headers and formatting
        text_cleaned = text.strip()
        text_cleaned = re.sub(r'^###\s+.*?:\s*\n?', '', text_cleaned, flags=re.IGNORECASE | re.MULTILINE)
        text_cleaned = re.sub(r'^\*\*.*?:\*\*\s*', '', text_cleaned, flags=re.IGNORECASE | re.MULTILINE)
        text_cleaned = re.sub(r'^\d+\.\s+[A-Z\s]+:\s*', '', text_cleaned, flags=re.MULTILINE)

        # Remove "Ecco un esempio" and example text (common issue with models)
        if "ecco un esempio" in text_cleaned.lower() or "esempio:" in text_cleaned.lower():
            # Try to find actual description after example
            match = re.search(r'(?:in questo caso|nella foto|nell\'immagine)[:\s]+(.+)', text_cleaned, re.IGNORECASE | re.DOTALL)
            if match:
                text_cleaned = match.group(1).strip()
            else:
                # Remove everything up to and including the example
                text_cleaned = re.sub(r'.*?(?:ecco un esempio|esempio).*?(?:\n\n|\.\s+(?=[A-Z]))', '', text_cleaned, flags=re.IGNORECASE | re.DOTALL)

        text_lower = text_cleaned.lower()

        # Use cleaned text as description
        description_full = text_cleaned if text_cleaned else "Immagine analizzata"

        # Extract first sentence as short description (max 200 chars)
        sentences = re.split(r'[.!?]+', text_cleaned)
        short_desc = sentences[0].strip()[:200] if sentences and sentences[0].strip() else "Foto"

        # Detect extracted text from image (look for mentions of text/writing)
        extracted_text = None
        if any(kw in text_lower for kw in ["nessun testo", "non è presente testo", "non ci sono scritte", "no text"]):
            extracted_text = None
        else:
            # Look for mentions of visible text
            text_match = re.search(r'(?:testo visibile|scritta|scritto|text)[:\s]+"?([^".]+)"?', text_cleaned, re.IGNORECASE)
            if text_match:
                extracted_text = text_match.group(1).strip()

        # Detect category from keywords (Italian + English)
        food_keywords = ["cibo", "piatto", "pasto", "ristorante", "cucina", "food", "plate", "dish", "meal"]
        doc_keywords = ["documento", "ricevuta", "carta", "testo", "fattura", "document", "receipt", "paper", "invoice"]
        outdoor_keywords = ["esterno", "fuori", "strada", "parco", "outdoor", "outside", "street", "park"]
        indoor_keywords = ["interno", "dentro", "stanza", "casa", "ufficio", "indoor", "inside", "room", "office"]
        people_keywords = ["persona", "persone", "gente", "donna", "uomo", "bambino", "person", "people", "man", "woman"]

        if any(kw in text_lower for kw in food_keywords):
            category = "food"
        elif any(kw in text_lower for kw in doc_keywords):
            category = "document"
        elif any(kw in text_lower for kw in people_keywords):
            category = "people"
        elif any(kw in text_lower for kw in outdoor_keywords):
            category = "outdoor"
        elif any(kw in text_lower for kw in indoor_keywords):
            category = "indoor"
        else:
            category = "other"

        # Extract common objects mentioned (Italian + English nouns) - EXPANDED LIST (100+)
        common_objects = [
            # Elettronica (18)
            "laptop", "computer", "telefono", "smartphone", "tablet", "monitor",
            "schermo", "tastiera", "mouse", "cuffie", "altoparlante", "caricabatterie",
            "cavo", "router", "stampante", "fotocamera", "orologio", "televisore",
            # Mobili e casa (20)
            "tavolo", "sedia", "scrivania", "letto", "divano", "poltrona", "armadio",
            "scaffale", "libreria", "comodino", "cassettiera", "specchio", "lampada",
            "finestra", "porta", "parete", "pavimento", "tenda", "cuscino", "coperta",
            # Cibo e cucina (20)
            "piatto", "tazza", "bicchiere", "forchetta", "coltello", "cucchiaio",
            "bottiglia", "pentola", "padella", "ciotola", "tovaglia", "caffè", "tè",
            "pane", "pizza", "pasta", "carne", "verdura", "frutta", "dolce",
            # Natura (16)
            "albero", "fiore", "pianta", "foglia", "erba", "rosa", "giardino",
            "montagna", "collina", "fiume", "lago", "mare", "spiaggia", "roccia",
            "cielo", "nuvola",
            # Veicoli (11)
            "auto", "macchina", "automobile", "bicicletta", "moto", "motorino",
            "camion", "autobus", "treno", "aereo", "barca",
            # Persone (13)
            "persona", "uomo", "donna", "bambino", "ragazzo", "ragazza", "volto",
            "viso", "mano", "braccio", "gamba", "occhio", "capelli",
            # Abbigliamento (11)
            "maglietta", "camicia", "pantalone", "gonna", "vestito", "giacca",
            "cappotto", "scarpe", "cappello", "occhiali", "borsa",
            # Altri (15+)
            "libro", "quaderno", "penna", "documento", "strada", "edificio",
            "casa", "ponte", "cartello", "insegna", "chiave", "giocattolo",
            "palla", "bandiera", "foto"
        ]

        objects = []
        for obj in common_objects:
            if obj in text_lower and obj not in objects:
                objects.append(obj)
                if len(objects) >= 12:  # Aumentato da 5 a 12
                    break

        # Detect faces/people con pattern regex migliorati
        detected_faces = 0
        face_patterns = [
            r'(\d+)\s*(?:persona|persone|volto|volti|uomo|donna|bambino)',
            r'(?:una|un)\s*(?:persona|uomo|donna|volto)',
        ]

        for pattern in face_patterns:
            match = re.search(pattern, text_lower)
            if match:
                if match.group(0).startswith(('una', 'un')):
                    detected_faces = 1
                else:
                    detected_faces = int(match.group(1))
                break

        # Check per "nessuna persona"
        if any(kw in text_lower for kw in ["nessuna persona", "nessun volto", "non ci sono persone"]):
            detected_faces = 0

        # Generate tags semantici (evita duplicati con oggetti)
        tags = []
        # Aggiungi categoria come primo tag
        if category != "other":
            tags.append(category)

        # Aggiungi oggetti più rilevanti come tags (max 3)
        for obj in objects[:3]:
            if obj not in tags:
                tags.append(obj)

        # Aggiungi keywords aggiuntive dalla descrizione (max 5 tags totali)
        semantic_keywords = [
            "moderno", "antico", "colorato", "luminoso", "scuro", "grande", "piccolo",
            "pulito", "ordinato", "naturale", "artificiale", "professionale", "casalingo",
            "tecnologia", "lavoro", "famiglia", "viaggio", "sport", "arte"
        ]
        for keyword in semantic_keywords:
            if keyword in text_lower and keyword not in tags:
                tags.append(keyword)
                if len(tags) >= 8:  # Max 8 tags
                    break

        # Calcola confidence dinamico basato su completezza
        confidence = 0.5  # Base
        if len(description_full) > 300: confidence += 0.1
        if len(description_full) > 500: confidence += 0.1
        if len(objects) >= 5: confidence += 0.1
        if len(objects) >= 8: confidence += 0.05
        if detected_faces > 0: confidence += 0.05
        if extracted_text: confidence += 0.05
        if len(tags) >= 5: confidence += 0.05
        confidence = min(confidence, 0.85)  # Cap a 0.85

        return {
            "description_full": description_full[:1000],  # Aumentato da 500 a 1000
            "description_short": short_desc,
            "extracted_text": extracted_text,
            "detected_objects": objects,
            "detected_faces": detected_faces,  # Ora dinamico!
            "scene_category": category,
            "scene_subcategory": None,
            "tags": tags,
            "confidence_score": confidence,  # Ora dinamico!
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
