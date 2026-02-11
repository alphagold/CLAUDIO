FROM python:3.10

WORKDIR /app

# Install system dependencies including Docker CLI and face_recognition deps
RUN apt-get update && apt-get install -y \
    curl \
    git \
    netcat-openbsd \
    gcc \
    g++ \
    make \
    libpq-dev \
    docker.io \
    build-essential \
    libopenblas-dev \
    liblapack-dev \
    python3-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Upgrade pip and install build tools
RUN pip install --upgrade pip setuptools wheel

# Install dependencies WITHOUT face_recognition (problematic)
# Face recognition will be optional feature
RUN grep -v "face_recognition\|dlib\|scikit-learn\|opencv-python" requirements.txt > requirements_base.txt && \
    pip install --no-cache-dir -r requirements_base.txt

# Install face recognition stack:
# 1. dlib-bin: pre-compiled wheel (no source compilation)
# 2. face_recognition_models + scikit-learn + opencv
# 3. face_recognition --no-deps: skips dlib>=19.7.0 check (satisfied by dlib-bin)
RUN pip install --no-cache-dir dlib-bin && \
    pip install --no-cache-dir "git+https://github.com/ageitgey/face_recognition_models" && \
    pip install --no-cache-dir scikit-learn opencv-python-headless && \
    pip install --no-cache-dir --no-deps face_recognition==1.3.0 || \
    echo "WARNING: face_recognition not available - feature disabled"

# Patch face_recognition_models to remove pkg_resources dependency.
# pkg_resources (setuptools) can be removed by later pip installs.
# Replace with equivalent os.path implementation.
RUN python3 -c "\
path='/usr/local/lib/python3.10/site-packages/face_recognition_models/__init__.py';\
import os;\
content=open(path).read() if os.path.exists(path) else '';\
patched=content.replace('from pkg_resources import resource_filename','import os as _os\nresource_filename=lambda p,r:_os.path.join(_os.path.dirname(_os.path.abspath(__file__)),r)');\
open(path,'w').write(patched) if content else None;\
print('Patched' if content != patched else 'Already OK or not found')\
" || echo "Patch skipped (face_recognition_models not installed)"

# Copy application code
COPY . .

# Make init script executable
RUN chmod +x /app/init-migrations.sh

# Install postgresql-client for psql command
RUN apt-get update && apt-get install -y postgresql-client && rm -rf /var/lib/apt/lists/*

# Expose port
EXPOSE 8000

# Run FastAPI
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
