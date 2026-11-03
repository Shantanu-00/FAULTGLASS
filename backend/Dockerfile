# One image, six processes. The command decides which one runs:
#   python -m app.api | app.simulator | app.edge | app.watcher | app.investigator | app.verifier
# Build from the repository root so the plant pack is inside the image:
#   docker build -f backend/Dockerfile -t faultglass-backend .

FROM python:3.12-slim AS build
ENV UV_PYTHON_DOWNLOADS=never \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy
RUN pip install --no-cache-dir uv
WORKDIR /app/backend
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev

FROM python:3.12-slim
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PLANT_DIR=/app/plants/waterplant \
    UPLOAD_DIR=/tmp/uploads \
    EDGE_BUFFER_PATH=/tmp/edge_outbox.db
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN useradd --system --create-home --uid 10001 faultglass
COPY --from=build /opt/venv /opt/venv
WORKDIR /app/backend
COPY backend/app ./app
COPY plants/waterplant /app/plants/waterplant
USER faultglass
EXPOSE 8000
CMD ["python", "-m", "app.api"]
