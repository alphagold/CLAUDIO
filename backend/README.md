# Photo Memory Backend

Self-hosted AI-powered photo memory system with Vision AI.

## 🚀 Quick Start

### Prerequisites

- Ubuntu 24.04 LTS (VM or physical)
- IP: 192.168.200.4
- Docker & Docker Compose installed
- At least 16GB RAM
- 100GB storage

### Installation

**1. Copy files to VM**

```bash
# On your local machine, from CLAUDIO repo
scp -r backend andro@192.168.200.4:~/

# SSH into VM
ssh andro@192.168.200.4
```

**2. Install Docker (if not already installed)**

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Logout and login again for group to take effect
exit
# SSH back in
ssh andro@192.168.200.4

# Install Docker Compose
sudo apt install docker-compose-v2 -y

# Verify
docker --version
docker compose version
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
