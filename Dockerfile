# Use the official Python image from Docker Hub
FROM python:3.11-slim

# Bring in the uv binaries from the official image (pinned)
COPY --from=ghcr.io/astral-sh/uv:0.11.21 /uv /uvx /bin/

# Set the working directory in the container
WORKDIR /app

# Prevent .pyc files and ensure stdout/stderr are flushed
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
# Cache the embedding model inside the image so cold starts are fast
ENV HF_HOME=/app/.hf_cache
# uv: compile bytecode, copy into the image, and use the base image's Python
ENV UV_COMPILE_BYTECODE=1
ENV UV_LINK_MODE=copy
ENV UV_PYTHON_DOWNLOADS=never

# Install dependencies first so this layer is cached unless the lock changes
COPY api/pyproject.toml api/uv.lock api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project

# Put the project virtualenv on PATH
ENV PATH="/app/.venv/bin:$PATH"

# Pre-cache the ONNX model + tokenizer at build time (no torch needed)
RUN python -c "from huggingface_hub import hf_hub_download; hf_hub_download('sentence-transformers/paraphrase-MiniLM-L3-v2', 'onnx/model.onnx'); from transformers import AutoTokenizer; AutoTokenizer.from_pretrained('sentence-transformers/paraphrase-MiniLM-L3-v2')"
# Everything is cached now — run fully offline so cold starts don't fetch
ENV HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1

# Copy the application code
COPY api/ .

# Expose the port the app runs on
EXPOSE 10000

# Serves the REST API, Swagger UI (/docs), and the MCP endpoint (/mcp).
# --proxy-headers so the real client IP (X-Forwarded-For) reaches rate limiting.
# MONGODB_URI must be supplied at runtime, e.g.:
#   docker run -e MONGODB_URI="mongodb+srv://..." -p 10000:10000 gospel-library-search
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "10000", \
     "--proxy-headers", "--forwarded-allow-ips", "*"]
