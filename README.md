<div align="center">
    <h1>Gospel Library Search</h1>
    <p>A semantic search application for the <strong>Standard Works</strong> (Bible, Book of Mormon, Doctrine and Covenants, Pearl of Great Price), <strong>General Conference</strong> addresses, and the <strong>General Handbook</strong>. Instead of keyword matching, it uses sentence embeddings and vector search to surface passages that are contextually and semantically related to your query.</p>
    <p>
        <img alt="Python" src="https://img.shields.io/badge/-Python-3776AB?style=flat-square&logo=python&logoColor=white" />
        <img alt="FastAPI" src="https://img.shields.io/badge/-FastAPI-009688?style=flat-square&logo=fastapi&logoColor=white" />
        <img alt="MongoDB" src="https://img.shields.io/badge/-MongoDB%20Atlas-47A248?style=flat-square&logo=mongodb&logoColor=white" />
        <img alt="React" src="https://img.shields.io/badge/-React-61DAFB?style=flat-square&logo=react&logoColor=black" />
        <img alt="Vite" src="https://img.shields.io/badge/-Vite-646CFF?style=flat-square&logo=vite&logoColor=white" />
    </p>
</div>

## Documentation

Full docs live in [`docs/`](./docs/README.md):
- [Architecture](./docs/architecture.md) — how it works (data model, embeddings, vector search, API, frontend, ingestion).
- [API & Swagger](./docs/api.md) — OpenAPI spec, interactive Swagger UI (`/docs`), and mocking.
- [MCP server](./docs/mcp.md) — the hosted `/mcp` connector for AI agents (auto-generated from the OpenAPI spec).
- [Data sources](./docs/data-sources.md) — the six corpora, schemas, and deep-link logic.
- [Adding a source](./docs/adding-a-source.md) — step-by-step guide to extend it.
- [Project history](./docs/project-history.md) — what changed and why, plus gotchas.

## How It Works

The project has three parts: a **data ingestion pipeline**, a **backend API**, and a **frontend client**. All text, metadata, and embeddings live in **MongoDB Atlas**, queried with **Atlas Vector Search** — the API never loads the dataset or the embeddings into memory.

[How it works](https://ethanglenn.dev/blog/bible-search) — blog post on the original architecture.

### Data model

A single collection (`documents`) holds every corpus. Each document:

```jsonc
{
  "source": "bible" | "book-of-mormon" | "doctrine-and-covenants" | "pearl-of-great-price" | "conference" | "handbook",
  "text": "<chunk text>",
  "embedding": BinData(float32, 384),   // BSON binary vector, scalar-quantized in the index
  "reference": "Genesis 1:1",
  "title": "...",                        // talk / chapter title (null for Bible)
  "url": "https://www.churchofjesuschrist.org/...#p3",
  "metadata": { /* source-specific: speaker, year, section, book, chapter, ... */ }
}
```

The Atlas Vector Search index (`vector_index`) indexes `embedding` (384-dim, cosine, scalar quantization) with `source` as a filter field.

### Backend API (`api/`)

- **Sentence Transformers** (`paraphrase-MiniLM-L3-v2`): encodes the user's **query** to a normalized 384-dim vector. (The corpora are embedded once, at ingest time.)
- **MongoDB Atlas Vector Search**: a `$vectorSearch` aggregation finds the nearest passages, optionally filtered by `source`.
- **FastAPI** exposes:
  - `GET /search?query=<text>&k=10&sources=bible,conference,handbook`
  - `GET /search/by-reference?reference=John%203:16&k=10&sources=...` — reuses a verse's stored embedding
  - `GET /` — health check (also pings Atlas)
  - `/docs` — Swagger UI; `/openapi.json` — OpenAPI spec
  - `/mcp` — remote **MCP server** for AI agents (Streamable HTTP, tools auto-generated from the spec via FastMCP)
- Per-IP **rate limiting** via slowapi (`RATE_LIMIT`, default `100/minute`).

### MCP server

The same process hosts a remote MCP server at **`/mcp`**, so agents can use `search` / `search_by_reference` as tools. Add the URL (e.g. `https://api.bible.eglenn.dev/mcp`) as a connector — no install required. See [docs/mcp.md](./docs/mcp.md).

### Frontend Client (`client/`)

React + Vite + Tailwind CSS. A unified search box with **source filter chips** (All / Bible / Conference / Handbook), two modes (natural language and scripture reference), and source-tagged result cards that deep-link back to churchofjesuschrist.org.

## Getting Started Locally

You'll need **Node.js**, **[uv](https://docs.astral.sh/uv/)** (the Python package manager), and a **MongoDB Atlas** cluster (the free M0 tier works). uv manages Python itself, so a separate Python install isn't required.

### 1. Configure the database

1. Create an Atlas cluster and a database user with read/write access.
2. Copy `api/.env.example` to `api/.env` and set `MONGODB_URI` (plus `MONGODB_DB`, `MONGODB_COLLECTION` if you want to override the defaults).

### 2. Backend setup

```bash
cd api
uv sync          # creates .venv and installs the locked dependencies
```

> `uv sync` reads `pyproject.toml` + `uv.lock`. Prefix commands with `uv run` to use the project environment (no manual `activate` needed).

### 3. Ingest the data

Run from the `api/` directory. Sources run in priority order; runs are resumable and cached.

```bash
uv run python -m ingest.run --source bible        # migrate the 31,102 KJV verses
uv run python -m ingest.run --source scriptures   # Book of Mormon, D&C, Pearl of Great Price (from data/new/)
uv run python -m ingest.run --source conference   # scrape General Conference (1971–present)
uv run python -m ingest.run --source handbook     # scrape the General Handbook
# ...or everything, then (re)build the vector index:
uv run python -m ingest.run --source all
uv run python -m ingest.run --create-index
uv run python -m ingest.run --stats               # check storage usage vs. the M0 512MB cap
```

> The scrapers fetch from churchofjesuschrist.org's content API, are rate-limited, and cache responses under `api/ingest/.cache/`. Wait for the Atlas index to report **READY** before querying.

### 4. Run the API

```bash
uv run uvicorn app:app --host 0.0.0.0 --port 10000   # http://localhost:10000
```

### 5. Run the client

```bash
cd client
npm install
# point the client at the API:
echo 'VITE_API_DOMAIN=http://localhost:10000' > .env.local
npm run dev                                    # http://localhost:5173
```

## Docker (API)

```bash
docker build -t gospel-library-search .
docker run -e MONGODB_URI="mongodb+srv://..." -p 10000:10000 gospel-library-search
```

The image is API-only and bakes in the embedding model; the frontend is built and deployed separately.
