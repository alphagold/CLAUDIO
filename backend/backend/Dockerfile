FROM python:3.10

WORKDIR /app

# Install system dependencies including Docker CLI and face_recognition deps
RUN apt-get update && apt-get install -y \
    curl \
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

# Install dlib pre-compiled wheel (no compilation needed)
# face_recognition requires dlib>=19.7.0, but dlib-bin provides the same module
# with a different package name - use --no-deps to skip pip's dependency check
RUN pip install --no-cache-dir dlib-bin && \
    pip install --no-cache-dir --no-deps face_recognition==1.3.0 && \
    pip install --no-cache-dir face-recognition-models scikit-learn opencv-python-headless || \
    echo "WARNING: face_recognition not available - feature disabled"

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
