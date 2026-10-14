# MCP Server (for AI agents)

The API doubles as a **remote MCP server** so AI agents can search the corpora as tools. It's hosted at **`/mcp`** on the same deployment as the REST API — there's nothing separate to deploy, and **consumers don't install anything**: they just add the URL as a connector.

- **Endpoint:** `https://<your-api-host>/mcp` (e.g. `https://api.bible.eglenn.dev/mcp`)
- **Transport:** Streamable HTTP (the current remote-MCP standard)
- **Auth:** none (public), with per-IP rate limiting
- **Tools (auto-generated from the OpenAPI spec):** `search`, `search_by_reference`, `search_similar`, `get_passage_context`, `list_speakers`, `get_verse`, `get_stats`, `health`

## How it's built

The tools are generated from the FastAPI app by **FastMCP** (`FastMCP.from_fastapi(api)` in `api/app.py`) — each REST operation becomes an MCP tool, with names, descriptions, and argument schemas taken straight from the OpenAPI spec. A Starlette app serves the MCP route at `/mcp` and the REST API for everything else, in one process:

```
            ┌──────────────── one deployment ────────────────┐
agent ──MCP──► /mcp (FastMCP, Streamable HTTP)                │
                   └─ tool call ─► /search (in-process) ─► Atlas
browser/curl ──► /search, /docs, /openapi.json (REST API)     │
            └─────────────────────────────────────────────────┘
```

Because the tools come from the spec, adding a REST endpoint and regenerating the spec makes a new tool appear automatically — no hand-written tool code. See [api.md](./api.md#the-committed-spec) for regenerating the spec.

## Add it to a client (zero install)

### Claude (custom connector)
Settings → **Connectors** → **Add custom connector** → give it a name and the URL:
```
https://api.bible.eglenn.dev/mcp
```
Claude connects over Streamable HTTP; the `search` / `search_by_reference` tools then show up in chats.

### Any other MCP-capable platform
Anything that supports remote MCP over Streamable HTTP (IDEs, agent frameworks, etc.) just needs the same URL. Generic config shape:
```jsonc
{
  "mcpServers": {
    "gospel-library-search": { "url": "https://api.bible.eglenn.dev/mcp" }
  }
}
```

### Programmatically
```python
from fastmcp import Client

async with Client("https://api.bible.eglenn.dev/mcp") as c:
    tools = await c.list_tools()
    result = await c.call_tool("search", {"query": "enduring to the end", "k": 5})
```
Any agent framework with a Streamable-HTTP MCP client works the same way — point it at the URL.

## Tools

| Tool | Args | Returns |
|---|---|---|
| `search` | `query` (required), `k` (1–50), `sources` (CSV), `speaker`, `year_from`, `year_to` | Top semantic matches across the chosen corpora |
| `search_by_reference` | `reference` (required), `k`, `sources`, `speaker`, `year_from`, `year_to` | Passages similar to a known verse (self-match excluded) |
| `search_similar` | `id` (required), `k`, `sources`, `speaker`, `year_from`, `year_to` | "More like this" from any result's `id`, any source; skips the rest of that talk/chapter |
| `get_passage_context` | `id` (required), `before`, `after` (0–10, default 2) | The passage with its surrounding verses / paragraphs in reading order (`is_target` marks it) |
| `list_speakers` | `q` (words to match, e.g. `holland`), `variants` | Normalized conference/BYU speakers with talk counts and year spans |
| `get_verse` | `reference` (required) | A single passage's text + deep link by exact reference |
| `get_stats` | — | Precomputed corpus analytics |
| `health` | — | Service/DB status |

Every search result carries an `id`, so an agent can chain the tools: `search` → `get_passage_context` to read a hit in context → `search_similar` to branch out from it.

`sources` is any comma-separated subset of: `bible`, `book-of-mormon`, `doctrine-and-covenants`, `pearl-of-great-price`, `conference`, `byu-speeches`, `handbook`.

For "what has Elder X said about faith, 2010–2020?" an agent calls `search` with `query="faith"`, `speaker="<name>"`, `year_from=2010`, `year_to=2020`. A unique partial name works (`"Uchtdorf"`); an ambiguous one (`"Holland"`) comes back as an error listing the candidates, and `list_speakers` with `q` finds the exact name. Speaker/year filters only match `conference` and `byu-speeches`. See [api.md](./api.md#speaker-and-year-filters).

## Access & limits

- **Public, no auth.** Anyone with the URL can use it (the corpora are public content). The same applies to the REST API.
- **Rate limiting.** The REST API is per-IP rate limited via slowapi (`RATE_LIMIT`, default `100/minute`, keyed on `X-Forwarded-For`). MCP tool calls invoke `/search` in-process, so they pass through that limiter too (a shared bucket, since the in-process call has no external client IP). For strict per-IP limiting of the MCP transport itself in production, put the deployment behind an edge proxy (e.g. Cloudflare) — the `/mcp` streaming transport intentionally isn't wrapped in buffering middleware.

## Local testing

```bash
cd api && uv run uvicorn app:app --port 10000      # serves /mcp and the REST API
# in another shell:
uv run python -c "import asyncio; from fastmcp import Client; \
asyncio.run((lambda: Client('http://localhost:10000/mcp'))().__aenter__())"  # or use the snippet above
```
