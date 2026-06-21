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
| `GET /search` | Semantic search across all corpora | `query` (req), `k` (1–50, default 10), `sources` (CSV) |
| `GET /search/by-reference` | Passages similar to a known verse | `reference` (req), `k`, `sources` |

`sources` is any comma-separated subset of: `bible`, `book-of-mormon`, `doctrine-and-covenants`, `pearl-of-great-price`, `conference`, `handbook`. Omit it to search everything.

### Response shape (`SearchResponse`)
```jsonc
{
  "query": "charity never faileth",
  "results": [
    {
      "source": "bible",
      "reference": "1 Corinthians 13:4",
      "text": "Charity suffereth long, and is kind; …",
      "title": null,
      "url": "https://www.churchofjesuschrist.org/study/scriptures/nt/1-cor/13?id=p4#p4",
      "score": 0.842,
      "metadata": { "book": "1 Corinthians", "chapter": 13, "verse": 4, "testament": "nt", "translation": "KJV" }
    }
  ]
}
```

Schemas (`SearchResponse`, `SearchResult`, `HealthResponse`, `ErrorResponse`) are defined as Pydantic models in `api/app.py`; FastAPI derives the OpenAPI `components.schemas` from them.
