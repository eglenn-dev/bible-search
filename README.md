<div align="center">
    <h1>Gospel Library Search</h1>
    <p>A semantic search application for the <strong>Standard Works</strong> (Bible, Book of Mormon, Doctrine and Covenants, Pearl of Great Price), <strong>General Conference</strong> addresses, <strong>BYU Speeches</strong> devotionals and forums, and the <strong>General Handbook</strong>. Instead of keyword matching, it uses sentence embeddings and vector search to surface passages that are contextually and semantically related to your query.</p>
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
- [Data sources](./docs/data-sources.md) — the seven corpora, schemas, and deep-link logic.
- [Adding a source](./docs/adding-a-source.md) — step-by-step guide to extend it.
- [Project history](./docs/project-history.md) — what changed and why, plus gotchas.

## How It Works

The project has three parts: a **data ingestion pipeline**, a **backend API**, and a **frontend client**. All text, metadata, and embeddings live in **MongoDB Atlas**, queried with **Atlas Vector Search** — the API never loads the dataset or the embeddings into memory.

[How it works](https://ethanglenn.dev/blog/bible-search) — blog post on the original architecture.

### Data model

A single collection (`documents`) holds every corpus. Each document:

```jsonc
{
  "source": "bible" | "book-of-mormon" | "doctrine-and-covenants" | "pearl-of-great-price" | "conference" | "byu-speeches" | "handbook",
  "text": "<chunk text>",
  "embedding": BinData(float32, 384),   // BSON binary vector, scalar-quantized in the index
  "reference": "Genesis 1:1",
  "title": "...",                        // talk / chapter title (null for Bible)
  "url": "https://www.churchofjesuschrist.org/...#p3",
  "metadata": { /* source-specific: speaker, year, section, book, chapter, ... */ }
}
```

The Atlas Vector Search index (`vector_index`) indexes `embedding` (384-dim, cosine, scalar quantization) with `source`, `metadata.speaker` and `metadata.year` as filter fields (the latter two back the speaker / year filters; see [Applying an index definition change](./docs/architecture.md#applying-an-index-definition-change)). The v2 embedding version adds `embedding_v2` (int8) with its own `vector_index_v2` (same filter fields); `EMBEDDING_VERSION` picks which one the API searches.

### Backend API (`api/`)

- **ONNX runtime** (onnxruntime + `tokenizers`, no torch, no transformers): encodes the user's **query** to a normalized 384-dim vector with the active embedding version's model. That is `paraphrase-MiniLM-L3-v2` by default; `e5-small-v2` (v2) is ready to switch to, see [docs/embedding-migration.md](./docs/embedding-migration.md). The corpora are embedded once, at ingest time. The image stays small enough for a 512 MB host.
- **MongoDB Atlas Vector Search**: a `$vectorSearch` aggregation finds the nearest passages, optionally filtered by `source`, speaker and year.
- **FastAPI** exposes:
  - `GET /search?query=<text>&k=10&sources=bible,conference,handbook` — add `&speaker=<name>&year_from=2010&year_to=2020` to narrow conference / BYU results to one speaker and a span of years
  - `GET /search/by-reference?reference=John%203:16&k=10&sources=...` — reuses a verse's stored embedding (same speaker/year params)
  - `GET /speakers?q=<words>` — normalized speaker names (bylines differ across eras) with talk counts, year spans and the raw byline variants each covers
  - `GET /search/similar?id=<result id>&k=10&sources=...` — "more like this" from any result (any source), skipping the rest of that talk/chapter
  - `GET /passage/context?id=<result id>&before=2&after=2` — a passage with its surrounding verses or paragraphs, in reading order
  - `GET /verse?reference=Alma%2032:21` — one passage's text + link by exact reference
  - `GET /stats` — precomputed corpus analytics for the `/stats` page
  - `GET /` — health check (also pings Atlas)
  - `/docs` — Swagger UI; `/openapi.json` — OpenAPI spec
  - `/mcp` — remote **MCP server** for AI agents (Streamable HTTP, tools auto-generated from the spec via FastMCP)
- Per-IP **rate limiting** via slowapi (`RATE_LIMIT`, default `100/minute`).

### MCP server

The same process hosts a remote MCP server at **`/mcp`**, so agents can use `search`, `search_by_reference`, `search_similar`, `get_passage_context`, `list_speakers` and the other endpoints as tools. Add the URL (e.g. `https://api.gospel.help/mcp`) as a connector — no install required. See [docs/mcp.md](./docs/mcp.md).

### Frontend Client (`client/`)

[TanStack Start](https://tanstack.com/start) (React + Vite) + Tailwind CSS. A unified search box with **source filter chips** (All / Bible / Book of Mormon / D&C / Pearl of Great Price / Conference / BYU Speeches / Handbook), two modes (natural language and scripture reference — the latter works across all Standard Works), a **speaker picker and year range** for Conference / BYU Speeches results, and source-tagged result cards that deep-link back to churchofjesuschrist.org. Any result can be expanded to read its surrounding verses or paragraphs in place, or used as the starting point for a "More like this" search (kept in the URL as `?similar=<id>`, so it can be shared or reloaded). Passages can be **bookmarked** on desktop and mobile (stored on the device), exported as Markdown, or shared as a link.

It's also an installable **PWA**: a Workbox service worker makes the app open offline with saved passages and recent searches still readable, and announces new versions with a "Reload" toast. Installed, it uses the Liquid Glass app layout at every screen size, with a sidebar and a split view on iPad and desktop; in a browser tab, wide screens keep the desktop layout. See [Offline (PWA)](./docs/architecture.md#offline-pwa).

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

Run from the `api/` directory.

#### Keeping everything current — one command

`ingest.sync` is the command to run whenever you want to refresh the database. It is idempotent and self-healing: run it on a healthy database and it only pulls in what's new; run it against an **empty/deleted** database and it rebuilds every corpus from scratch.

```bash
uv run python -m ingest.sync
```

What it does, per source:

- **Standard Works** (Bible + Book of Mormon, D&C, Pearl of Great Price) — the static seed corpora. Ingested **only when missing**, so a fresh database is fully repopulated while a normal refresh skips them.
- **General Conference** & **BYU Speeches** — **incremental**. It re-fetches the listing pages (so newly published talks/speeches aren't hidden by the scrape cache) and ingests only what isn't already stored.
- **General Handbook** — **replaced in full** every run (the Church revises it a few times a year). Fetched fresh, then the old handbook is deleted and the new one inserted — the delete only happens *after* a successful fetch, so a network hiccup can't leave it wiped.

It then ensures the Atlas vector index exists and matches `embeddings.index_definition()` in `api/embeddings.py` (updating it in place, which triggers an Atlas rebuild, if the definition changed) and prints a **before/after diff** plus a **summary of work done** (new talks/speeches, handbook chapters replaced, storage used). Useful flags: `--force-foundational` (re-ingest the Standard Works even if present), `--fresh-years N` (how many recent Conference years to re-check, default 2), and `--skip-conference` / `--skip-byu` / `--skip-handbook`.

#### Per-source / lower-level commands

`ingest.run` ingests a single corpus at a time (sources run in priority order; runs are resumable and cached).

```bash
uv run python -m ingest.run --source bible        # migrate the 31,102 KJV verses
uv run python -m ingest.run --source scriptures   # Book of Mormon, D&C, Pearl of Great Price (from data/new/)
uv run python -m ingest.run --source conference   # scrape General Conference (1971–present)
uv run python -m ingest.run --source byu-speeches # scrape BYU Speeches (speeches.byu.edu)
uv run python -m ingest.run --source handbook     # scrape the General Handbook
# ...or everything, then (re)build the vector index:
uv run python -m ingest.run --source all
uv run python -m ingest.run --create-index
uv run python -m ingest.run --stats               # check storage usage vs. the M0 512MB cap
```

> The scrapers are rate-limited and cache responses on disk: the church corpora fetch churchofjesuschrist.org's content API (`api/ingest/.cache/`), and BYU Speeches fetches speeches.byu.edu's sitemaps + static HTML (`api/ingest/.cache_byu/`). Wait for the Atlas index to report **READY** before querying.

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

The image is API-only. It bakes in the query-side ONNX model and tokenizer for every embedding version listed in the `PREFETCH_EMBEDDING_VERSIONS` build arg (default `v1,v2`), so switching `EMBEDDING_VERSION` needs no rebuild. The frontend is built and deployed separately.

### Deploying

The runtime uses **onnxruntime** (no torch), so the image is small. Peak RSS measured on macOS was ~370 MB with v1 and ~310 MB with v2, including bursts of long concurrent queries. It fits a **512 MB free tier** (Render free, Fly.io, etc.) as well as **GCP Cloud Run** (scale-to-zero). The first request lazily loads the ONNX model (a few seconds).

Required at runtime:
- `MONGODB_URI` — the Atlas connection string.
- Optional: `RATE_LIMIT` (default `100/minute`), `ALLOWED_ORIGINS`, `PORT`, `EMBEDDING_VERSION` (`v1` default, `v2` after the migration in [docs/embedding-migration.md](./docs/embedding-migration.md)).

**Atlas network access:** serverless/free hosts use dynamic outbound IPs, so a single-IP allowlist won't work. Set Atlas → Network Access to `0.0.0.0/0` and rely on the DB credentials (the corpora are public content), or configure a static egress IP.

The frontend is a TanStack Start app deployed to Vercel (project root `client/`): the `nitro()` Vite plugin emits Vercel's Build Output API, and `client/vercel.json` pins the `tanstack-start` framework preset. It needs `VITE_API_DOMAIN` pointing at the deployed API. Elsewhere, `npm run build && npm start` runs it as a plain Node server.
