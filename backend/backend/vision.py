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
        num_predict = 1500 if is_qwen else 500

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

        # qwen3-vl: use /api/generate endpoint (no thinking mode)
        # Other models: use /api/chat endpoint
        if is_qwen:
            target_url = f"{self.host}/api/generate"
            payload = {
                "model": selected_model,
                "prompt": prompt,
                "images": [image_b64],
                "stream": False,
                "options": options
            }
        else:
            target_url = f"{self.host}/api/chat"
            payload = {
                "model": selected_model,
                "messages": [
                    {
                        "role": "user",
                        "content": prompt,
                        "images": [image_b64]
                    }
                ],
                "stream": False,
                "keep_alive": "5m",
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
            """Synchronous POST using requests library"""
            import threading
            print(f"[VISION] _sync_post called in thread: {threading.current_thread().name}")
            print(f"[VISION] Target URL: {target_url}")
            print(f"[VISION] About to call requests.post()...")

            try:
                resp = requests.post(
                    target_url,
                    json=payload,
                    timeout=(120, self.timeout),  # (connect, read) timeouts - 120s per payload grandi
                    headers={"Content-Type": "application/json"}
                )
                print(f"[VISION] requests.post() returned!")
                print(f"[VISION] POST completed, status: {resp.status_code}")
                resp.raise_for_status()
                result = resp.json()
                print(f"[VISION] Response parsed as JSON successfully")
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

            # Parse response - different format for /api/generate vs /api/chat
            if "response" in result:
                # /api/generate format (qwen3-vl)
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
                        print(f"[VISION] ❌ Thinking field is just reasoning (English), NOT using it")
                        print(f"[VISION] Thinking preview: {thinking_text[:200]}")
                        # Return error - force model recreation on client
                        raise ValueError("qwen3-vl still using thinking mode - please recreate model without RENDERER/PARSER")
            else:
                # /api/chat format (llava, llama)
                message = result.get("message", {})
                analysis_text = message.get("content", "")
                print(f"[VISION] Using /api/chat response format")

                # Fallback to "thinking" field if content is empty
                # BUT ONLY if thinking contains structured format (not just reasoning)
                if not analysis_text.strip() and "thinking" in message:
                    thinking_text = message.get("thinking", "")
                    print(f"[VISION] ⚠️ Content empty, checking 'thinking' field")
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
                        print(f"[VISION] ❌ Thinking field is just reasoning (English), NOT using it")
                        print(f"[VISION] Thinking preview: {thinking_text[:200]}")
                        # Return error - force model recreation on client
                        raise ValueError("Model still using thinking mode - please recreate model without RENDERER/PARSER")

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
        """Get analysis prompt for Vision AI (simplified text format for all models)"""

        # Aggiungi contesto geolocalizzazione se disponibile
        location_hint = f" La foto è stata scattata a: {location_name}." if location_name else ""

        # Per qwen3-vl-clean: prompt MINIMO (come test utente che funziona)
        if model and "qwen3-vl" in model.lower():
            return f"""Descrivi in italiano questa immagine.{location_hint}

Includi:
- Descrizione dettagliata (3-5 frasi)
- Oggetti principali visibili
- Categoria scena (indoor/outdoor/cibo/documento/persone)
- Eventuali testi scritti nell'immagine"""

        # Prompt standard per altri modelli
        return f"""Descrivi questa immagine in italiano.{location_hint}

Fornisci:
1. DESCRIZIONE DETTAGLIATA (3-5 frasi): Descrivi tutto ciò che vedi - oggetti, colori, azioni, ambiente, contesto
2. DESCRIZIONE BREVE (max 100 caratteri): Riassunto conciso
3. TESTO VISIBILE: Trascrivi qualsiasi testo/scritta nell'immagine (scrivi "Nessuno" se non c'è testo)
4. OGGETTI PRINCIPALI: Lista 3-5 oggetti principali visibili
5. CATEGORIA SCENA: indoor/outdoor/cibo/documento/persone/altro
6. TAG (confidenza alta): Massimo 5 parole chiave specifiche e rilevanti{f", includi tag di luogo per {location_name}" if location_name else ""}

Rispondi in italiano in questo formato:
DESCRIZIONE DETTAGLIATA: [testo]
DESCRIZIONE BREVE: [testo]
TESTO VISIBILE: [testo]
OGGETTI: [lista separata da virgole]
CATEGORIA: [categoria]
TAG: [lista separata da virgole]"""

    def _parse_analysis_response(self, response_text: str) -> Dict:
        """Parse Vision AI response into structured data"""

        # Try structured text format first (new default format)
        if "DESCRIZIONE DETTAGLIATA:" in response_text or "DESCRIZIONE BREVE:" in response_text:
            try:
                return self._parse_structured_text(response_text)
            except Exception as e:
                print(f"Structured text parsing failed: {e}, trying JSON fallback...")

        # Try JSON format (fallback for models that might still use it)
        try:
            clean_text = response_text.strip()
            if clean_text.startswith("```"):
                # Extract JSON from markdown
                lines = clean_text.split("\n")
                clean_text = "\n".join(lines[1:-1])

            data = json.loads(clean_text)

            # Parse tags con confidence
            raw_tags = data.get("tags", [])
            high_confidence_tags = []

            for tag_item in raw_tags:
                # Supporta sia formato con dict che formato semplice (stringhe)
                if isinstance(tag_item, dict):
                    tag_name = tag_item.get("tag", "")
                    confidence = tag_item.get("confidence", 0.0)
                else:
                    # Tag è stringa semplice (usato da qwen3-vl)
                    tag_name = str(tag_item)
                    confidence = 0.9  # Default high confidence per tag semplici

                # Filtra tag validi
                if (confidence > 0.7 and  # Soglia più bassa per tag semplici
                    len(tag_name.strip()) > 2 and
                    tag_name.strip().lower() not in GENERIC_TAGS_BLACKLIST):
                    high_confidence_tags.append(tag_name.strip())

            # Se dopo il filtro restano meno di 3 tag, mantieni comunque i tag originali
            # con confidence >0.7 per evitare foto senza tag
            if len(high_confidence_tags) < 3:
                for tag_item in raw_tags:
                    if isinstance(tag_item, dict):
                        tag_name = tag_item.get("tag", "")
                        confidence = tag_item.get("confidence", 0.0)
                    else:
                        tag_name = str(tag_item)
                        confidence = 0.7

                    if (confidence > 0.7 and
                        len(tag_name.strip()) > 2 and
                        tag_name.strip() not in high_confidence_tags):
                        high_confidence_tags.append(tag_name.strip())

            # Limita a max 5 tag
            filtered_tags = high_confidence_tags[:5]

            # Validate and normalize
            return {
                "description_full": data.get("description_full", "Immagine analizzata"),
                "description_short": data.get("description_short", "Foto")[:200],
                "extracted_text": data.get("extracted_text") or None,
                "detected_objects": data.get("detected_objects", []),
                "detected_faces": data.get("detected_faces", 0),
                "scene_category": data.get("scene_category", "other"),
                "scene_subcategory": data.get("scene_subcategory"),
                "tags": filtered_tags,
                "confidence_score": float(data.get("confidence_score", 0.7)),
            }

        except (json.JSONDecodeError, KeyError, ValueError) as e:
            print(f"JSON parsing failed: {e}, using text extraction fallback")
            # Last fallback: extract useful info from malformed response
            return self._extract_from_text(response_text)

    def _parse_structured_text(self, text: str) -> Dict:
        """Parse structured text format from qwen3-vl (non-JSON response)"""
        import re

        # Verify minimum required sections are present
        required_sections = ["DESCRIZIONE DETTAGLIATA:", "DESCRIZIONE BREVE:", "CATEGORIA:"]
        has_required = all(section.lower() in text.lower() for section in required_sections)

        if not has_required:
            print(f"[VISION] ⚠️ Structured format incomplete, using text extraction fallback")
            print(f"[VISION] Text preview (first 200 chars): {text[:200]}")
            raise ValueError("Structured format incomplete - missing required sections")

        # Extract each section using regex
        desc_full_match = re.search(r'DESCRIZIONE DETTAGLIATA:\s*(.+?)(?=DESCRIZIONE BREVE:|$)', text, re.DOTALL | re.IGNORECASE)
        desc_short_match = re.search(r'DESCRIZIONE BREVE:\s*(.+?)(?=TESTO VISIBILE:|$)', text, re.DOTALL | re.IGNORECASE)
        text_match = re.search(r'TESTO VISIBILE:\s*(.+?)(?=OGGETTI:|$)', text, re.DOTALL | re.IGNORECASE)
        objects_match = re.search(r'OGGETTI:\s*(.+?)(?=CATEGORIA:|$)', text, re.DOTALL | re.IGNORECASE)
        category_match = re.search(r'CATEGORIA:\s*(.+?)(?=TAG:|$)', text, re.DOTALL | re.IGNORECASE)
        tags_match = re.search(r'TAG:\s*(.+?)$', text, re.DOTALL | re.IGNORECASE)

        # Extract and clean
        desc_full = desc_full_match.group(1).strip() if desc_full_match else "Immagine analizzata"
        desc_short = desc_short_match.group(1).strip() if desc_short_match else "Foto"

        print(f"[VISION] ✅ Parsed structured format - desc_full length: {len(desc_full)}, desc_short: {desc_short[:50]}")
        extracted_text = text_match.group(1).strip() if text_match else ""

        # Parse objects list (comma or newline separated)
        objects_raw = objects_match.group(1).strip() if objects_match else ""
        objects = [obj.strip() for obj in re.split(r'[,\n-]', objects_raw) if obj.strip() and len(obj.strip()) > 2][:5]

        # Parse category
        category = category_match.group(1).strip().lower() if category_match else "other"
        # Map to valid categories
        if "cibo" in category or "food" in category:
            category = "food"
        elif "documento" in category or "document" in category:
            category = "document"
        elif "outdoor" in category or "esterno" in category:
            category = "outdoor"
        elif "indoor" in category or "interno" in category:
            category = "indoor"
        elif "person" in category or "persone" in category:
            category = "people"
        else:
            category = "other"

        # Parse tags (comma or newline separated)
        tags_raw = tags_match.group(1).strip() if tags_match else ""
        tags = [tag.strip() for tag in re.split(r'[,\n-]', tags_raw) if tag.strip() and len(tag.strip()) > 2][:5]

        # Handle "Nessuno" for extracted text
        if extracted_text.lower() in ["nessuno", "nessun testo", "non presente", "none"]:
            extracted_text = None
        elif not extracted_text:
            extracted_text = None

        return {
            "description_full": desc_full[:500],
            "description_short": desc_short[:200],
            "extracted_text": extracted_text,
            "detected_objects": objects,
            "detected_faces": 0,
            "scene_category": category,
            "scene_subcategory": None,
            "tags": tags,
            "confidence_score": 0.8,
        }

    def _extract_from_text(self, text: str) -> Dict:
        """Extract structured data from free-form text response (for qwen3-vl simple prompt)"""
        import re

        # Clean up markdown headers and formatting
        text_cleaned = text.strip()
        text_cleaned = re.sub(r'^###\s+Descrizione dettagliata:\s*\n?', '', text_cleaned, flags=re.IGNORECASE)
        text_cleaned = re.sub(r'^###\s+\w+:\s*\n?', '', text_cleaned, flags=re.IGNORECASE | re.MULTILINE)
        text_cleaned = re.sub(r'^\*\*\w+:\*\*\s*', '', text_cleaned, flags=re.IGNORECASE | re.MULTILINE)

        text_lower = text_cleaned.lower()

        # Use cleaned text as description
        description_full = text_cleaned if text_cleaned else "Immagine analizzata"

        # Extract first sentence as short description (max 200 chars)
        sentences = re.split(r'[.!?]+', text_cleaned)
        short_desc = sentences[0].strip()[:200] if sentences and sentences[0].strip() else "Foto"

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

        # Extract common objects mentioned (Italian nouns)
        common_objects = [
            "laptop", "computer", "telefono", "schermo", "tastiera", "mouse",
            "tavolo", "sedia", "finestra", "porta", "parete",
            "auto", "macchina", "bicicletta", "strada",
            "albero", "fiore", "pianta", "cielo", "nuvola",
            "libro", "penna", "carta", "documento",
            "cibo", "piatto", "tazza", "bicchiere", "bottiglia"
        ]

        objects = []
        for obj in common_objects:
            if obj in text_lower and obj not in objects:
                objects.append(obj)
                if len(objects) >= 5:
                    break

        # Simple tags from objects + category
        tags = objects[:5] if objects else [category]

        return {
            "description_full": description_full[:500],
            "description_short": short_desc,
            "extracted_text": None,
            "detected_objects": objects,
            "detected_faces": 0,
            "scene_category": category,
            "scene_subcategory": None,
            "tags": tags,
            "confidence_score": 0.7,
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
