"""
Ollama Vision AI client for photo analysis
"""
import httpx
import base64
import json
from typing import Dict, Optional, List
from pathlib import Path
from config import settings
import time


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
        detailed: bool = False
    ) -> Dict:
        """
        Analyze photo with Vision AI

        Args:
            image_path: Path to image file
            model: Ollama model to use (default: moondream)
            detailed: Use detailed model (llama3.2-vision) if True

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

        # Prepare prompt
        prompt = self._get_analysis_prompt()

        # Call Ollama API
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            try:
                response = await client.post(
                    f"{self.host}/api/generate",
                    json={
                        "model": selected_model,
                        "prompt": prompt,
                        "images": [image_b64],
                        "stream": False,
                        "options": {
                            "temperature": 0.3,  # More deterministic
                            "top_p": 0.9,
                        }
                    }
                )
                response.raise_for_status()
                result = response.json()

                # Parse response
                analysis_text = result.get("response", "")
                processing_time = int((time.time() - start_time) * 1000)

                # Parse JSON from response
                analysis_data = self._parse_analysis_response(analysis_text)
                analysis_data["processing_time_ms"] = processing_time
                analysis_data["model_version"] = selected_model

                return analysis_data

            except httpx.HTTPError as e:
                processing_time = int((time.time() - start_time) * 1000)
                print(f"Ollama API error: {e}")
                return self._get_fallback_analysis(processing_time)

    def _get_analysis_prompt(self) -> str:
        """Get analysis prompt for Vision AI"""
        return """Analizza questa foto e rispondi SOLO con un oggetto JSON valido (no markdown, no testo extra).

Struttura JSON richiesta:
{
  "description_full": "Descrizione dettagliata in italiano di tutto ciò che vedi (3-5 frasi complete)",
  "description_short": "Riassunto in italiano in una frase (max 100 caratteri)",
  "extracted_text": "Qualsiasi testo visibile nell'immagine (stringa vuota se non c'è testo)",
  "detected_objects": ["oggetto1", "oggetto2", "oggetto3"],
  "scene_category": "food/document/receipt/outdoor/indoor/people/other",
  "scene_subcategory": "restaurant/home/office/street/nature/etc",
  "tags": ["tag1", "tag2", "tag3"],
  "confidence_score": 0.85
}

Istruzioni importanti:
- description_full: Descrivi dettagliatamente cosa vedi, i colori, le azioni, l'ambiente, gli oggetti principali
- description_short: Un riassunto breve e conciso
- extracted_text: Copia esattamente qualsiasi testo/scritta visibile (lascia vuoto "" se non c'è testo)
- detected_objects: Lista degli oggetti principali visibili (in italiano)
- scene_category: Scegli la categoria più appropriata tra: food, document, receipt, outdoor, indoor, people, other
- tags: Parole chiave rilevanti per la ricerca (in italiano)
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

            # Validate and normalize
            return {
                "description_full": data.get("description_full", "Immagine analizzata"),
                "description_short": data.get("description_short", "Foto")[:200],
                "extracted_text": data.get("extracted_text") or None,
                "detected_objects": data.get("detected_objects", []),
                "detected_faces": data.get("detected_faces", 0),
                "scene_category": data.get("scene_category", "other"),
                "scene_subcategory": data.get("scene_subcategory"),
                "tags": data.get("tags", []),
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
