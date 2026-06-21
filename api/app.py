import os
from functools import lru_cache
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db

# --- Schemas -------------------------------------------------------------

SourceLiteral = Literal[
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
    "conference",
    "handbook",
]


class SearchResult(BaseModel):
    source: SourceLiteral = Field(..., description="Which corpus the result belongs to.")
    reference: str = Field(
        ..., description="Human label: verse reference, talk title, or handbook section."
    )
    text: str = Field(..., description="The matched passage text.")
    title: Optional[str] = Field(
        None, description="Talk/chapter title; null for scripture verses."
    )
    url: str = Field(..., description="Deep link to the passage on churchofjesuschrist.org.")
    score: float = Field(
        ..., description="Cosine similarity in [0, 1] — higher is more relevant."
    )
    metadata: dict[str, Any] = Field(
        default_factory=dict, description="Source-specific metadata (speaker, book, section, …)."
    )

    model_config = {
        "json_schema_extra": {
            "example": {
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


class HealthResponse(BaseModel):
    message: str = Field(..., examples=["Online!"])


class ErrorResponse(BaseModel):
    detail: str


# --- App -----------------------------------------------------------------

DESCRIPTION = """
Semantic search across the LDS **Standard Works** (Bible, Book of Mormon,
Doctrine and Covenants, Pearl of Great Price), **General Conference** addresses
(1971–present), and the **General Handbook**.

Queries are matched by meaning using sentence embeddings + MongoDB Atlas Vector
Search. Every result links back to the passage on churchofjesuschrist.org.

- **Interactive docs (Swagger UI):** [`/docs`](/docs)
- **ReDoc:** [`/redoc`](/redoc)
- **OpenAPI spec:** [`/openapi.json`](/openapi.json)
"""

tags_metadata = [
    {"name": "Search", "description": "Semantic vector search across the corpora."},
    {"name": "Health", "description": "Service and database status."},
]

app = FastAPI(
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
]
_env_origins = os.getenv("ALLOWED_ORIGINS")
allowed_origins = (
    [o.strip() for o in _env_origins.split(",") if o.strip()]
    if _env_origins
    else _default_origins
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)


@lru_cache(maxsize=1)
def get_model():
    """Lazily load the query-encoding model on first use.

    Loading lazily keeps startup fast and lets the OpenAPI spec be generated
    (and the app imported in tests) without pulling the model into memory.
    """
    from sentence_transformers import SentenceTransformer

    print("Loading embedding model (paraphrase-MiniLM-L3-v2)...")
    return SentenceTransformer("paraphrase-MiniLM-L3-v2")


def _encode(text: str) -> list[float]:
    """Encode a query string to a normalized 384-dim vector."""
    vector = get_model().encode([text], normalize_embeddings=True)[0]
    return vector.tolist()


def _parse_sources(sources: str | None) -> list[str] | None:
    if not sources:
        return None
    return [s.strip().lower() for s in sources.split(",") if s.strip()]


@app.get(
    "/search",
    response_model=SearchResponse,
    tags=["Search"],
    summary="Semantic search across all corpora",
    responses={400: {"model": ErrorResponse, "description": "Empty query."}},
)
def search(
    query: str = Query(
        ...,
        description="Free-text query to search across all corpora by meaning.",
        examples=["charity never faileth"],
    ),
    k: int = Query(10, ge=1, le=50, description="Number of results to return."),
    sources: Optional[str] = Query(
        None,
        description=(
            "Comma-separated subset to search. Any of: bible, book-of-mormon, "
            "doctrine-and-covenants, pearl-of-great-price, conference, handbook. "
            "Omit to search everything."
        ),
        examples=["bible,book-of-mormon"],
    ),
):
    """Encode the query and return the most semantically similar passages."""
    query = query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query must not be empty.")
    results = db.vector_search(_encode(query), k=k, sources=_parse_sources(sources))
    return {"query": query, "results": results}


@app.get(
    "/search/by-reference",
    response_model=SearchResponse,
    tags=["Search"],
    summary="Find passages similar to a known verse",
    responses={404: {"model": ErrorResponse, "description": "Unknown reference."}},
)
def search_by_reference(
    reference: str = Query(
        ...,
        description="Exact scripture reference present in the corpus.",
        examples=["John 3:16"],
    ),
    k: int = Query(10, ge=1, le=50, description="Number of results to return."),
    sources: Optional[str] = Query(
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

    query_vector = db.embedding_to_list(doc["embedding"])
    # Fetch one extra so we can drop the self-match.
    hits = db.vector_search(
        query_vector, k=k, sources=_parse_sources(sources), limit=k + 1
    )
    hits = [h for h in hits if h.get("reference") != doc["reference"]][:k]
    return {"query": doc["reference"], "results": hits}


@app.get(
    "/",
    response_model=HealthResponse,
    tags=["Health"],
    summary="Health check",
    responses={503: {"model": ErrorResponse, "description": "Database unavailable."}},
)
def read_root():
    """Return service status and confirm the database is reachable."""
    try:
        db.ping()
        return {"message": "Online!"}
    except Exception as exc:  # surface DB connectivity issues in the health check
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 10000)))
