# Architecture — How It Works

## System overview

```
 Ingestion (run locally, one-time + on updates)
   read/scrape ─► chunk ─► embed (each written version) ─► upsert docs w/ binData vectors ─► ensure vector index
        │
        ▼
 MongoDB Atlas (free M0)
   gospel_library.documents   ── one collection, all sources
   vector_index               ── Atlas Vector Search index on `embedding` (v1; cosine, 384-dim, source filter)
   vector_index_v2            ── same, on `embedding_v2` (v2; once migrated)
        ▲
        │  $vectorSearch  (optionally filtered by source)
 FastAPI  (api/)
   loads the active version's model to encode QUERIES only — never the dataset
   GET /search · GET /search/by-reference · GET /
        ▲
        │  fetch
 React + Vite + Tailwind  (client/)
   unified search box · source filter chips · source-tagged result cards
```

The defining choice: **embeddings live in the database, not in process memory.** The API holds only the query-encoder model (~35–70 MB on disk) and asks Atlas to do the nearest-neighbor search. This is what lets the corpus grow to ~93k documents (and beyond) without the API's memory growing with it. (The previous design loaded a FAISS index of all vectors into RAM at startup — see [project-history.md](./project-history.md).)

## The embedding model

- **Models, by version** (`api/embeddings.py`). Each version owns one document field and one vector index, so two models' vectors can coexist and switching is a config flip:
  - **v1** (default): `paraphrase-MiniLM-L3-v2`, mean pooling. Stored in `embedding` (float32), indexed by `vector_index`.
  - **v2**: `intfloat/e5-small-v2`, mean pooling with `query: ` / `passage: ` prefixes. Stored in `embedding_v2` (int8), indexed by `vector_index_v2`. See [embedding-migration.md](./embedding-migration.md).
  - Both produce **384-dimensional**, L2-normalized vectors and run on CPU.
- **Runtime: ONNX, no torch, no transformers.** `api/encoder.py` describes each model with a `ModelSpec`: repo, query-side and passage-side ONNX files, pooling (mean or CLS), prefixes, and truncation (512 tokens). It runs the ONNX export with **onnxruntime** and the repo's `tokenizer.json` (via `tokenizers`), then pools and L2-normalizes the vectors itself. The output is identical to the transformers-tokenizer path (cosine 1.0 on 10k corpus texts). Inference is serialized with a lock, so concurrent requests don't each allocate activation buffers on a small host.
- **Queries and passages are encoded separately**, because models like e5 expect different prefixes on each side:
  - **Ingestion** (`api/ingest/common.py::embed_records` → `embeddings.encode_passages`) embeds each document's `text` for every version in `EMBEDDING_WRITE_VERSIONS`.
  - **Query time** (`api/app.py::_encode` → `embeddings.encode_query`) embeds the user's query with the active version (`EMBEDDING_VERSION`).
- The Atlas cosine score lands in 0–1. Different models spread their scores differently, so the recency lift's default weight is set per version.

> A version's vectors must all come from the same model. Changing the model means a new version: re-embed everything into its own field with `python -m ingest.reembed`, then flip `EMBEDDING_VERSION`.

## Data model

One MongoDB collection — `gospel_library.documents` — holds every source. Each document:

```jsonc
{
  "_id": "conference:/general-conference/2024/04/11oaks:p2",  // deterministic → idempotent upserts
  "source": "bible" | "book-of-mormon" | "doctrine-and-covenants"
          | "pearl-of-great-price" | "conference" | "handbook",
  "text": "<the chunk/verse text that gets embedded>",
  "embedding": BinData(float32, 384),     // v1 vector: BSON binary vector (compact; see below)
  "embedding_v2": BinData(int8, 384),     // v2 vector, once backfilled (see embedding-migration.md)
  "reference": "Genesis 1:1",             // human label (verse ref / talk title / section)
  "title": "In the Beginning…",           // talk/chapter title; null for scripture verses
  "url": "https://www.churchofjesuschrist.org/...#p2",  // precomputed deep link
  "metadata": { /* source-specific — see data-sources.md */ }
}
```

### Why `binData` vectors + quantization
- A JSON array of 384 numbers stores each as an 8-byte double → ~3 KB/vector. Storing them as a BSON **float32 `binData`** vector (`bson.binary.Binary.from_vector(..., FLOAT32)`) halves that to ~1.5 KB.
- The Atlas index additionally uses **scalar (int8) quantization**, shrinking the in-index footprint further.
- v2 stores **int8 `binData`** vectors (~405 B each). We quantize them ourselves with a per-vector scale, which cosine ignores. Its index therefore sets no `quantization`: Atlas skips non-float vectors under automatic quantization.
- Net effect: the corpus is ~137k docs and ~356 MB as of October 2026, against the M0 **512 MB** cap (uncompressed BSON + index bytes). `embeddings.stored_query_vector()` turns a stored vector back into a `queryVector`, which `/search/by-reference` uses.

### The vector index
Created by `api/ingest/common.py::ensure_vector_index(version)` (idempotent — skips if it already exists). The definition comes from `embeddings.index_definition()`. For v1:

```jsonc
{
  "fields": [
    { "type": "vector", "path": "embedding", "numDimensions": 384,
      "similarity": "cosine", "quantization": "scalar" },
    { "type": "filter", "path": "source" }   // enables fast source filtering inside $vectorSearch
  ]
}
```

Atlas builds the index **asynchronously**; new documents are indexed automatically as they're inserted (no rebuild needed when you add a source). Wait until it reports `READY`/`queryable` before querying a fresh index.

## Backend API (`api/`)

| File | Responsibility |
|---|---|
| `app.py` | The FastAPI REST app (`api`), the FastMCP server, per-IP rate limiting, and the composite ASGI app (`app`) that serves both. The query-encoder model loads lazily on first search. |
| `db.py` | Atlas access layer: client singleton, `vector_search()` (against the active version's field/index), `find_by_reference()`, `log_query()` (best-effort search analytics), `VALID_SOURCES`, config. |
| `embeddings.py` | Embedding versions (model → field, index, storage dtype, recency default), `EMBEDDING_VERSION` / `EMBEDDING_WRITE_VERSIONS`, query/passage encoding into BSON vectors, index definitions, and `python -m embeddings --prefetch` (used by the Dockerfile). |
| `encoder.py` | Model-aware ONNX encoder: `ModelSpec`s, pooling, prefixes, `encode_query` / `encode_passages`. |
| `export_openapi.py` | Writes the committed `openapi.json`. |

`app.py` composes two things into one ASGI app served by `uvicorn app:app`:
- **`api`** — the FastAPI app with the REST routes + CORS + slowapi rate limiting.
- **`mcp`** — `FastMCP.from_fastapi(api)`, served at `/mcp` over Streamable HTTP. A Starlette parent mounts the MCP route + the REST app as catch-all and runs the MCP session-manager lifespan. See [mcp.md](./mcp.md) and [api.md](./api.md).

Config comes from `api/.env` (loaded via `python-dotenv`): `MONGODB_URI` (required), `MONGODB_DB` (`gospel_library`), `MONGODB_COLLECTION` (`documents`), `EMBEDDING_VERSION` (`v1`; the version used for search), `EMBEDDING_WRITE_VERSIONS` (default: the active version; set `v1,v2` while both exist), `VECTOR_INDEX_NAME` (v1's index, `vector_index`), `VECTOR_INDEX_NAME_V2` (`vector_index_v2`), optional `EMBED_ONNX_FILE` (swaps the active model's query-side ONNX file), optional `RECENCY_WEIGHT` (overrides the version's default), `MONGODB_QUERY_LOG_COLLECTION` (`query_logs`), optional `ALLOWED_ORIGINS`, optional `RATE_LIMIT` (default `100/minute`), optional `LOG_QUERIES` (default on; set `0` to disable query logging).

### Query logging (analytics)

`/search` and `/search/by-reference` record each user search into a **separate** `query_logs` collection — kept apart from `documents` so it never touches the vector index. Each log doc holds `endpoint`, `query`, the filter params `k` and `sources`, `result_count`, `result_ids` (the deterministic `_id` of each returned passage, in result order), `ip`, `user_agent`, and a UTC `created_at`. The write is scheduled as a **FastAPI background task** (runs after the response is sent, so it adds no latency to search) and is **best-effort**: `db.log_query()` swallows and logs any error so a logging hiccup can never break a search. The `/verse` preview lookup is *not* logged (it fires on every keystroke while typing a reference). Toggle the whole feature with `LOG_QUERIES`.

### Endpoints

- **`GET /`** — health check; also pings Atlas. Returns `{"message": "Online!"}` or 503.
- **`GET /search?query=<text>&k=10&sources=<csv>`** — encodes the query, runs `$vectorSearch`. `sources` is an optional comma-separated subset (`bible,conference,…`); omit for all. Returns `{ query, results: [...] }`.
- **`GET /search/by-reference?reference=<ref>&k=10&sources=<csv>`** — looks up a document by exact `reference`, **reuses its stored embedding** (no re-encode), and drops the self-match. Powers the "Scripture Reference" mode.
- **`GET /verse?reference=<ref>`** — returns a single passage's text + deep link by exact reference (any Standard Work). Used by the frontend to validate/preview a reference.
- **`/docs`, `/redoc`, `/openapi.json`** — Swagger UI, ReDoc, and the OpenAPI spec.
- **`/mcp`** — the MCP server (Streamable HTTP) for AI agents.

`db.vector_search()` builds the aggregation: a `$vectorSearch` stage (`numCandidates = clamp(limit*20, 150, 10000)`, optional `filter: { source: { $in: [...] } }`) followed by a `$project` that returns `source, reference, text, title, url, metadata` and `score: { $meta: "vectorSearchScore" }`. Only sources in `VALID_SOURCES` are honored as filters.

## Frontend (`client/`)

React 19 + Vite + Tailwind v4 + a few shadcn/ui primitives. Key pieces:

| File | Responsibility |
|---|---|
| `src/App.tsx` | Layout, mode toggle (Natural / Scripture Reference), holds the selected `sources`. |
| `src/components/sources-filter.tsx` | The All / Bible / … filter chips. |
| `src/components/search-box.tsx` | Natural-language search → `GET /search`. |
| `src/components/scripture-box.tsx` | Verse-reference search → `GET /search/by-reference`; validates/previews the reference (any Standard Work) via `GET /verse`, debounced. |
| `src/components/render-results.tsx` | Result cards: source badge, metadata line, relevance bar, deep-link via `result.url`. |
| `src/lib/types.ts` | `Source` union + `Result`/`ResultMetadata` types. |
| `src/index.css` | "Classic & scholarly" theme tokens + serif fonts. |
| `src/components/mobile/` | The phone layout (see below): `mobile-app.tsx` is the shell; the rest are its tab bar, sheets, cards and controls. |
| `src/lib/bookmarks.ts` | Saved passages, kept in `localStorage` (`gs-bookmarks`). |

The API base URL comes from `VITE_API_DOMAIN` (build/dev-time env). The frontend deep-links results straight to churchofjesuschrist.org using the `url` the backend stored, so it needs no per-source URL logic.

### Mobile shell

Below Tailwind's `md` breakpoint (`useIsMobile`, 48rem) `App.tsx` renders `MobileApp` instead of the desktop layouts. `App` still owns the search state and passes it down, so both are views of the same search and resizing the window keeps your results.

- **Tabs:** Search, Saved, Settings, under a floating tab bar. The active tab is the `?tab=` query param.
- **Results** are cards; tapping one opens the full passage in a bottom sheet with Save / Share / Read (the link out to the source).
- **Bookmarks** are per-device: `lib/bookmarks.ts` stores each saved result whole in `localStorage`, so the Saved tab needs no API call. There are no accounts and nothing syncs.
- **Liquid Glass** is CSS only: the `.glass` / `.glass-thick` classes and `--glass-*` tokens in `index.css` (translucent fill, `backdrop-filter` blur, a lit rim). It is used for floating controls, not for the result cards, and falls back to opaque panes where blur is unsupported or the user has asked for reduced transparency.
- **Installable:** `public/manifest.webmanifest` plus the `apple-mobile-web-app-*` tags make "Add to Home Screen" open it full-screen. There is no service worker, so it does not work offline.

## Ingestion pipeline (`api/ingest/`)

| File | Responsibility |
|---|---|
| `run.py` | Orchestrator / CLI (`--source`, `--create-index`, `--stats`, `--force`). |
| `common.py` | `embed_texts`, `embed_records`, `upsert_docs`, `embed_and_upsert`, `already_ingested`, `ensure_vector_index`, `storage_stats`/`log_storage`, `chunked`. Shared by every source. |
| `reembed.py` | Non-destructive, resumable backfill of another embedding version's field (`$set` only), plus `--status`, `--dry-run`, a storage-cap guard, and `--create-index`. See [embedding-migration.md](./embedding-migration.md). |
| `urls.py` | Scripture reference parsing + churchofjesuschrist.org deep-link builders (Bible, Book of Mormon, D&C, Pearl of Great Price). |
| `church.py` | Cached, rate-limited client for the Gospel Library content API (used by the scrapers). |
| `bible.py` | KJV Bible from `data/bible_verses.json`. |
| `lds_scriptures.py` | Book of Mormon / D&C / Pearl of Great Price from `data/new/*.json`. |
| `conference.py` | General Conference scraper (1971–present). |
| `handbook.py` | General Handbook scraper (by section). |

Design properties that matter:
- **Deterministic `_id`s** (e.g. `bible:Genesis 1:1`, `handbook:<uri>:<anchor>:<i>`) → re-running **upserts** instead of duplicating.
- **Resumable scrapes** — `conference.py`/`handbook.py` skip work already in Atlas via `already_ingested({...})`, and `church.py` caches HTTP responses under `api/ingest/.cache/`.
- **Polite scraping** — 1 s rate-limit + a descriptive `User-Agent`.

See [data-sources.md](./data-sources.md) for per-source detail and [adding-a-source.md](./adding-a-source.md) to add your own.
