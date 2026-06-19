# Founder Calendar — FastAPI backend
FROM python:3.11-slim

# Faster, quieter Python in containers.
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install dependencies first so this layer is cached across code changes.
# psycopg2-binary ships as a wheel, so no compiler/libpq-dev is needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application code.
COPY app ./app

EXPOSE 8000

# Config (DATABASE_URL, JWT_SECRET, CORS_ORIGINS, ...) comes from the
# environment supplied by docker-compose — not from a baked-in .env file.
# Startup runs the lightweight migrations in app.main automatically.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
