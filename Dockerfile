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

# Pre-download the query-encoding model at build time
RUN python -c "from sentence_transformers import SentenceTransformer; SentenceTransformer('paraphrase-MiniLM-L3-v2')"

# Copy the application code
COPY api/ .

# Expose the port the app runs on
EXPOSE 10000

# MONGODB_URI must be supplied at runtime, e.g.:
#   docker run -e MONGODB_URI="mongodb+srv://..." -p 10000:10000 gospel-library-search
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "10000"]
