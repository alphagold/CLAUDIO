FROM python:3.10

WORKDIR /app

# Install system dependencies including Docker CLI and face_recognition deps
RUN apt-get update && apt-get install -y \
    curl \
    gcc \
    g++ \
    make \
    libpq-dev \
    docker.io \
    cmake \
    build-essential \
    libopenblas-dev \
    liblapack-dev \
    libx11-dev \
    python3-dev \
    libboost-all-dev \
    pkg-config \
    libavcodec-dev \
    libavformat-dev \
    libswscale-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Upgrade pip and install build tools
RUN pip install --upgrade pip setuptools wheel

# Install dependencies WITHOUT face_recognition (problematic)
# Face recognition will be optional feature
RUN grep -v "face_recognition\|dlib\|scikit-learn\|opencv-python" requirements.txt > requirements_base.txt && \
    pip install --no-cache-dir -r requirements_base.txt

# Try to install face_recognition deps (optional - app works without)
RUN pip install --no-cache-dir scikit-learn opencv-python || echo "WARNING: ML dependencies optional install failed"
RUN pip install --no-cache-dir dlib face_recognition || echo "WARNING: face_recognition not available - feature disabled"

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run FastAPI with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
