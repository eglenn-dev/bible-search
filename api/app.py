import os
from typing import Any, Literal

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastmcp import FastMCP
from pydantic import AliasChoices, BaseModel, Field
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from slowapi.util import get_remote_address
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Mount

import db
import encoder
import passages

# --- Schemas -------------------------------------------------------------

SourceLiteral = Literal[
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
    "conference",
    "byu-speeches",
    "handbook",
]


class Passage(BaseModel):
    id: str = Field(
        ...,
        # Read from the document's Mongo `_id`; always serialized as `id`.
        validation_alias=AliasChoices("id", "_id"),
        description=(
            "Stable document id (e.g. `bible:John 3:16`, "
            "`conference:<talk uri>:<paragraph id>`). Pass it to "
            "/search/similar or /passage/context."
        ),
    )
    source: SourceLiteral = Field(
        ..., description="Which corpus the passage belongs to."
    )
    reference: str = Field(
        ...,
        description="Human label: verse reference, talk title, or handbook section.",
    )
    text: str = Field(..., description="The passage text.")
    title: str | None = Field(
        None, description="Talk/chapter title; null for scripture verses."
    )
    url: str = Field(
        ..., description="Deep link to the passage on churchofjesuschrist.org."
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict,
        description="Source-specific metadata (speaker, book, section, …).",
    )


class SearchResult(Passage):
    score: float = Field(
        ..., description="Cosine similarity in [0, 1] — higher is more relevant."
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": "bible:1 John 4:8",
                "source": "bible",
                "reference": "1 John 4:8",
                "text": "He that loveth not knoweth not God; for God is love.",
                "title": None,
                "url": "https://www.churchofjesuschrist.org/study/scriptures/nt/1-jn/4?id=p8#p8",
                "score": 0.888,
                "metadata": {
                    "book": "1 John",
                    "chapter": 4,
                    "verse": 8,
                    "testament": "nt",
                    "translation": "KJV",
                },
            }
        }
    }


class SearchResponse(BaseModel):
    query: str = Field(..., description="The query that was searched (echoed back).")
    results: list[SearchResult]


class SimilarResponse(SearchResponse):
    seed: Passage = Field(
        ..., description="The passage the results were found from (not in `results`)."
    )


class ContextPassage(Passage):
    is_target: bool = Field(
        ..., description="True for the requested passage; false for its neighbours."
    )


class PassageContextResponse(BaseModel):
    id: str = Field(..., description="The requested passage's id (echoed back).")
    passages: list[ContextPassage] = Field(
        ...,
        description=(
            "The passage and its neighbours in reading order: adjacent verses of "
            "the same chapter, or adjacent chunks of the same talk / speech / "
            "handbook section."
        ),
    )
    more_before: bool = Field(
        ..., description="More of the chapter/talk precedes the first passage."
    )
    more_after: bool = Field(
        ..., description="More of the chapter/talk follows the last passage."
    )
    note: str | None = Field(
        None,
        description="Why the context is narrower than asked, when it is.",
    )

    model_config = {
        "json_schema_extra": {
            "example": {
                "id": "bible:John 3:16",
                "passages": [
                    {
                        "id": "bible:John 3:15",
                        "source": "bible",
                        "reference": "John 3:15",
                        "text": "That whosoever believeth in him should not perish, but have eternal life.",
                        "title": None,
                        "url": "https://www.churchofjesuschrist.org/study/scriptures/nt/john/3?id=p15#p15",
                        "metadata": {"book": "John", "chapter": 3, "verse": 15},
                        "is_target": False,
                    },
                    {
                        "id": "bible:John 3:16",
                        "source": "bible",
                        "reference": "John 3:16",
                        "text": "For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.",
                        "title": None,
                        "url": "https://www.churchofjesuschrist.org/study/scriptures/nt/john/3?id=p16#p16",
                        "metadata": {"book": "John", "chapter": 3, "verse": 16},
                        "is_target": True,
                    },
                ],
                "more_before": True,
                "more_after": True,
                "note": None,
            }
        }
    }


class VerseResponse(BaseModel):
    source: SourceLiteral
    reference: str
    text: str
    title: str | None = None
    url: str


class StatsResponse(BaseModel):
    generated_at: str = Field(
        ..., description="UTC ISO-8601 timestamp of when the stats were computed."
    )
    data: dict[str, Any] = Field(
        ...,
        description=(
            "Precomputed corpus analytics (speaker stats, word trends, scripture "
            "trivia, embedding clusters, …) rendered by the frontend /stats page. "
            "Regenerated offline via `python -m ingest.stats`."
        ),
    )


class HealthResponse(BaseModel):
    message: str = Field(..., examples=["Online!"])


class ErrorResponse(BaseModel):
    detail: str


# --- REST API ------------------------------------------------------------

DESCRIPTION = """
Semantic search across the LDS **Standard Works** (Bible, Book of Mormon,
Doctrine and Covenants, Pearl of Great Price), **General Conference** addresses
(1971–present), **BYU Speeches** devotionals and forums, and the
**General Handbook**.

Queries are matched by meaning using sentence embeddings + MongoDB Atlas Vector
Search. Every result links back to the passage on churchofjesuschrist.org.

- **Interactive docs (Swagger UI):** [`/docs`](/docs)
- **ReDoc:** [`/redoc`](/redoc)
- **OpenAPI spec:** [`/openapi.json`](/openapi.json)
- **MCP server (for AI agents):** `/mcp` (Streamable HTTP)
"""

tags_metadata = [
    {"name": "Search", "description": "Semantic vector search across the corpora."},
    {
        "name": "Passages",
        "description": "Look up passages and read them in their surrounding context.",
    },
    {"name": "Stats", "description": "Precomputed corpus analytics for the stats page."},
    {"name": "Health", "description": "Service and database status."},
]

api = FastAPI(
    title="Gospel Library Search API",
    version="1.0.0",
    description=DESCRIPTION,
    contact={"name": "Ethan Glenn", "url": "https://ethanglenn.dev"},
    openapi_tags=tags_metadata,
    servers=[
        {"url": "http://localhost:10000", "description": "Local development"},
        {"url": "https://api.bible.eglenn.dev", "description": "Production"},
    ],
)

_default_origins = [
    "https://bible.eglenn.dev",
    "https://api.bible.eglenn.dev",
    "http://localhost:3000",
    "http://localhost:5173",
    "http://localhost:5174",
]
_env_origins = os.getenv("ALLOWED_ORIGINS")
allowed_origins = (
    [o.strip() for o in _env_origins.split(",") if o.strip()]
    if _env_origins
    else _default_origins
)
# Any *.vercel.app origin, so Vercel preview deployments can reach the API.
# Applied on top of ALLOWED_ORIGINS; Starlette fullmatches it against the Origin.
VERCEL_ORIGIN_REGEX = r"https://[a-z0-9-]+\.vercel\.app"

api.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=VERCEL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def _encode(text: str) -> list[float]:
    """Encode a query string to a normalized 384-dim vector (ONNX; loads lazily)."""
    return encoder.encode(text)


def _parse_sources(sources: str | None) -> list[str] | None:
    if not sources:
        return None
    return [s.strip().lower() for s in sources.split(",") if s.strip()]


def _log_query(
    request: Request,
    background_tasks: BackgroundTasks,
    endpoint: str,
    query: str,
    k: int,
    sources: list[str] | None,
    result_count: int,
    result_ids: list[str] | None = None,
) -> None:
    """Schedule a best-effort query-log write after the response is sent.

    Runs in a background task so it adds no latency to the search response, and
    ``db.log_query`` swallows any error so logging can never break a request.
    """
    background_tasks.add_task(
        db.log_query,
        endpoint=endpoint,
        query=query,
        k=k,
        sources=sources,
        result_count=result_count,
        result_ids=result_ids,
        ip=_client_ip(request),
        user_agent=request.headers.get("user-agent"),
    )


@api.get(
    "/search",
    response_model=SearchResponse,
    tags=["Search"],
    operation_id="search",
    summary="Semantic search across all corpora",
    responses={400: {"model": ErrorResponse, "description": "Empty query."}},
)
def search(
    request: Request,
    background_tasks: BackgroundTasks,
    query: str = Query(
        ...,
        description="Free-text query to search across all corpora by meaning.",
        examples=["charity never faileth"],
    ),
    k: int = Query(10, ge=1, le=50, description="Number of results to return."),
    sources: str | None = Query(
        None,
        description=(
            "Comma-separated subset to search. Any of: bible, book-of-mormon, "
            "doctrine-and-covenants, pearl-of-great-price, conference, "
            "byu-speeches, handbook. Omit to search everything."
        ),
        examples=["bible,book-of-mormon"],
    ),
):
    """Encode the query and return the most semantically similar passages."""
    query = query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query must not be empty.")
    parsed_sources = _parse_sources(sources)
    results = db.vector_search(_encode(query), k=k, sources=parsed_sources)
    result_ids = [r["_id"] for r in results if r.get("_id")]
    _log_query(
        request,
        background_tasks,
        "search",
        query,
        k,
        parsed_sources,
        len(results),
        result_ids,
    )
    return {"query": query, "results": results}


@api.get(
    "/search/by-reference",
    response_model=SearchResponse,
    tags=["Search"],
    operation_id="search_by_reference",
    summary="Find passages similar to a known verse",
    responses={404: {"model": ErrorResponse, "description": "Unknown reference."}},
)
def search_by_reference(
    request: Request,
    background_tasks: BackgroundTasks,
    reference: str = Query(
        ...,
        description="Exact scripture reference present in the corpus.",
        examples=["John 3:16"],
    ),
    k: int = Query(10, ge=1, le=50, description="Number of results to return."),
    sources: str | None = Query(
        None,
        description="Optional comma-separated source filter (see /search).",
        examples=["conference"],
    ),
):
    """Look up a verse by reference and return similar passages.

    Reuses the verse's **stored** embedding (no re-encoding) and excludes the
    verse itself from the results.
    """
    doc = db.find_by_reference(reference.strip())
    if not doc:
        raise HTTPException(status_code=404, detail=f"Unknown reference: {reference}")

    parsed_sources = _parse_sources(sources)
    query_vector = db.embedding_to_list(doc["embedding"])
    # Fetch one extra so we can drop the self-match.
    hits = db.vector_search(query_vector, k=k, sources=parsed_sources, limit=k + 1)
    hits = [h for h in hits if h.get("reference") != doc["reference"]][:k]
    result_ids = [h["_id"] for h in hits if h.get("_id")]
    _log_query(
        request,
        background_tasks,
        "search_by_reference",
        doc["reference"],
        k,
        parsed_sources,
        len(hits),
        result_ids,
    )
    return {"query": doc["reference"], "results": hits}


@api.get(
    "/search/similar",
    response_model=SimilarResponse,
    tags=["Search"],
    operation_id="search_similar",
    summary="Find passages similar to any result (\"more like this\")",
    responses={404: {"model": ErrorResponse, "description": "Unknown id."}},
)
def search_similar(
    request: Request,
    background_tasks: BackgroundTasks,
    doc_id: str = Query(
        ...,
        alias="id",
        description=(
            "A passage `id` from a previous result (any source: verse, talk "
            "chunk, speech chunk, or handbook section)."
        ),
        examples=["conference:/general-conference/2016/10/if-ye-had-known-me:p21"],
    ),
    k: int = Query(10, ge=1, le=50, description="Number of results to return."),
    sources: str | None = Query(
        None,
        description="Optional comma-separated source filter (see /search).",
        examples=["bible,book-of-mormon"],
    ),
):
    """Return passages semantically similar to the passage with this `id`.

    Reuses the passage's **stored** embedding (no re-encoding). Unlike
    /search/by-reference it works for every source, and it excludes not only the
    passage itself but every other chunk of the same talk, speech, or handbook
    chapter — so the results point somewhere new. `seed` echoes the passage.
    """
    doc = db.find_by_id(doc_id.strip(), with_embedding=True)
    if not doc:
        raise HTTPException(status_code=404, detail=f"Unknown id: {doc_id}")

    parsed_sources = _parse_sources(sources)
    query_vector = db.embedding_to_list(doc.pop("embedding"))
    # Results are already one chunk per document, so at most one hit is from the
    # seed's own document; fetch one extra to make up for dropping it. Without
    # de-duplication any number of its chunks could rank, so fetch a margin.
    extra = 1 if db.DEDUPE_RESULTS else 20
    hits = db.vector_search(
        query_vector, k=k, sources=parsed_sources, limit=k + extra
    )
    hits = [h for h in hits if not db.same_document(h, doc)][:k]
    result_ids = [h["_id"] for h in hits if h.get("_id")]
    _log_query(
        request,
        background_tasks,
        "search_similar",
        doc["_id"],
        k,
        parsed_sources,
        len(hits),
        result_ids,
    )
    return {"query": doc["reference"], "results": hits, "seed": doc}


@api.get(
    "/passage/context",
    response_model=PassageContextResponse,
    tags=["Passages"],
    operation_id="get_passage_context",
    summary="Read a passage with its surrounding verses or paragraphs",
    responses={404: {"model": ErrorResponse, "description": "Unknown id."}},
)
def get_passage_context(
    doc_id: str = Query(
        ...,
        alias="id",
        description="A passage `id` from a search result.",
        examples=["bible:John 3:16"],
    ),
    before: int = Query(
        2,
        ge=0,
        le=passages.MAX_NEIGHBORS,
        description="How many neighbouring verses/chunks to include before it.",
    ),
    after: int = Query(
        2,
        ge=0,
        le=passages.MAX_NEIGHBORS,
        description="How many neighbouring verses/chunks to include after it.",
    ),
):
    """Return a passage plus its neighbours, in reading order.

    Scripture: the adjacent verses of the same chapter. Conference / BYU
    Speeches: the adjacent chunks (~3 paragraphs each) of the same talk.
    Handbook: the adjacent chunks of the same section. Each passage is flagged
    `is_target`; `more_before` / `more_after` say whether the chapter or talk
    continues past the window (call again with a neighbour's `id` to keep
    reading). When the stored data can't order a document's chunks, only the
    passage itself is returned and `note` says why.
    """
    doc = db.find_by_id(doc_id.strip())
    if not doc:
        raise HTTPException(status_code=404, detail=f"Unknown id: {doc_id}")
    return passages.passage_context(doc, before=before, after=after)


@api.get(
    "/verse",
    response_model=VerseResponse,
    tags=["Search"],
    operation_id="get_verse",
    summary="Look up a passage by exact reference",
    responses={404: {"model": ErrorResponse, "description": "Unknown reference."}},
)
def get_verse(
    reference: str = Query(
        ...,
        description="Exact reference across any Standard Work corpus.",
        examples=["Alma 32:21"],
    ),
):
    """Return a single passage's text + deep link by exact reference.

    Covers all scripture corpora (bible, book-of-mormon, doctrine-and-covenants,
    pearl-of-great-price). Used by the frontend to validate/preview a reference.
    """
    doc = db.find_verse(reference.strip())
    if not doc:
        raise HTTPException(status_code=404, detail=f"Unknown reference: {reference}")
    return doc


@api.get(
    "/stats",
    response_model=StatsResponse,
    tags=["Stats"],
    operation_id="get_stats",
    summary="Precomputed corpus statistics",
    responses={404: {"model": ErrorResponse, "description": "Stats not generated yet."}},
)
def get_stats():
    """Return the precomputed stats-page payload.

    A single small document (~100 KB) written offline by ``python -m
    ingest.stats`` — nothing is computed per-request.
    """
    doc = db.get_site_stats()
    if not doc:
        raise HTTPException(
            status_code=404,
            detail="Stats have not been generated yet. Run: python -m ingest.stats",
        )
    return doc


@api.get(
    "/",
    response_model=HealthResponse,
    tags=["Health"],
    operation_id="health",
    summary="Health check",
    responses={503: {"model": ErrorResponse, "description": "Database unavailable."}},
)
def read_root():
    """Return service status and confirm the database is reachable."""
    try:
        db.ping()
        return {"message": "Online!"}
    except Exception as exc:  # noqa: BLE001 — surface DB connectivity in the health check
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")


# --- Per-IP rate limiting (slowapi) --------------------------------------
def _client_ip(request: Request) -> str:
    """Prefer X-Forwarded-For (set by deployment proxies) over the socket peer."""
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return get_remote_address(request)


RATE_LIMIT = os.getenv("RATE_LIMIT", "100/minute")
limiter = Limiter(key_func=_client_ip, default_limits=[RATE_LIMIT])
# Applied to the REST app (JSON responses; safe for BaseHTTPMiddleware). MCP
# tool calls invoke /search in-process, so they pass through this limiter too.
# The /mcp transport itself is left unwrapped so its streaming isn't buffered.
api.state.limiter = limiter
api.add_middleware(SlowAPIMiddleware)
api.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# --- MCP server (auto-generated from the REST API) -----------------------
# FastMCP introspects the FastAPI app and turns each operation into an MCP
# tool. Tool calls are handled in-process (ASGI), so the MCP server needs no
# separate deployment — it's served at /mcp by the same process over the
# Streamable HTTP transport.
mcp = FastMCP.from_fastapi(api, name="Gospel Library Search")
mcp_app = mcp.http_app(path="/mcp")  # Streamable HTTP, served at exactly /mcp


# --- Composite ASGI app: MCP (/mcp) + REST (everything else) --------------
# One process serves both. We reuse the MCP route + its session-manager
# lifespan, and add the REST app as the catch-all for all other paths.
app = Starlette(
    routes=[*mcp_app.routes, Mount("/", app=api)],
    lifespan=mcp_app.lifespan,
)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "10000")))
