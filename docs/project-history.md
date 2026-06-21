# Project History — What We Did

A record of how `bible-search` became **Gospel Library Search**, the decisions behind it, and the gotchas worth remembering.

## Starting point

- **One corpus:** the KJV Bible (31,102 verses) as static JSON.
- **In-memory search:** a FAISS `IndexIVFPQ` of all verse vectors was loaded into the API's RAM at startup; queries were encoded with `paraphrase-MiniLM-L3-v2` and matched by L2 distance.
- **Frontend:** React/Vite/Tailwind with a minimal slate aesthetic and two modes (natural language, scripture reference) against a single `GET /similar/` endpoint.

## The goals

1. **Add corpora** — LDS General Conference addresses and the General Handbook (and, later in the session, the rest of the Standard Works).
2. **Move storage to a MongoDB Atlas vector database** so embeddings live in the DB and aren't loaded into memory.
3. **Refresh the UI** with more character.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Database | **Atlas M0 (free cloud)** with Atlas Vector Search | Plain MongoDB **Community can't run `$vectorSearch`** without the separate `mongot` process; Atlas provides it natively. |
| Conference scope | **All of 1971–present** | Full archive; scraped via the content API. |
| Search UX | **Unified search + source filter chips** | One box across everything, narrow by source. |
| Visual style | **"Classic & scholarly"** (navy + burgundy, serif headings) | Reference-tool feel. |
| Embedding model | **Keep `paraphrase-MiniLM-L3-v2`** | Consistency with existing vectors, free, CPU-friendly. The API keeps the model loaded only to encode *queries*. |
| Python tooling | **`uv`** | Replaced `pip`/`requirements.txt` with `pyproject.toml` + `uv.lock`. |

## What was built

- **Backend migration (FAISS → Atlas).** New `api/db.py` access layer (`$vectorSearch`, source filtering, `binData` ↔ list conversion). Rewrote `api/app.py` to drop the in-memory dataset/index and expose `GET /search`, `GET /search/by-reference`, and a DB-pinging `GET /`. Switched similarity from L2 to **cosine** with normalized embeddings, so results carry a 0–1 `score`.
- **Ingestion pipeline (`api/ingest/`).** Shared `common.py` (embed → `binData` float32, upsert by `_id`, `ensure_vector_index`, storage stats); `urls.py` deep-link builders; a cached/rate-limited `church.py` content-API client; and per-source modules for Bible, the other Standard Works, Conference, and Handbook; orchestrated by `run.py`.
- **Frontend redesign.** "Classic & scholarly" theme + serif fonts; unified search with a `SourcesFilter` chip row; redesigned result cards (source badges, per-source metadata, relevance bar, backend-supplied deep links).
- **`uv` conversion.** `api/pyproject.toml` + `uv.lock` + `.python-version`; Dockerfile rebuilt around `uv sync`; README/docs updated.
- **Standard Works added.** Book of Mormon, Doctrine and Covenants, and Pearl of Great Price (from `api/data/new/`) ingested as first-class, individually filterable sources, wired through backend + frontend.

## Gotchas & fixes (worth remembering)

- **Community ≠ Atlas Vector Search.** `$vectorSearch` needs `mongot`; the user's local Community install couldn't run it → we used Atlas M0 (cloud).
- **`pymongo[srv]` extra doesn't exist on 4.10.1.** It emitted a warning. `pymongo` already declares `dnspython` as a **core** dependency, so `mongodb+srv://` works without the extra — we dropped `[srv]`.
- **Atlas TLS "internal error" alert = IP not allow-listed.** The first connection failed with `tlsv1 alert internal error` (confirmed via raw `openssl`, independent of Python). Atlas rejects the TLS handshake for non-allow-listed IPs. Fix: add your IP under **Atlas → Network Access**.
- **"Solomon's Song".** The KJV dataset names that book "Solomon's Song", not "Song of Solomon" — 117 verses had empty deep-links until we added the alias to `urls.OT_CHAPTER_MAP`.
- **M0 512 MB cap.** Early worst-case math suggested risk, but `binData` float32 vectors + scalar-quantized index + ~3-paragraph chunking landed the full ~93k-doc corpus at **~193 MB**. No mitigation beyond those was needed.
- **Resumability proved out.** The Conference scrape's chained second Handbook pass ingested **0** (correctly skipping all already-present chapters).

## Final state (verified)

End-to-end verified against the live API: health check, unified search blending multiple sources, every source filter returning only its source, multi-source filters, `by-reference` with self-match excluded, and correct deep-link URLs.

| Source | Documents |
|---|---:|
| Bible (KJV) | 31,102 |
| Book of Mormon | 6,604 |
| Doctrine & Covenants | 3,654 |
| Pearl of Great Price | 635 |
| General Conference (1971–2026) | 49,069 chunks / 4,125 talks |
| General Handbook | 2,330 |
| **Total** | **93,394** (~193 MB / 512 MB) |
