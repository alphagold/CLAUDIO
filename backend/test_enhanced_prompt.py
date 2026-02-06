"""
Test script per validare miglioramenti prompt analisi AI
"""
import asyncio
import json
import time
from pathlib import Path
from typing import Dict, List
import sys

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from backend.vision import OllamaVisionClient


class TestResults:
    """Container per risultati test"""

    def __init__(self):
        self.results = []

    def add_result(self, photo_name: str, model: str, analysis: Dict, metrics: Dict):
        """Aggiungi risultato test"""
        self.results.append({
            "photo": photo_name,
            "model": model,
            "analysis": analysis,
            "metrics": metrics,
            "timestamp": time.time()
        })

    def get_summary(self) -> Dict:
        """Calcola statistiche aggregate"""
        if not self.results:
            return {}

        summary = {}

        # Group by model
        by_model = {}
        for result in self.results:
            model = result["model"]
            if model not in by_model:
                by_model[model] = []
            by_model[model].append(result)

        # Calculate stats per model
        for model, model_results in by_model.items():
            metrics_keys = ["description_length", "objects_count", "faces_detected",
                           "tags_count", "confidence", "pass_count"]

            model_stats = {key: [] for key in metrics_keys}
            model_stats["pass_count"] = 0

            for result in model_results:
                metrics = result["metrics"]
                model_stats["description_length"].append(metrics["description_length"])
                model_stats["objects_count"].append(metrics["objects_count"])
                model_stats["faces_detected"].append(metrics.get("faces_detected", 0))
                model_stats["tags_count"].append(metrics["tags_count"])
                model_stats["confidence"].append(metrics["confidence"])

                if metrics["status"] == "PASS":
                    model_stats["pass_count"] += 1

            # Calculate averages
            summary[model] = {
                "total_tests": len(model_results),
                "pass_count": model_stats["pass_count"],
                "pass_rate": model_stats["pass_count"] / len(model_results),
                "avg_description_length": sum(model_stats["description_length"]) / len(model_results),
                "avg_objects_count": sum(model_stats["objects_count"]) / len(model_results),
                "avg_faces_detected": sum(model_stats["faces_detected"]) / len(model_results),
                "avg_tags_count": sum(model_stats["tags_count"]) / len(model_results),
                "avg_confidence": sum(model_stats["confidence"]) / len(model_results),
            }

        return summary

    def save_to_file(self, filename: str):
        """Salva risultati su file JSON"""
        data = {
            "results": self.results,
            "summary": self.get_summary()
        }

        with open(filename, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

        print(f"\n✅ Risultati salvati in: {filename}")


def validate_result(analysis: Dict, expected_category: str = None,
                    expected_faces: int = None) -> Dict:
    """Valida risultato analisi contro metriche target"""

    metrics = {
        "description_length": len(analysis.get("description_full", "")),
        "objects_count": len(analysis.get("detected_objects", [])),
        "faces_detected": analysis.get("detected_faces", 0),
        "tags_count": len(analysis.get("tags", [])),
        "confidence": analysis.get("confidence_score", 0),
        "category": analysis.get("scene_category"),
        "has_extracted_text": bool(analysis.get("extracted_text")),
    }

    # Validation rules
    checks = {
        "description_length": metrics["description_length"] >= 400,  # Target: 800+, min 400
        "objects_count": metrics["objects_count"] >= 5,  # Target: 8-12, min 5
        "tags_count": metrics["tags_count"] >= 3,  # Target: 5-8, min 3
        "confidence": metrics["confidence"] >= 0.6,  # Target: 0.7-0.9, min 0.6
        "category_valid": metrics["category"] in ["indoor", "outdoor", "food", "document",
                                                    "people", "nature", "urban", "vehicle", "other"]
    }

    # Optional checks
    if expected_category:
        checks["category_match"] = metrics["category"] == expected_category

    if expected_faces is not None:
        checks["faces_match"] = metrics["faces_detected"] == expected_faces

    # Overall status
    required_checks = ["description_length", "objects_count", "tags_count",
                       "confidence", "category_valid"]
    passed = all(checks[key] for key in required_checks)

    if passed:
        status = "PASS"
    elif sum(checks[key] for key in required_checks) >= 3:
        status = "WARNING"
    else:
        status = "FAIL"

    metrics["checks"] = checks
    metrics["status"] = status

    return metrics


async def test_photo(client: OllamaVisionClient, photo_path: Path, model: str,
                     expected_category: str = None, expected_faces: int = None) -> Dict:
    """Test singola foto con modello specificato"""

    print(f"\n{'='*70}")
    print(f"Testing: {photo_path.name}")
    print(f"Model: {model}")
    print(f"{'='*70}")

    start_time = time.time()

    try:
        # Analyze photo
        analysis = await client.analyze_photo(
            image_path=str(photo_path),
            model=model,
            allow_fallback=False
        )

        elapsed = time.time() - start_time

        # Validate results
        metrics = validate_result(analysis, expected_category, expected_faces)
        metrics["processing_time"] = elapsed

        # Print results
        print(f"\n📊 Metrics:")
        print(f"  Status: {metrics['status']}")
        print(f"  Description length: {metrics['description_length']} chars (target: 800+)")
        print(f"  Objects detected: {metrics['objects_count']} (target: 8-12)")
        print(f"  Faces detected: {metrics['faces_detected']}")
        print(f"  Tags: {metrics['tags_count']} (target: 5-8)")
        print(f"  Confidence: {metrics['confidence']:.2f} (target: 0.7-0.9)")
        print(f"  Category: {metrics['category']}")
        print(f"  Processing time: {elapsed:.1f}s")

        # Print checks
        print(f"\n✓ Checks:")
        for check, passed in metrics["checks"].items():
            symbol = "✅" if passed else "❌"
            print(f"  {symbol} {check}")

        # Print sample data
        print(f"\n📝 Sample output:")
        print(f"  Description: {analysis['description_full'][:200]}...")
        print(f"  Objects: {', '.join(analysis['detected_objects'][:5])}")
        print(f"  Tags: {', '.join(analysis['tags'][:5])}")

        return {"analysis": analysis, "metrics": metrics}

    except Exception as e:
        print(f"\n❌ Error: {type(e).__name__}: {e}")
        return {
            "analysis": None,
            "metrics": {
                "status": "ERROR",
                "error": str(e),
                "processing_time": time.time() - start_time
            }
        }


async def run_tests():
    """Esegui test suite completa"""

    print("="*70)
    print("Test Enhanced Prompt - PhotoMemory AI Analysis")
    print("="*70)

    # Test configuration
    TEST_PHOTOS_DIR = Path(__file__).parent / "test_photos"

    # Check if test photos exist
    if not TEST_PHOTOS_DIR.exists():
        print(f"\n⚠️ Directory test photos non trovata: {TEST_PHOTOS_DIR}")
        print(f"\n📋 Crea la directory e aggiungi queste foto:")
        print(f"  1. desk_workspace.jpg - Scrivania con laptop e oggetti")
        print(f"  2. restaurant_food.jpg - Cibo in ristorante")
        print(f"  3. outdoor_park.jpg - Parco con natura")
        print(f"  4. group_photo.jpg - Foto di gruppo")
        print(f"  5. receipt_document.jpg - Documento con testo")
        return

    # Test photos configuration
    test_photos = [
        {
            "name": "desk_workspace.jpg",
            "expected_category": "indoor",
            "expected_faces": 0,
            "description": "Scrivania con laptop e oggetti"
        },
        {
            "name": "restaurant_food.jpg",
            "expected_category": "food",
            "expected_faces": None,
            "description": "Cibo in ristorante"
        },
        {
            "name": "outdoor_park.jpg",
            "expected_category": "outdoor",
            "expected_faces": 0,
            "description": "Parco con natura"
        },
        {
            "name": "group_photo.jpg",
            "expected_category": "people",
            "expected_faces": 2,  # Minimo 2
            "description": "Foto di gruppo"
        },
        {
            "name": "receipt_document.jpg",
            "expected_category": "document",
            "expected_faces": 0,
            "description": "Documento con testo"
        }
    ]

    # Models to test
    test_models = [
        "llava:7b",
        "qwen3-vl:latest",
        # "llama3.2-vision:11b",  # Commentato - troppo lento per test rapidi
    ]

    # Initialize results
    results = TestResults()

    # Remote server configuration
    REMOTE_SERVER = "http://192.168.52.4:11434"

    # Run tests
    for model in test_models:
        print(f"\n\n{'#'*70}")
        print(f"# Testing Model: {model}")
        print(f"{'#'*70}")

        # Initialize client for this model
        client = OllamaVisionClient(host=REMOTE_SERVER, model=model)

        # Test connection
        print(f"\n🔗 Testing connection to {REMOTE_SERVER}...")
        is_connected = await client.test_connection()

        if not is_connected:
            print(f"❌ Cannot connect to Ollama server at {REMOTE_SERVER}")
            print(f"   Make sure Ollama is running and accessible")
            continue

        print(f"✅ Connected to Ollama server")

        # Test each photo
        for photo_config in test_photos:
            photo_path = TEST_PHOTOS_DIR / photo_config["name"]

            if not photo_path.exists():
                print(f"\n⚠️ Photo not found: {photo_path.name} - skipping")
                continue

            result = await test_photo(
                client=client,
                photo_path=photo_path,
                model=model,
                expected_category=photo_config.get("expected_category"),
                expected_faces=photo_config.get("expected_faces")
            )

            if result["analysis"]:
                results.add_result(
                    photo_name=photo_config["name"],
                    model=model,
                    analysis=result["analysis"],
                    metrics=result["metrics"]
                )

    # Print summary
    print(f"\n\n{'='*70}")
    print("📊 SUMMARY")
    print(f"{'='*70}")

    summary = results.get_summary()

    for model, stats in summary.items():
        print(f"\n🤖 Model: {model}")
        print(f"  Tests: {stats['total_tests']}")
        print(f"  Pass rate: {stats['pass_rate']:.0%} ({stats['pass_count']}/{stats['total_tests']})")
        print(f"  Avg description length: {stats['avg_description_length']:.0f} chars")
        print(f"  Avg objects detected: {stats['avg_objects_count']:.1f}")
        print(f"  Avg faces detected: {stats['avg_faces_detected']:.1f}")
        print(f"  Avg tags: {stats['avg_tags_count']:.1f}")
        print(f"  Avg confidence: {stats['avg_confidence']:.2f}")

    # Save results
    output_file = Path(__file__).parent / "test_results_enhanced_prompt.json"
    results.save_to_file(str(output_file))

    print(f"\n{'='*70}")
    print("✅ Test suite completata!")
    print(f"{'='*70}\n")


if __name__ == "__main__":
    asyncio.run(run_tests())
