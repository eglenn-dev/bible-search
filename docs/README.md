# Gospel Library Search — Documentation

Semantic search across the LDS Standard Works, General Conference, and the General Handbook. Queries are matched by **meaning** (sentence embeddings + vector search), not keywords.

This `docs/` directory explains what the project is, how it works, and how to extend it.

## Contents

| Doc | What it covers |
|---|---|
| [architecture.md](./architecture.md) | **How it works** — system overview, data model, embeddings, Atlas Vector Search, the API, the frontend, and the ingestion pipeline. |
| [data-sources.md](./data-sources.md) | The six corpora currently indexed, their document schemas, counts, and how deep-links are built. |
| [adding-a-source.md](./adding-a-source.md) | **Step-by-step guide to add a new source** later (backend + ingestion + frontend). |
| [project-history.md](./project-history.md) | **What we did** — the migration from in-memory FAISS to MongoDB Atlas, the move to `uv`, the UI refresh, adding the Standard Works, and the gotchas we hit along the way. |

## TL;DR

- **Backend:** Python / FastAPI (`api/`). Loads `paraphrase-MiniLM-L3-v2` only to encode *queries*; all text + embeddings live in MongoDB Atlas.
- **Database:** MongoDB Atlas (free M0) with **Atlas Vector Search**. One collection, `gospel_library.documents`, ~93k documents across six sources, ~193 MB.
- **Frontend:** React + Vite + Tailwind (`client/`). Unified search box, source filter chips, source-tagged result cards. "Classic & scholarly" theme.
- **Package manager:** [`uv`](https://docs.astral.sh/uv/) for the Python side.

## Quick start

```bash
# 1. Backend (needs MONGODB_URI in api/.env — see architecture.md)
cd api
uv sync
uv run uvicorn app:app --port 10000

# 2. Frontend (new terminal)
cd client
echo 'VITE_API_DOMAIN=http://localhost:10000' > .env.local
npm install && npm run dev      # http://localhost:5173
```

The data is already ingested in Atlas. To (re)load or refresh it, see [data-sources.md](./data-sources.md) and [adding-a-source.md](./adding-a-source.md).
