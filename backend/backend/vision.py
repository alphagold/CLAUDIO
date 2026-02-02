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
        num_predict = 1500 if "qwen" in selected_model.lower() else 500

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
            "options": {
                "temperature": 0.3,
                "top_p": 0.9,
                "num_predict": num_predict,
            }
        }
        print(f"[VISION] Model-specific params: num_predict={num_predict}")
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
            analysis_text = result.get("message", {}).get("content", "")
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
        """Get analysis prompt for Vision AI"""

        # Aggiungi contesto geolocalizzazione se disponibile
        location_context = ""
        if location_name:
            location_context = f"""
INFORMAZIONE IMPORTANTE - GEOLOCALIZZAZIONE:
Questa foto è stata scattata a: {location_name}
Usa questa informazione per generare tag di luogo appropriati e specifici.
"""

        # qwen3-vl funziona meglio con prompt semplici e risposta libera
        if model and "qwen" in model.lower():
            return f"""Analizza questa foto e descrivi dettagliatamente in italiano cosa vedi.
{location_context}
Includi:
1. Una descrizione completa e dettagliata (3-5 frasi) di tutto ciò che vedi: oggetti, colori, azioni, ambiente
2. Un riassunto breve (max 100 caratteri)
3. Eventuali testi visibili nell'immagine
4. Lista degli oggetti principali
5. Tipo di scena (cibo/documento/outdoor/indoor/persone/altro)
6. Alcuni tag descrittivi

Rispondi in formato JSON:
{{
  "description_full": "descrizione dettagliata...",
  "description_short": "riassunto breve",
  "extracted_text": "testo visibile o stringa vuota",
  "detected_objects": ["oggetto1", "oggetto2"],
  "scene_category": "tipo scena",
  "tags": ["tag1", "tag2", "tag3"]
}}"""

        return f"""Analizza questa foto e rispondi SOLO con un oggetto JSON valido (no markdown, no testo extra).
{location_context}
Struttura JSON richiesta:
{{
  "description_full": "Descrizione dettagliata in italiano di tutto ciò che vedi (3-5 frasi complete)",
  "description_short": "Riassunto in italiano in una frase (max 100 caratteri)",
  "extracted_text": "Qualsiasi testo visibile nell'immagine (stringa vuota se non c'è testo)",
  "detected_objects": ["oggetto1", "oggetto2", "oggetto3"],
  "scene_category": "food/document/receipt/outdoor/indoor/people/other",
  "scene_subcategory": "restaurant/home/office/street/nature/etc",
  "tags": [
    {{"tag": "tag1", "confidence": 0.95}},
    {{"tag": "tag2", "confidence": 0.88}},
    {{"tag": "tag3", "confidence": 0.82}}
  ],
  "confidence_score": 0.85
}}

Istruzioni importanti:
- description_full: Descrivi dettagliatamente cosa vedi, i colori, le azioni, l'ambiente, gli oggetti principali
- description_short: Un riassunto breve e conciso
- extracted_text: Copia esattamente qualsiasi testo/scritta visibile (lascia vuoto "" se non c'è testo)
- detected_objects: Lista degli oggetti principali visibili (in italiano)
- scene_category: Scegli la categoria più appropriata tra: food, document, receipt, outdoor, indoor, people, other
- tags: Array di oggetti con 'tag' (nome) e 'confidence' (0.0-1.0). Solo 3-5 tag ALTAMENTE SPECIFICI (confidence minima 0.8) - oggetti/persone/luoghi chiaramente identificabili. Evita tag generici come 'oggetto', 'cosa', 'elemento'. Preferisci tag concreti come 'tavolo', 'sedia', 'montagna', 'pizza', 'smartphone'. Se disponibile geolocalizzazione, includi tag di luogo con alta confidenza
- confidence_score: Quanto sei sicuro dell'analisi (0.0-1.0)

Rispondi SOLO con l'oggetto JSON, senza markdown né altro testo."""

    def _parse_analysis_response(self, response_text: str) -> Dict:
        """Parse Vision AI response into structured data"""
        try:
            # Try to parse as JSON
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
            print(f"JSON parsing failed, extracting info from text: {e}")
            # Fallback: extract useful info from malformed response
            return self._extract_from_text(response_text)

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
