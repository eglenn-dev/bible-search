# API, OpenAPI Spec & Swagger UI

The backend is FastAPI, so it ships a typed **OpenAPI 3.1** spec and interactive docs out of the box, plus a committed spec file you can use to mock the API without a backend.

## Interactive docs (served by the running API)

Start the API (`cd api && uv run uvicorn app:app --port 10000`), then:

| URL | What it is |
|---|---|
| <http://localhost:10000/docs> | **Swagger UI** — browse endpoints and run live requests ("Try it out"). |
| <http://localhost:10000/redoc> | **ReDoc** — clean, read-only reference. |
| <http://localhost:10000/openapi.json> | The raw **OpenAPI 3.1** spec. |
| <http://localhost:10000/mcp> | **MCP server** for AI agents (Streamable HTTP) — tools auto-generated from this same spec. See [mcp.md](./mcp.md). |

### Trying requests in Swagger UI
1. Open `/docs`.
2. Expand an endpoint (e.g. `GET /search`), click **Try it out**.
3. Fill in the params (each has an example pre-filled — e.g. `query = charity never faileth`) and click **Execute**.
4. Swagger shows the request `curl`, the response body, and the status code.

The **Servers** dropdown lets you target local (`http://localhost:10000`) or production (`https://api.bible.eglenn.dev`). Live "Try it out" hits a real server and therefore needs Atlas reachable — for backend-free mocking, see below.

## The committed spec

A generated copy lives at [`api/openapi.json`](../api/openapi.json) so tools (mock servers, client generators, CI) can consume it without running the app.

Regenerate it whenever the API changes:

```bash
cd api
uv run python export_openapi.py     # writes api/openapi.json
```

The exporter imports the app and serializes `app.openapi()`. The embedding model loads **lazily**, so this needs neither the model nor the database — safe for CI.

## Mocking requests without a backend (Prism)

To serve **mock responses generated from the spec** (no Atlas, no model), use [Prism](https://github.com/stoplightio/prism):

```bash
# from the repo root
npx @stoplight/prism-cli mock api/openapi.json --port 4010
```

Then call the mock just like the real API:

```bash
curl "http://localhost:4010/search?query=faith&k=3"
curl "http://localhost:4010/"
```

Prism returns example-shaped payloads derived from the response schemas (e.g. the `SearchResult` example baked into the spec), validates requests against the spec, and returns `422`/`404` for invalid calls — useful for frontend work or contract testing while the real backend is unavailable.

You can also import `api/openapi.json` into Postman/Insomnia, or generate a typed client with `openapi-typescript` / `openapi-generator`.

## Endpoint reference

| Method & path | Summary | Key params |
|---|---|---|
| `GET /` | Health check (pings Atlas) | — |
| `GET /search` | Semantic search across all corpora | `query` (req), `k` (1–50, default 10), `sources` (CSV), `speaker`, `year_from`, `year_to` |
| `GET /search/by-reference` | Passages similar to a known verse | `reference` (req), `k`, `sources`, `speaker`, `year_from`, `year_to` |
| `GET /speakers` | Normalized conference / BYU speakers: talk counts, sources, year span, raw byline variants | `q` (words to match), `variants` (default `true`) |
| `GET /search/similar` | "More like this": passages similar to any result, by its `id`. Excludes the passage and every other chunk of the same talk/speech/handbook chapter. Returns `SimilarResponse` (`SearchResponse` + `seed`, the passage searched from). | `id` (req), `k`, `sources`, `speaker`, `year_from`, `year_to` |
| `GET /passage/context` | A passage plus its neighbours in reading order, each flagged `is_target` (see below) | `id` (req), `before` / `after` (0–10, default 2) |
| `GET /verse` | Look up a passage's text + link by exact reference | `reference` (req) |
| `GET /stats` | Precomputed corpus analytics for the frontend `/stats` page (`{generated_at, data}`). Regenerate offline with `uv run python -m ingest.stats` — it is never computed per-request. | — |

`sources` is any comma-separated subset of: `bible`, `book-of-mormon`, `doctrine-and-covenants`, `pearl-of-great-price`, `conference`, `byu-speeches`, `handbook`. Omit it to search everything.

### Speaker and year filters

"What has Elder X said about faith, 2010–2020?":

```bash
curl "http://localhost:10000/speakers?q=holland&variants=false"   # find the name
curl "http://localhost:10000/search?query=faith&speaker=Jeffrey%20R.%20Holland&year_from=2010&year_to=2020"
```

- **`speaker`** — a `name` from `GET /speakers`. Any byline spelling ("By Elder Jeffrey R. Holland") or a unique partial name ("Uchtdorf") also resolves; the response's `filters.speaker` shows which speaker it matched. An unknown or ambiguous name (e.g. "Holland", which matches three people) returns **400** with suggestions. The server expands the name to every raw `metadata.speaker` byline grouped under it, so talks are found whichever way their byline was printed.
- **`year_from` / `year_to`** — inclusive bounds on the talk's year (1800–2100). `year_from` > `year_to` returns **400**.
- Only `conference` and `byu-speeches` carry a speaker and year, so setting any of these narrows results to those sources (combined with `sources` as an AND — `sources=bible&speaker=…` returns nothing).
- **503** — the filters need `metadata.speaker` / `metadata.year` as filter fields in the Atlas vector index. Until that index update is applied and has finished building, filtered searches return 503 with an explanation; unfiltered searches are unaffected. See [architecture.md](./architecture.md#applying-an-index-definition-change).

`GET /speakers` returns `{ count, speakers: [{ name, talks, sources, first_year, last_year, variants }] }`, most talks first:

```jsonc
{
  "name": "M. Russell Ballard",
  "talks": 109,
  "sources": ["byu-speeches", "conference"],
  "first_year": 1976,
  "last_year": 2023,
  "variants": ["By Elder M. Russell Ballard", "By Elder M. Russell Ballard, Jr.", "By President M. Russell Ballard", "M. Russell Ballard", "…"]
}
```

It's computed from the corpus with one read-only aggregation on first use and cached in memory for `SPEAKERS_CACHE_SECONDS` (default 6 hours). Pass `variants=false` for a smaller payload (the web client does).

### Response shape (`SearchResponse`)
```jsonc
{
  "query": "charity never faileth",
  "results": [
    {
      "id": "bible:1 Corinthians 13:4",   // stable document id → /search/similar, /passage/context
      "source": "bible",
      "reference": "1 Corinthians 13:4",
      "text": "Charity suffereth long, and is kind; …",
      "title": null,
      "url": "https://www.churchofjesuschrist.org/study/scriptures/nt/1-cor/13?id=p4#p4",
      "score": 0.842,
      "metadata": { "book": "1 Corinthians", "chapter": 13, "verse": 4, "testament": "nt", "translation": "KJV" }
    }
  ],
  "filters": null   // or { "speaker": "Jeffrey R. Holland", "year_from": 2010, "year_to": 2020 }
}
```

`id` is the document's deterministic Mongo `_id` (`bible:John 3:16`, `conference:<talk uri>:<paragraph id>`, `byu-speeches:<path>:<paragraph index>`, `handbook:<chapter uri>:<anchor>:<offset>` — see [data-sources.md](./data-sources.md)). It is stable across re-ingests, so it is safe to store (the client keys bookmarks on it).

### Reading context (`GET /passage/context`)

```jsonc
// GET /passage/context?id=bible:John%203:16&before=1&after=1
{
  "id": "bible:John 3:16",
  "passages": [
    { "id": "bible:John 3:15", "reference": "John 3:15", "text": "…", "is_target": false, /* + source, title, url, metadata */ },
    { "id": "bible:John 3:16", "reference": "John 3:16", "text": "…", "is_target": true },
    { "id": "bible:John 3:17", "reference": "John 3:17", "text": "…", "is_target": false }
  ],
  "more_before": true,   // the chapter/talk continues past the window
  "more_after": true,
  "note": null           // set when the context is narrower than asked
}
```

What counts as a neighbour, and how they're found (all through the built-in `_id` index; no extra indexes):

| Source | Neighbours | Query |
|---|---|---|
| Scripture | Adjacent verses of the same chapter (never crosses a chapter) | The neighbours' ids are computed (`bible:John 3:15`, …) and fetched with one `$in`. |
| BYU Speeches | Adjacent ~3-paragraph chunks of the speech, by the paragraph index in the id | Anchored prefix regex `^byu-speeches:<path>:` — an index-only range scan — then `$in` for the window. |
| Conference (ids `p12`, pre-late-2024) | Adjacent chunks of the talk, by paragraph number (numerically: `p3` < `p12`) | Same prefix scan on `^conference:<talk uri>:`. |
| Conference (ids `p_aB3dE`, late 2024 on) | **Just the passage**, with a `note`: the new ids are random and nothing stored records the paragraph order (insertion order was checked and isn't reliable). | — |
| Handbook | Adjacent chunks of the **same section** (the id's offset orders them), with a `note`; sections aren't ordered relative to each other in the stored data. | Prefix scan on `^handbook:<chapter uri>:`. |

The conference and handbook ingesters now also write `metadata.chunk_index` (reading order within the talk / chapter). When a passage has it, neighbours come from one range query on the `_id` prefix plus `chunk_index`, and the limits above go away: the handbook picks it up on its next full sync; existing new-format conference talks need a forced re-ingest (`python -m ingest.run --source conference --force`) to get it.

Measured against the production cluster, every one of these queries runs in **0 ms** server-side (`explain`: `IXSCAN` on `_id_` with tight bounds; the id-only scan is `PROJECTION_COVERED`, i.e. it reads no documents); an endpoint call is dominated by network round trips.

Schemas (`SearchResponse`, `SearchResult`, `SimilarResponse`, `PassageContextResponse`, `HealthResponse`, `ErrorResponse`, …) are defined as Pydantic models in `api/app.py`; FastAPI derives the OpenAPI `components.schemas` from them.
