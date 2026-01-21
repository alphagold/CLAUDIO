#!/bin/bash
# Script per testare tutti i modelli vision su una foto

echo "================================================================================"
echo "🧪 TEST COMPARATIVO MODELLI VISION OLLAMA"
echo "================================================================================"

# Scarica immagine di test se non esiste
if [ ! -f /tmp/test.jpg ]; then
    echo "📥 Scaricando immagine di test..."
    curl -s -o /tmp/test.jpg "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800"
fi

# Converti immagine in base64
IMAGE_B64=$(base64 -w 0 /tmp/test.jpg)

# Modelli da testare
MODELS=(
    "moondream:Moondream 2B - Ultra veloce"
    "llava-phi3:LLaVA-Phi3 - Piccolo e veloce"
    "minicpm-v:MiniCPM-V - Compatto"
    "llava:LLaVA 7B - Bilanciato"
    "bakllava:BakLLaVA 7B"
    "llava-llama3:LLaVA-Llama3 8B"
    "llama3.2-vision:Llama 3.2 Vision 11B (attuale)"
)

PROMPT='Analizza questa foto in italiano e rispondi con JSON: {"description_full":"Descrizione dettagliata (3-5 frasi)","description_short":"Riassunto breve","detected_objects":["obj1","obj2"],"scene_category":"food/outdoor/indoor/other","tags":["tag1","tag2"]}'

# File risultati
RESULTS_FILE="/tmp/vision_test_results.txt"
> $RESULTS_FILE

echo "" | tee -a $RESULTS_FILE
printf "%-25s %-12s %-10s %s\n" "MODELLO" "TEMPO" "STATUS" "DESCRIZIONE" | tee -a $RESULTS_FILE
echo "--------------------------------------------------------------------------------" | tee -a $RESULTS_FILE

for MODEL_INFO in "${MODELS[@]}"; do
    MODEL_NAME="${MODEL_INFO%%:*}"
    MODEL_DESC="${MODEL_INFO#*:}"

    echo "" | tee -a $RESULTS_FILE
    echo "📦 Testando: $MODEL_NAME - $MODEL_DESC" | tee -a $RESULTS_FILE

    # Scarica modello se necessario
    echo "📥 Scaricando $MODEL_NAME..." | tee -a $RESULTS_FILE
    docker exec photomemory-ollama ollama pull $MODEL_NAME 2>&1 | grep -i "success\|already\|pulling" || true

    # Test analisi
    echo "🔍 Analizzando..." | tee -a $RESULTS_FILE
    START_TIME=$(date +%s)

    # Crea file JSON con jq per escape corretto
    jq -n \
        --arg model "$MODEL_NAME" \
        --arg prompt "$PROMPT" \
        --arg img "$IMAGE_B64" \
        '{
            model: $model,
            prompt: $prompt,
            images: [$img],
            stream: false,
            keep_alive: "5m",
            options: {
                temperature: 0.3,
                num_predict: 500
            }
        }' > /tmp/request.json

    RESPONSE=$(curl -s --max-time 300 -X POST http://192.168.200.4:11434/api/generate \
        -H "Content-Type: application/json" \
        -d @/tmp/request.json)

    END_TIME=$(date +%s)
    ELAPSED=$((END_TIME - START_TIME))

    if [ $? -eq 0 ] && [ ! -z "$RESPONSE" ]; then
        # Estrai descrizione breve
        DESC=$(echo "$RESPONSE" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r.get('response','')[:80])" 2>/dev/null || echo "OK")

        echo "✅ Completato in ${ELAPSED}s" | tee -a $RESULTS_FILE
        printf "%-25s %-12s %-10s %s\n" "$MODEL_NAME" "${ELAPSED}s" "✅ OK" "$DESC" | tee -a $RESULTS_FILE

        # Salva risposta completa
        echo "$RESPONSE" > "/tmp/response_${MODEL_NAME//[:\/]/_}.json"
    else
        echo "❌ Fallito dopo ${ELAPSED}s" | tee -a $RESULTS_FILE
        printf "%-25s %-12s %-10s %s\n" "$MODEL_NAME" "${ELAPSED}s" "❌ FAIL" "Timeout o errore" | tee -a $RESULTS_FILE
    fi

    echo "--------------------------------------------------------------------------------" | tee -a $RESULTS_FILE
done

echo ""
echo "================================================================================"
echo "✅ Test completato! Risultati salvati in: $RESULTS_FILE"
echo "================================================================================"
echo ""
echo "📊 Risposte complete salvate in: /tmp/response_*.json"
echo ""
cat $RESULTS_FILE
