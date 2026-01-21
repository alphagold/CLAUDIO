# Photo Memory Backend

Self-hosted AI-powered photo memory system with Ollama Vision AI.

## 🎯 System Overview

- **Backend**: FastAPI (Python 3.11)
- **Database**: PostgreSQL 16 + pgvector for semantic search
- **Vision AI**: Ollama with Moondream (2B) and Llama 3.2 Vision (11B)
- **Storage**: MinIO (S3-compatible)
- **Cache**: Redis
- **Deployment**: Docker Compose

## 📋 Prerequisites

- Ubuntu 24.04 LTS (VM or physical)
- Static IP configured: 192.168.200.4
- Docker & Docker Compose installed
- At least 16GB RAM (27GB free recommended)
- 100GB storage for models and photos

## 🚀 One-Command Deployment

### Step 1: Clone Repository on VM

```bash
# SSH into VM as root
ssh root@192.168.200.4

# Navigate to home directory
cd /home/andro/PhotoMemory

# Clone repository (if not already cloned)
git clone https://github.com/alphagold/CLAUDIO.git

# Copy backend folder
cp -r CLAUDIO/backend .
cd backend
```

### Step 2: Deploy with Docker Compose

```bash
# Remove old volumes if redeploying
docker compose down -v

# Start all services
docker compose up -d

# Wait for services to be ready (30 seconds)
sleep 30

# Verify all containers are running
docker compose ps
```

### Step 3: Download Ollama Models

```bash
# Download Moondream (fast, 1.7GB)
docker exec photomemory-ollama ollama pull moondream

# Optional: Download Llama 3.2 Vision (accurate, 7.9GB)
# docker exec photomemory-ollama ollama pull llama3.2-vision

# Verify models are downloaded
docker exec photomemory-ollama ollama list
```

### Step 4: Run Tests

```bash
# Make test script executable
chmod +x test_deployment.sh

# Run comprehensive tests
./test_deployment.sh
```

## ✅ Expected Test Results

All tests should pass:
- ✓ Health check
- ✓ Root endpoint
- ✓ Test user exists in database
- ✓ Login with test credentials
- ✓ Get user profile
- ✓ List photos (empty initially)
- ✓ Ollama service with models
- ✓ PostgreSQL extensions (uuid-ossp, vector)

## 🔑 Default Credentials

**Test User**:
- Email: `test@example.com`
- Password: `test123`

**MinIO Console** (http://192.168.200.4:9001):
- Username: `minioadmin`
- Password: `minioadmin`

**PostgreSQL**:
- Database: `photomemory`
- User: `photomemory`
- Password: `photomemory123`

## 📡 API Endpoints

Base URL: `http://192.168.200.4:8000`

### Health & Info
- `GET /` - Root endpoint
- `GET /health` - Health check with service status

### Authentication
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/me` - Get current user info

### Photos
- `POST /api/photos` - Upload photo (multipart/form-data)
- `GET /api/photos` - List user's photos
- `GET /api/photos/{id}` - Get photo details
- `GET /api/photos/{id}/download` - Download original photo
- `DELETE /api/photos/{id}` - Soft delete photo

### Search
- `POST /api/search` - Search photos with natural language

## 🧪 Manual API Testing

### 1. Health Check

```bash
curl http://192.168.200.4:8000/health
```

### 2. Login

```bash
curl -X POST http://192.168.200.4:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}'
```

### 3. Upload Photo

```bash
# Get token first
TOKEN=$(curl -s -X POST http://192.168.200.4:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' \
  | grep -o '"access_token":"[^"]*"' | cut -d'"' -f4)

# Upload a test photo
curl -X POST http://192.168.200.4:8000/api/photos \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/path/to/your/photo.jpg" \
  -F "taken_at=$(date -Iseconds)"
```

### 4. List Photos

```bash
curl http://192.168.200.4:8000/api/photos
```

### 5. Search Photos

```bash
curl -X POST http://192.168.200.4:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query":"foto di cibo","limit":10}'
```

## 🔍 Troubleshooting

### Check Logs

```bash
# All services
docker compose logs

# Specific service
docker compose logs api
docker compose logs postgres
docker compose logs ollama

# Follow logs in real-time
docker compose logs -f api
```

### Database Access

```bash
# Connect to PostgreSQL
docker exec -it photomemory-postgres psql -U photomemory -d photomemory

# Useful queries
SELECT * FROM users;
SELECT id, original_path, analyzed_at FROM photos;
SELECT photo_id, description_short FROM photo_analysis;
```

### Reset Database

```bash
docker compose down
docker volume rm backend_postgres_data
docker compose up -d
```

### Check Ollama Models

```bash
# List downloaded models
docker exec photomemory-ollama ollama list

# Test a model
docker exec -it photomemory-ollama ollama run moondream "Describe this"
```

### Common Issues

**1. "extension vector is not available"**
- Fixed: Using pgvector/pgvector:pg16 image
- Extension name is `vector` not `pgvector`

**2. "Invalid credentials" on login**
- Check if test user exists: `docker exec photomemory-postgres psql -U photomemory -d photomemory -c "SELECT * FROM users;"`
- If empty, database wasn't initialized - reset with `docker volume rm backend_postgres_data`

**3. Ollama model not found**
- Download model: `docker exec photomemory-ollama ollama pull moondream`
- Check available models: `docker exec photomemory-ollama ollama list`

**4. Photo analysis timeout**
- Moondream should complete in 5-10 seconds on i7-10700
- Check Ollama logs: `docker logs photomemory-ollama`

## 📊 Service Ports

- **8000**: FastAPI backend
- **5432**: PostgreSQL (internal use)
- **6379**: Redis (internal use)
- **9000**: MinIO API
- **9001**: MinIO Console (web UI)
- **11434**: Ollama API

## 🛠 Development

### Local Development

```bash
cd backend

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Set environment variables
export DATABASE_URL="postgresql://photomemory:photomemory123@192.168.200.4:5432/photomemory"
export OLLAMA_HOST="http://192.168.200.4:11434"

# Run development server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

## 📁 Project Structure

```
backend/
├── backend/              # Python application
│   ├── main.py          # FastAPI app & routes
│   ├── config.py        # Settings & environment variables
│   ├── database.py      # Database connection
│   ├── models.py        # SQLAlchemy models
│   ├── schemas.py       # Pydantic schemas
│   ├── vision.py        # Ollama Vision client
│   ├── requirements.txt # Python dependencies
│   └── Dockerfile       # API container image
├── docker-compose.yml   # Service orchestration
├── init.sql            # Database initialization
├── test_deployment.sh  # Deployment test script
└── README.md           # This file
```

## 🔄 Update Deployment

```bash
# On VM
cd /home/andro/PhotoMemory/CLAUDIO
git pull

cd /home/andro/PhotoMemory
rm -rf backend
cp -r CLAUDIO/backend .
cd backend

# Rebuild and restart (preserves data volumes)
docker compose up -d --build

# Or full reset (deletes all data)
docker compose down -v
docker compose up -d
```

## 📝 Notes

- **Worker service**: Currently disabled (commented in docker-compose.yml) as photo analysis runs synchronously
- **JWT Authentication**: Test user endpoint bypasses JWT for development - implement proper JWT extraction for production
- **Full-text search index**: Commented out in init.sql due to IMMUTABLE function error - can be added later with generated column
- **MinIO**: Optional, photos are stored in local `/app/uploads` volume for now

## 🎯 Next Steps

1. ✅ Deploy and test backend
2. ⏳ Build Android app (Flutter/React Native)
3. ⏳ Implement semantic search with embeddings
4. ⏳ Add thumbnail generation
5. ⏳ Setup HAProxy/Nginx reverse proxy
6. ⏳ Implement proper Celery worker for async processing
7. ⏳ Add photo collections/albums
8. ⏳ Geolocation features with maps

## 📄 License

MIT License - See LICENSE file for details
```

**3. Start services**

```bash
cd ~/backend

# Start all services
docker compose up -d

# Check status
docker compose ps

# View logs
docker compose logs -f
```

**4. Download Ollama Vision models**

```bash
# Make script executable
chmod +x scripts/download_models.sh

# Download models (takes 5-10 minutes)
./scripts/download_models.sh
```

Expected output:
```
📥 Downloading Moondream 2B (fast model)...
✅ moondream downloaded (1.7GB)

📥 Downloading Llama 3.2 Vision 11B quantized...
✅ llama3.2-vision:11b-q4_K_M downloaded (7.9GB)
```

**5. Test API**

```bash
# Health check
curl http://192.168.200.4:8000/health

# Expected response:
# {"status":"ok","version":"1.0.0",...}
```

## 📋 Services

Once running, you have:

- **FastAPI Backend**: http://192.168.200.4:8000
  - Swagger docs: http://192.168.200.4:8000/docs
- **MinIO Console**: http://192.168.200.4:9001
  - User: minioadmin
  - Pass: minioadmin
- **PostgreSQL**: localhost:5432
  - Database: photomemory
  - User: photomemory
  - Pass: photomemory123
- **Redis**: localhost:6379
- **Ollama**: http://192.168.200.4:11434

## 🧪 Testing

### Test Upload Photo

```bash
# Upload a test photo
curl -X POST http://192.168.200.4:8000/api/photos \
  -F "file=@/path/to/your/photo.jpg" \
  -F "taken_at=$(date -Iseconds)"

# Response will include:
# - photo_id
# - analysis (description, objects, tags)
# - processing_time_ms
```

### Test Search

```bash
# Search photos
curl -X POST http://192.168.200.4:8000/api/search \
  -H "Content-Type: application/json" \
  -d '{"query": "pizza", "limit": 10}'
```

### Test Login

```bash
# Login with test user
curl -X POST http://192.168.200.4:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@photomemory.local",
    "password": "test123"
  }'

# You'll get an access_token
```

## 📊 Performance Benchmarks

Run these tests to measure your i7-10700 CPU performance:

```bash
# Test 1: Moondream (fast model)
time curl -X POST http://192.168.200.4:8000/api/photos \
  -F "file=@test.jpg"

# Expected: 2-4 seconds

# Test 2: Upload 10 photos
for i in {1..10}; do
  curl -X POST http://192.168.200.4:8000/api/photos \
    -F "file=@test.jpg" &
done
wait

# Monitor CPU usage
htop
```

## 🐛 Troubleshooting

### Services won't start

```bash
# Check logs
docker compose logs ollama
docker compose logs api

# Restart services
docker compose restart
```

### Ollama out of memory

```bash
# Check RAM usage
free -h

# If low, reduce concurrent processing
# Edit docker-compose.yml:
# OLLAMA_NUM_PARALLEL=1
# OLLAMA_MAX_LOADED_MODELS=1

docker compose up -d
```

### Models not downloading

```bash
# Check Ollama container
docker exec photomemory-ollama ollama list

# Manual download
docker exec photomemory-ollama ollama pull moondream

# Check disk space
df -h
```

### API errors

```bash
# Check API logs
docker compose logs api

# Check database connection
docker exec photomemory-postgres psql -U photomemory -d photomemory -c "SELECT COUNT(*) FROM users;"

# Restart API
docker compose restart api
```

## 📁 Project Structure

```
backend/
├── docker-compose.yml       # Docker services
├── init.sql                 # Database schema
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── main.py             # FastAPI app
│   ├── models.py           # Database models
│   ├── schemas.py          # API schemas
│   ├── vision.py           # Ollama client
│   ├── database.py         # DB connection
│   ├── config.py           # Settings
│   └── worker.py           # Celery worker
├── scripts/
│   └── download_models.sh  # Download Ollama models
└── uploads/                # Photo storage (created automatically)
```

## 🔧 Configuration

Edit `docker-compose.yml` to customize:

- Database credentials
- MinIO credentials
- JWT secret
- Port mappings

## 📝 Next Steps

1. ✅ Backend running locally
2. ⏳ Configure HAProxy (expose to internet)
3. ⏳ Build Android app
4. ⏳ Add GPU boost (PC RTX 3060)

## 🆘 Support

- GitHub Issues: https://github.com/alphagold/CLAUDIO/issues
- Logs location: `docker compose logs -f`

---

**Version**: 1.0.0
**Created**: 2026-01-20
**Author**: Claude Code + alphagold
