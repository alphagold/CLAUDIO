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
        return """Analyze this photo and respond with ONLY valid JSON (no markdown, no extra text).

Required JSON structure:
{
  "description_full": "Detailed description in Italian (2-3 sentences)",
  "description_short": "One sentence summary in Italian (max 100 chars)",
  "extracted_text": "Any visible text in the image (empty string if none)",
  "detected_objects": ["object1", "object2", "object3"],
  "scene_category": "food/document/receipt/outdoor/indoor/people/other",
  "scene_subcategory": "restaurant/home/office/street/etc",
  "tags": ["tag1", "tag2", "tag3"],
  "confidence_score": 0.85
}

Important:
- description_full and description_short must be in Italian
- extracted_text: copy exactly any text visible in the image
- detected_objects: list main objects/items visible
- tags: relevant keywords for search (in Italian)
- confidence_score: 0.0 to 1.0 based on image clarity

Respond with ONLY the JSON object, nothing else."""

    def _parse_analysis_response(self, response_text: str) -> Dict:
        """Parse Vision AI response into structured data"""
        try:
            # Try to parse as JSON
            # Remove markdown code blocks if present
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
            print(f"Failed to parse Vision AI response: {e}")
            print(f"Response: {response_text[:200]}")
            # Return basic analysis from raw text
            return {
                "description_full": response_text[:500] if response_text else "Immagine caricata",
                "description_short": response_text[:200] if response_text else "Foto",
                "extracted_text": None,
                "detected_objects": [],
                "detected_faces": 0,
                "scene_category": "other",
                "scene_subcategory": None,
                "tags": [],
                "confidence_score": 0.5,
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
