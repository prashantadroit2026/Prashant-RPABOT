FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN groupadd -r backend && useradd -r -g backend backend

COPY requirements-docker.txt .
RUN pip install -r requirements-docker.txt

COPY src ./src

USER backend

EXPOSE 8080

CMD ["sh", "-c", "cd /app/src && uvicorn main:app --host 0.0.0.0 --port ${PORT:-8080}"]