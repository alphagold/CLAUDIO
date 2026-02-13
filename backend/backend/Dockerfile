FROM python:3.10

WORKDIR /app

# Install system dependencies including Docker CLI
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
    python3-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Upgrade pip and install build tools
RUN pip install --upgrade pip setuptools wheel

# Install dependencies WITHOUT face recognition stack
RUN grep -v "insightface\|onnxruntime\|scikit-learn\|opencv-python" requirements.txt > requirements_base.txt && \
    pip install --no-cache-dir -r requirements_base.txt

# Install InsightFace stack (graceful degradation se fallisce)
RUN pip install --no-cache-dir \
    insightface>=0.7.3 \
    onnxruntime>=1.16.0 \
    scikit-learn \
    opencv-python-headless || \
    echo "WARNING: insightface not available - face recognition feature disabled"

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
