#!/usr/bin/env python3
"""
Test script per confrontare diversi modelli vision di Ollama
"""
import asyncio
import time
import json
import sys
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent / "backend"))

from vision import OllamaVisionClient

# Modelli da testare (ordinati per dimensione/velocità prevista)
MODELS_TO_TEST = [
    ("moondream", "Moondream 2B - Ultra veloce"),
    ("llava-phi3", "LLaVA-Phi3 - Piccolo e veloce"),
    ("minicpm-v", "MiniCPM-V - Compatto"),
    ("llava", "LLaVA 7B - Bilanciato"),
    ("bakllava", "BakLLaVA 7B - Alternativa LLaVA"),
    ("llava-llama3", "LLaVA-Llama3 8B - Basato su Llama 3"),
    ("llama3.2-vision", "Llama 3.2 Vision 11B - Quello attuale"),
    ("llava:13b", "LLaVA 13B - Alta qualità (lento)"),
]

async def download_model(model_name: str):
    """Scarica un modello Ollama"""
    print(f"\n📥 Scaricando {model_name}...")
    proc = await asyncio.create_subprocess_exec(
        "docker", "exec", "photomemory-ollama", "ollama", "pull", model_name,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    await proc.communicate()
    if proc.returncode == 0:
        print(f"✅ {model_name} scaricato")
        return True
    else:
        print(f"❌ Errore scaricando {model_name}")
        return False

async def test_model(model_name: str, image_path: str, timeout: int = 300):
    """Testa un modello vision"""
    print(f"\n🔍 Testando {model_name}...")

    client = OllamaVisionClient(host="http://192.168.200.4:11434")

    start_time = time.time()
    try:
        result = await client.analyze_photo(image_path, model=model_name, detailed=True)
        elapsed = time.time() - start_time

        return {
            "model": model_name,
            "success": True,
            "time_seconds": round(elapsed, 1),
            "description_full": result.get("description_full", ""),
            "description_short": result.get("description_short", ""),
            "detected_objects": result.get("detected_objects", []),
            "scene_category": result.get("scene_category", ""),
            "tags": result.get("tags", []),
            "confidence_score": result.get("confidence_score", 0),
            "model_version": result.get("model_version", model_name),
        }
    except asyncio.TimeoutError:
        elapsed = time.time() - start_time
        return {
            "model": model_name,
            "success": False,
            "error": "Timeout",
            "time_seconds": round(elapsed, 1),
        }
    except Exception as e:
        elapsed = time.time() - start_time
        return {
            "model": model_name,
            "success": False,
            "error": str(e),
            "time_seconds": round(elapsed, 1),
        }

async def main():
    print("=" * 80)
    print("🧪 TEST COMPARATIVO MODELLI VISION OLLAMA")
    print("=" * 80)

    # Immagine di test
    image_path = "/tmp/test.jpg"
    if not Path(image_path).exists():
        print(f"❌ Immagine di test non trovata: {image_path}")
        print("Esegui: curl -o /tmp/test.jpg 'https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800'")
        return

    results = []

    for model_name, description in MODELS_TO_TEST:
        print(f"\n{'=' * 80}")
        print(f"📦 Modello: {model_name}")
        print(f"📝 {description}")
        print(f"{'=' * 80}")

        # Scarica il modello se non presente
        await download_model(model_name)

        # Testa il modello
        result = await test_model(model_name, image_path)
        results.append(result)

        if result["success"]:
            print(f"✅ Completato in {result['time_seconds']}s")
            print(f"📄 Descrizione: {result['description_short'][:100]}...")
            print(f"🏷️  Oggetti: {', '.join(result['detected_objects'][:5])}")
            print(f"📊 Confidence: {result['confidence_score']}")
        else:
            print(f"❌ Fallito: {result.get('error', 'Unknown error')}")

    # Report finale
    print("\n" + "=" * 80)
    print("📊 RISULTATI FINALI")
    print("=" * 80)

    # Tabella comparativa
    print(f"\n{'Modello':<25} {'Tempo':<12} {'Status':<10} {'Oggetti':<10}")
    print("-" * 80)

    successful = [r for r in results if r["success"]]
    failed = [r for r in results if not r["success"]]

    for result in sorted(successful, key=lambda x: x["time_seconds"]):
        model = result["model"]
        time_str = f"{result['time_seconds']}s"
        objects = len(result.get("detected_objects", []))
        print(f"{model:<25} {time_str:<12} {'✅ OK':<10} {objects:<10}")

    for result in failed:
        model = result["model"]
        time_str = f"{result['time_seconds']}s"
        error = result.get("error", "Failed")[:20]
        print(f"{model:<25} {time_str:<12} {'❌ ' + error:<10}")

    # Salva risultati dettagliati
    output_file = "/tmp/vision_models_comparison.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(results, f, indent=2, ensure_ascii=False)

    print(f"\n💾 Risultati dettagliati salvati in: {output_file}")

    # Raccomandazione
    if successful:
        fastest = min(successful, key=lambda x: x["time_seconds"])
        print(f"\n🏆 MODELLO PIÙ VELOCE: {fastest['model']} ({fastest['time_seconds']}s)")

        best_quality = max(successful, key=lambda x: len(x.get('detected_objects', [])))
        print(f"🎯 MIGLIORE QUALITÀ: {best_quality['model']} ({len(best_quality.get('detected_objects', []))} oggetti rilevati)")

if __name__ == "__main__":
    asyncio.run(main())
