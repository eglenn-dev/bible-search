import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from sentence_transformers import SentenceTransformer

import db

print("Loading embedding model (query encoding only)...")
model = SentenceTransformer("paraphrase-MiniLM-L3-v2")
print("Model loaded successfully.")

app = FastAPI(title="Gospel Library Search")

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


def _encode(text: str) -> list[float]:
    """Encode a query string to a normalized 384-dim vector."""
    vector = model.encode([text], normalize_embeddings=True)[0]
    return vector.tolist()


def _parse_sources(sources: str | None) -> list[str] | None:
    if not sources:
        return None
    return [s.strip().lower() for s in sources.split(",") if s.strip()]


@app.get("/search")
def search(
    query: str = Query(..., description="Free-text query to search across all corpora."),
    k: int = Query(10, ge=1, le=50),
    sources: str | None = Query(
        None, description="Comma-separated subset of: bible, conference, handbook."
    ),
):
    """Unified semantic search across the Bible, General Conference, and Handbook."""
    query = query.strip()
    if not query:
        raise HTTPException(status_code=400, detail="query must not be empty.")
    results = db.vector_search(_encode(query), k=k, sources=_parse_sources(sources))
    return {"query": query, "results": results}


@app.get("/search/by-reference")
def search_by_reference(
    reference: str = Query(..., description="Exact scripture reference, e.g. 'John 3:16'."),
    k: int = Query(10, ge=1, le=50),
    sources: str | None = Query(None),
):
    """Find documents similar to a known verse, reusing its stored embedding."""
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


@app.get("/")
def read_root():
    try:
        db.ping()
        return {"message": "Online!"}
    except Exception as exc:  # surface DB connectivity issues in the health check
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", 10000)))
