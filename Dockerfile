# --- Stage 1: Build the React Frontend ---
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# --- Stage 2: Build the FastAPI Backend & Runtime ---
FROM python:3.10-slim

# Prevent python from writing pyc files and buffering stdout/stderr
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system packages including Tesseract OCR for scanned PDF ingestion
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr \
    libtesseract-dev \
    && rm -rf /var/lib/apt/lists/*

# Set up a non-root user (good security practice and standard on PaaS)
RUN useradd -m -u 1000 user
USER user
ENV HOME=/home/user \
    PATH=/home/user/.local/bin:$PATH

WORKDIR $HOME/app

# Copy requirements and install dependencies
COPY --chown=user requirements.txt .
RUN pip install --no-cache-dir --user -r requirements.txt

# Copy built frontend static assets from Stage 1
COPY --from=frontend-builder --chown=user /app/frontend/dist ./frontend/dist

# Copy backend files
COPY --chown=user backend/ ./backend/

WORKDIR $HOME/app/backend

# Create uploads and chroma_db directories inside backend
RUN mkdir -p uploads chroma_db

EXPOSE 7860

# Run FastAPI backend with port fallback to 7860
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-7860}"]
