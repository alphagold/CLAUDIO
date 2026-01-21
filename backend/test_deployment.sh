#!/bin/bash
# Test script for Photo Memory backend deployment

set -e

API_URL="http://192.168.200.4:8000"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "=========================================="
echo "Photo Memory Backend Deployment Test"
echo "=========================================="
echo ""

# Test 1: Health Check
echo -n "Test 1: Health check... "
HEALTH=$(curl -s ${API_URL}/health)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Services: $(echo $HEALTH | grep -o '"services":{[^}]*}')"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Response: $HEALTH"
    exit 1
fi

# Test 2: Root Endpoint
echo -n "Test 2: Root endpoint... "
ROOT=$(curl -s ${API_URL}/)
if echo "$ROOT" | grep -q '"status":"running"'; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 3: Database - Check if test user exists
echo -n "Test 3: Test user exists... "
DB_USER=$(docker exec photomemory-postgres psql -U photomemory -d photomemory -t -c "SELECT COUNT(*) FROM users WHERE email='test@example.com';")
if [ $(echo $DB_USER | tr -d ' ') -eq 1 ]; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    echo "  Test user not found in database"
    exit 1
fi

# Test 4: Login with test credentials
echo -n "Test 4: Login with test credentials... "
TOKEN_RESPONSE=$(curl -s -X POST ${API_URL}/api/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"test123"}')

TOKEN=$(echo $TOKEN_RESPONSE | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

if [ ! -z "$TOKEN" ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  Token: ${TOKEN:0:20}..."
else
    echo -e "${RED}FAIL${NC}"
    echo "  Response: $TOKEN_RESPONSE"
    exit 1
fi

# Test 5: Get user profile
echo -n "Test 5: Get user profile... "
USER_PROFILE=$(curl -s ${API_URL}/api/auth/me)
if echo "$USER_PROFILE" | grep -q 'test@example.com'; then
    echo -e "${GREEN}PASS${NC}"
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 6: List photos (should be empty)
echo -n "Test 6: List photos... "
PHOTOS=$(curl -s ${API_URL}/api/photos)
if echo "$PHOTOS" | grep -q '\[\]'; then
    echo -e "${GREEN}PASS${NC}"
    echo "  No photos yet (expected)"
else
    echo -e "${YELLOW}WARN${NC}"
    echo "  Found existing photos"
fi

# Test 7: Ollama service
echo -n "Test 7: Ollama service... "
OLLAMA_HEALTH=$(curl -s http://192.168.200.4:11434/api/tags)
if echo "$OLLAMA_HEALTH" | grep -q 'models'; then
    echo -e "${GREEN}PASS${NC}"
    # Check which models are available
    MODELS=$(echo $OLLAMA_HEALTH | grep -o '"name":"[^"]*"' | cut -d'"' -f4)
    echo "  Available models:"
    for model in $MODELS; do
        echo "    - $model"
    done
else
    echo -e "${RED}FAIL${NC}"
    exit 1
fi

# Test 8: PostgreSQL extensions
echo -n "Test 8: PostgreSQL extensions... "
PG_EXTENSIONS=$(docker exec photomemory-postgres psql -U photomemory -d photomemory -t -c "SELECT extname FROM pg_extension WHERE extname IN ('uuid-ossp', 'vector');")
UUID_EXT=$(echo "$PG_EXTENSIONS" | grep -c "uuid-ossp" || true)
VECTOR_EXT=$(echo "$PG_EXTENSIONS" | grep -c "vector" || true)

if [ $UUID_EXT -eq 1 ] && [ $VECTOR_EXT -eq 1 ]; then
    echo -e "${GREEN}PASS${NC}"
    echo "  uuid-ossp: installed"
    echo "  vector: installed"
else
    echo -e "${RED}FAIL${NC}"
    echo "  uuid-ossp: $([ $UUID_EXT -eq 1 ] && echo 'OK' || echo 'MISSING')"
    echo "  vector: $([ $VECTOR_EXT -eq 1 ] && echo 'OK' || echo 'MISSING')"
    exit 1
fi

echo ""
echo "=========================================="
echo -e "${GREEN}All tests passed!${NC}"
echo "=========================================="
echo ""
echo "Next steps:"
echo "1. Download Ollama models: docker exec photomemory-ollama ollama pull moondream"
echo "2. Test photo upload with a sample image"
echo "3. Access MinIO console at http://192.168.200.4:9001 (minioadmin/minioadmin)"
echo ""
