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

# Install dlib with verbose output to see errors
RUN pip install --no-cache-dir --verbose dlib==19.24.0

# Install remaining dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY . .

# Expose port
EXPOSE 8000

# Run FastAPI with uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--reload"]
