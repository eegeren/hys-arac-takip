# ---- Stage 1: Next.js build & export ----
FROM node:20-alpine AS webbuild
WORKDIR /app
COPY web/package.json web/package-lock.json ./web/
RUN cd web && npm ci
COPY web ./web
RUN cd web && npm run build

# ---- Stage 2: FastAPI + serve static ----
FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    TZ=Europe/Istanbul \
    STATIC_DIR=/app/webout
COPY api/requirements.txt ./api/requirements.txt
RUN pip install --no-cache-dir -r api/requirements.txt
COPY api ./api
COPY --from=webbuild /app/web/out /app/webout
WORKDIR /app/api
EXPOSE 8000
CMD ["uvicorn","main:app","--host","0.0.0.0","--port","8000"]