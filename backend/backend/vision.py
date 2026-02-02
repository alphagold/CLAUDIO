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

        # Call Ollama API
        target_url = f"{self.host}/api/chat"
        print(f"[VISION] Making request to: {target_url} with model: {selected_model}")
        print(f"[VISION] self.host = {self.host!r}")
        print(f"[VISION] Timeout: {self.timeout} seconds")
        print(f"[VISION] Image size: {len(image_b64)} bytes (base64)")
        print(f"[VISION] Prompt length: {len(prompt)} characters")

        # Adjust parameters based on model
        # qwen3-vl needs more tokens for detailed responses
        is_qwen = "qwen" in selected_model.lower()
        num_predict = 1500 if is_qwen else 500

        options = {
            "temperature": 0.3,
            "top_p": 0.9,
            "num_predict": num_predict,
        }

        # qwen3-vl: disable thinking mode to get response in content field
        # Try multiple parameters (qwen3-vl has inconsistent behavior)
        if is_qwen:
            options["enable_thinking"] = False
            options["thinking"] = False

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
        print(f"[VISION] Model-specific params: num_predict={num_predict}, enable_thinking={options.get('enable_thinking', 'default')}")
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
                    timeout=(30, self.timeout),  # (connect, read) timeouts
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

            # Parse response (chat format)
            # qwen3-vl uses "thinking" field instead of "content" - try both
            message = result.get("message", {})
            analysis_text = message.get("content", "")

            # Fallback to "thinking" field if content is empty (qwen3-vl behavior)
            if not analysis_text.strip() and "thinking" in message:
                thinking_text = message.get("thinking", "")
                print(f"[VISION] ⚠️ Content empty, using 'thinking' field (qwen3-vl)")
                print(f"[VISION] Thinking field length: {len(thinking_text)} chars")
                print(f"[VISION] Thinking FULL TEXT:\n{thinking_text}")
                analysis_text = thinking_text

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

        # Prompt semplificato testuale - funziona meglio di JSON per tutti i modelli vision
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
        """Extract structured data from free-form text response"""
        import re

        text_lower = text.lower()

        # Detect food-related keywords
        food_keywords = ["food", "plate", "dish", "meal", "restaurant", "cooking", "eat"]
        is_food = any(keyword in text_lower for keyword in food_keywords)

        # Detect document keywords
        doc_keywords = ["document", "receipt", "paper", "text", "invoice"]
        is_document = any(keyword in text_lower for keyword in doc_keywords)

        # Extract simple description (first 200 chars of text)
        description = text[:500].strip() if text else "Immagine analizzata"
        short_desc = text[:150].strip() if text else "Foto"

        # Try to extract objects from text (words between quotes or common nouns)
        objects = []
        if "plate" in text_lower or "dish" in text_lower:
            objects.append("plate")
        if "food" in text_lower:
            objects.append("food")

        return {
            "description_full": description,
            "description_short": short_desc,
            "extracted_text": None,
            "detected_objects": objects,
            "detected_faces": 0,
            "scene_category": "food" if is_food else ("document" if is_document else "other"),
            "scene_subcategory": None,
            "tags": objects,
            "confidence_score": 0.6,
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
