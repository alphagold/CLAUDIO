#!/bin/bash
# Download Ollama Vision models

echo "🚀 Downloading Ollama Vision models..."
echo ""

# Check if Ollama container is running
if ! docker ps | grep -q photomemory-ollama; then
    echo "❌ Error: Ollama container is not running!"
    echo "   Start it with: docker-compose up -d ollama"
    exit 1
fi

echo "📥 Downloading Moondream 2B (fast model)..."
docker exec photomemory-ollama ollama pull moondream

echo ""
echo "📥 Downloading Llama 3.2 Vision 11B quantized (accurate model)..."
docker exec photomemory-ollama ollama pull llama3.2-vision:11b-q4_K_M

echo ""
echo "✅ Models downloaded successfully!"
echo ""
echo "Available models:"
docker exec photomemory-ollama ollama list

echo ""
echo "🎯 You can now test Vision AI with:"
echo "   curl -X POST http://192.168.200.4:8000/api/photos -F 'file=@test.jpg'"
