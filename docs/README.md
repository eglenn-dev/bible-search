# Gospel Library Search — Documentation

Semantic search across the LDS Standard Works, General Conference, and the General Handbook. Queries are matched by **meaning** (sentence embeddings + vector search), not keywords.

This `docs/` directory explains what the project is, how it works, and how to extend it.

## Contents

| Doc | What it covers |
|---|---|
| [architecture.md](./architecture.md) | **How it works** — system overview, data model, embeddings, Atlas Vector Search, the API, the frontend, and the ingestion pipeline. |
| [api.md](./api.md) | **OpenAPI spec & Swagger UI** — interactive docs, the committed `openapi.json`, mocking with Prism, and the endpoint reference. |
| [mcp.md](./mcp.md) | **MCP server for AI agents** — the hosted `/mcp` connector (auto-generated from the OpenAPI spec), how to add it to Claude or other platforms. |
| [ask.md](./ask.md) | **Ask mode** — cited answers from Claude Haiku 5.5 searching the corpora: the `/ask` stream, cost, quotas, the daily spend cap, and logs. |
| [data-sources.md](./data-sources.md) | The six corpora currently indexed, their document schemas, counts, and how deep-links are built. |
| [adding-a-source.md](./adding-a-source.md) | **Step-by-step guide to add a new source** later (backend + ingestion + frontend). |
| [embedding-migration.md](./embedding-migration.md) | **Embedding model upgrade** — the v1 (MiniLM-L3) → v2 (e5-small-v2) migration: the eval behind the switch, storage math, and the cutover/rollback/retirement runbook to reuse for the next model. |
| [project-history.md](./project-history.md) | **What we did** — the migration from in-memory FAISS to MongoDB Atlas, the move to `uv`, the UI refresh, adding the Standard Works, and the gotchas we hit along the way. |

## TL;DR

- **Backend:** Python / FastAPI (`api/`). Encodes *queries* with the active embedding model (`e5-small-v2`, see [embedding-migration.md](./embedding-migration.md)) via **onnxruntime** + `tokenizers` (no torch, no transformers; fits a 512 MB host); all text + embeddings live in MongoDB Atlas. Per-IP rate limited (slowapi).
- **Database:** MongoDB Atlas (free M0) with **Atlas Vector Search**. One collection, `gospel_library.documents`, ~93k documents across six sources, ~193 MB.
- **MCP:** the same deployment hosts a remote **MCP server at `/mcp`** (Streamable HTTP, tools auto-generated from the OpenAPI spec via FastMCP) — see [mcp.md](./mcp.md).
- **Frontend:** TanStack Start (React + Vite) + Tailwind (`client/`). Unified search box, source filter chips, source-tagged result cards. "Classic & scholarly" theme.
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
