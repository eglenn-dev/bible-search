# Architecture — How It Works

## System overview

```
 Ingestion (run locally, one-time + on updates)
   read/scrape ─► chunk ─► embed (MiniLM) ─► upsert docs w/ binData vectors ─► ensure vector index
        │
        ▼
 MongoDB Atlas (free M0)
   gospel_library.documents   ── one collection, all sources
   vector_index               ── Atlas Vector Search index (cosine, 384-dim, source filter)
        ▲
        │  $vectorSearch  (optionally filtered by source)
 FastAPI  (api/)
   loads paraphrase-MiniLM-L3-v2 to encode QUERIES only — never the dataset
   GET /search · /search/by-reference · /search/similar · /passage/context · /verse · /
        ▲
        │  fetch
 React + Vite + Tailwind  (client/)
   unified search box · source filter chips · source-tagged result cards
```

The defining choice: **embeddings live in the database, not in process memory.** The API holds only the ~60 MB query-encoder model and asks Atlas to do the nearest-neighbor search. This is what lets the corpus grow to ~93k documents (and beyond) without the API's memory growing with it. (The previous design loaded a FAISS index of all vectors into RAM at startup — see [project-history.md](./project-history.md).)

## The embedding model

- **Model:** `paraphrase-MiniLM-L3-v2` → **384-dimensional** vectors, runs on CPU.
- **Runtime: ONNX, not torch.** `api/encoder.py` runs the model's ONNX export with **onnxruntime** + a Hugging Face tokenizer and does tokenize → inference → masked mean-pool → L2-normalize itself. This produces embeddings **identical** to the torch/sentence-transformers model (verified cosine ≈ 1.0), so existing Atlas vectors stay compatible — while dropping ~470 MB of dependencies (torch, scipy, scikit-learn, sympy). The whole runtime venv is ~290 MB, so the API fits a 512 MB host.
- One encoder, used in two places (so query and document vectors share one space):
  - **Ingestion** (`api/ingest/common.py::embed_texts` → `encoder.encode_batch`) — embeds each document's `text`.
  - **Query time** (`api/app.py::_encode` → `encoder.encode`) — embeds the user's query string.
- Vectors are **L2-normalized** so cosine similarity is well-behaved and scores land in a clean 0–1 range.

> Changing the model means re-embedding **everything** (you can't mix vector spaces). Keep dimensions/model consistent across all sources.

## Data model

One MongoDB collection — `gospel_library.documents` — holds every source. Each document:

```jsonc
{
  "_id": "conference:/general-conference/2024/04/11oaks:p2",  // deterministic → idempotent upserts
  "source": "bible" | "book-of-mormon" | "doctrine-and-covenants"
          | "pearl-of-great-price" | "conference" | "handbook",
  "text": "<the chunk/verse text that gets embedded>",
  "embedding": BinData(float32, 384),     // BSON binary vector (compact; see below)
  "reference": "Genesis 1:1",             // human label (verse ref / talk title / section)
  "title": "In the Beginning…",           // talk/chapter title; null for scripture verses
  "url": "https://www.churchofjesuschrist.org/...#p2",  // precomputed deep link
  "metadata": { /* source-specific — see data-sources.md */ }
}
```

### Why `binData` vectors + quantization
- A JSON array of 384 numbers stores each as an 8-byte double → ~3 KB/vector. Storing them as a BSON **float32 `binData`** vector (`bson.binary.Binary.from_vector(..., FLOAT32)`) halves that to ~1.5 KB.
- The Atlas index additionally uses **scalar (int8) quantization**, shrinking the in-index footprint further.
- Net effect: ~93k docs fit in **~193 MB**, well under the M0 **512 MB** cap. `embedding_to_list()` in `db.py` converts a stored `binData` vector back to a plain list (used by `/search/by-reference`).

### The vector index
Created by `api/ingest/common.py::ensure_vector_index()` (idempotent — skips if it already exists):

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
| `db.py` | Atlas access layer: client singleton, `vector_search()`, `find_by_reference()`, `find_by_id()`, `same_document()`, `embedding_to_list()`, `log_query()` (best-effort search analytics), `VALID_SOURCES`, config. |
| `passages.py` | Reading context for `/passage/context`: finds a passage's neighbours in reading order through the `_id` index (computed verse ids, or an anchored `_id` prefix scan per talk/speech/chapter). |
| `export_openapi.py` | Writes the committed `openapi.json`. |

`app.py` composes two things into one ASGI app served by `uvicorn app:app`:
- **`api`** — the FastAPI app with the REST routes + CORS + slowapi rate limiting.
- **`mcp`** — `FastMCP.from_fastapi(api)`, served at `/mcp` over Streamable HTTP. A Starlette parent mounts the MCP route + the REST app as catch-all and runs the MCP session-manager lifespan. See [mcp.md](./mcp.md) and [api.md](./api.md).

Config comes from `api/.env` (loaded via `python-dotenv`): `MONGODB_URI` (required), `MONGODB_DB` (`gospel_library`), `MONGODB_COLLECTION` (`documents`), `VECTOR_INDEX_NAME` (`vector_index`), `MONGODB_QUERY_LOG_COLLECTION` (`query_logs`), optional `ALLOWED_ORIGINS`, optional `RATE_LIMIT` (default `100/minute`), optional `LOG_QUERIES` (default on; set `0` to disable query logging).

### Query logging (analytics)

`/search`, `/search/by-reference` and `/search/similar` record each user search into a **separate** `query_logs` collection — kept apart from `documents` so it never touches the vector index. Each log doc holds `endpoint`, `query`, the filter params `k` and `sources`, `result_count`, `result_ids` (the deterministic `_id` of each returned passage, in result order), `ip`, `user_agent`, and a UTC `created_at`. The write is scheduled as a **FastAPI background task** (runs after the response is sent, so it adds no latency to search) and is **best-effort**: `db.log_query()` swallows and logs any error so a logging hiccup can never break a search. The `/verse` preview lookup is *not* logged (it fires on every keystroke while typing a reference), nor is `/passage/context` (a read, not a search). For `/search/similar` the logged `query` is the seed passage's id. Toggle the whole feature with `LOG_QUERIES`.

### Endpoints

- **`GET /`** — health check; also pings Atlas. Returns `{"message": "Online!"}` or 503.
- **`GET /search?query=<text>&k=10&sources=<csv>`** — encodes the query, runs `$vectorSearch`. `sources` is an optional comma-separated subset (`bible,conference,…`); omit for all. Returns `{ query, results: [...] }`.
- **`GET /search/by-reference?reference=<ref>&k=10&sources=<csv>`** — looks up a document by exact `reference`, **reuses its stored embedding** (no re-encode), and drops the self-match. Powers the "Scripture Reference" mode.
- **`GET /search/similar?id=<id>&k=10&sources=<csv>`** — "more like this" from any result. Every result carries its document `id` (the deterministic `_id`); this loads that document's stored embedding, runs `vector_search`, and drops the seed **and every other chunk of the same talk/speech/handbook chapter** (`db.same_document`, the same grouping the de-duplication uses). `/search/by-reference` can't do this for talks: their `reference` is the talk title, shared by every chunk. Returns the usual `{query, results}` plus `seed` (the passage searched from). 404 on an unknown id.
- **`GET /passage/context?id=<id>&before=2&after=2`** — the passage plus its neighbours in reading order, each flagged `is_target` (adjacent verses of the chapter, or adjacent chunks of the talk/speech/handbook section). Uses only the built-in `_id` index; see [api.md](./api.md#reading-context-get-passagecontext) for the per-source rules and why new-format conference talks return only the passage for now.
- **`GET /verse?reference=<ref>`** — returns a single passage's text + deep link by exact reference (any Standard Work). Used by the frontend to validate/preview a reference.
- **`/docs`, `/redoc`, `/openapi.json`** — Swagger UI, ReDoc, and the OpenAPI spec.
- **`/mcp`** — the MCP server (Streamable HTTP) for AI agents.

`db.vector_search()` builds the aggregation: a `$vectorSearch` stage (`numCandidates = clamp(limit*20, 150, 10000)`, optional `filter: { source: { $in: [...] } }`) followed by a `$project` that returns `source, reference, text, title, url, metadata` and `score: { $meta: "vectorSearchScore" }`. Only sources in `VALID_SOURCES` are honored as filters.

## Frontend (`client/`)

React 19 + Vite + Tailwind v4 + a few shadcn/ui primitives. Key pieces:

| File | Responsibility |
|---|---|
| `src/App.tsx` | Layout, mode toggle (Natural / Scripture Reference), holds the selected `sources`, and the "more like this" view (`?similar=<id>`, pushed to history so Back returns to the query's results; a reload or shared link re-runs it). |
| `src/components/sources-filter.tsx` | The All / Bible / … filter chips. |
| `src/components/search-box.tsx` | Natural-language search → `GET /search`. |
| `src/components/scripture-box.tsx` | Verse-reference search → `GET /search/by-reference`; validates/previews the reference (any Standard Work) via `GET /verse`, debounced. |
| `src/components/render-results.tsx` | Result cards: source badge, metadata line, relevance bar, deep-link via `result.url`; "Show context" / "Read surrounding verses" and "More like this" actions. |
| `src/components/passage-context.tsx` | A result expanded in place: fetches `GET /passage/context` on first open and renders the neighbours around the matched passage (marked by a rule in the margin). Shared by the desktop list and the mobile sheet. |
| `src/lib/passages.ts` | `runSimilar` (`GET /search/similar`) and `fetchPassageContext` (cached per passage). |
| `src/lib/types.ts` | `Source` union + `Result`/`ResultMetadata` types. |
| `src/index.css` | "Classic & scholarly" theme tokens + serif fonts. |
| `src/components/mobile/` | The phone layout (see below): `mobile-app.tsx` is the shell; the rest are its tab bar, sheets, cards and controls. |
| `src/lib/bookmarks.ts` | Saved passages, kept in `localStorage` (`gs-bookmarks`). |

The API base URL comes from `VITE_API_DOMAIN` (build/dev-time env). The frontend deep-links results straight to churchofjesuschrist.org using the `url` the backend stored, so it needs no per-source URL logic.

### Mobile shell

Below Tailwind's `md` breakpoint (`useIsMobile`, 48rem) `App.tsx` renders `MobileApp` instead of the desktop layouts. `App` still owns the search state and passes it down, so both are views of the same search and resizing the window keeps your results.

- **Tabs:** Search, Saved, Settings, under a floating tab bar. The active tab is the `?tab=` query param.
- **Results** are cards; tapping one opens the full passage in a bottom sheet with Save / Share / Read (the link out to the source), plus "Read surrounding verses" / "Show context" (expands the passage in place) and "More like this".
- **Bookmarks** are per-device: `lib/bookmarks.ts` stores each saved result whole in `localStorage`, so the Saved tab needs no API call. There are no accounts and nothing syncs. A bookmark is keyed by the result's API `id`; ones saved before results carried ids keep their older url+text-hash key, and `isSaved` / `findBookmark` match either.
- **Liquid Glass** is CSS only: the `.glass` / `.glass-thick` classes and `--glass-*` tokens in `index.css` (translucent fill, `backdrop-filter` blur, a lit rim). It is used for floating controls, not for the result cards, and falls back to opaque panes where blur is unsupported or the user has asked for reduced transparency.
- **Installable:** `public/manifest.webmanifest` plus the `apple-mobile-web-app-*` tags make "Add to Home Screen" open it full-screen. There is no service worker, so it does not work offline.

## Ingestion pipeline (`api/ingest/`)

| File | Responsibility |
|---|---|
| `run.py` | Orchestrator / CLI (`--source`, `--create-index`, `--stats`, `--force`). |
| `common.py` | `embed_texts`, `upsert_docs`, `embed_and_upsert`, `already_ingested`, `ensure_vector_index`, `storage_stats`/`log_storage`, `chunked`. Shared by every source. |
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
