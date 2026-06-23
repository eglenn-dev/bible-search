"""MongoDB Atlas access layer for the Gospel Library search API.

All corpora (bible, conference, handbook) live in a single collection with a
384-dim ``embedding`` field indexed for Atlas Vector Search. The API never loads
the dataset or the embeddings into process memory; it only issues
``$vectorSearch`` aggregations against Atlas.
"""

import logging
import os
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Optional

from bson.binary import Binary
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.collection import Collection

load_dotenv()

logger = logging.getLogger(__name__)

MONGODB_URI = os.getenv("MONGODB_URI", "")
MONGODB_DB = os.getenv("MONGODB_DB", "gospel_library")
MONGODB_COLLECTION = os.getenv("MONGODB_COLLECTION", "documents")
VECTOR_INDEX_NAME = os.getenv("VECTOR_INDEX_NAME", "vector_index")
MONGODB_QUERY_LOG_COLLECTION = os.getenv("MONGODB_QUERY_LOG_COLLECTION", "query_logs")
LOG_QUERIES = os.getenv("LOG_QUERIES", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "",
}

VALID_SOURCES = {
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
    "conference",
    "byu-speeches",
    "handbook",
}

# Fields returned to the client for every hit.
_PROJECTION = {
    "_id": 0,
    "source": 1,
    "reference": 1,
    "text": 1,
    "title": 1,
    "url": 1,
    "metadata": 1,
    "score": {"$meta": "vectorSearchScore"},
}


@lru_cache(maxsize=1)
def get_client() -> MongoClient:
    if not MONGODB_URI:
        raise RuntimeError(
            "MONGODB_URI is not set. Add it to api/.env before starting the API."
        )
    return MongoClient(MONGODB_URI, appname="gospel-library-search")


def get_collection() -> Collection:
    return get_client()[MONGODB_DB][MONGODB_COLLECTION]


def ping() -> bool:
    """Returns True if the Atlas cluster is reachable."""
    get_client().admin.command("ping")
    return True


def _clean_sources(sources: Optional[list[str]]) -> Optional[list[str]]:
    if not sources:
        return None
    cleaned = [s for s in sources if s in VALID_SOURCES]
    return cleaned or None


def vector_search(
    query_vector: list[float],
    k: int = 10,
    sources: Optional[list[str]] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Run an Atlas ``$vectorSearch`` and return projected hits with scores.

    - ``query_vector``: normalized 384-dim query embedding.
    - ``sources``: optional subset of {bible, conference, handbook} to filter on.
    - ``limit``: number of hits to return (defaults to ``k``); callers that need
      to drop a self-match request one extra.
    """
    limit = limit or k
    cleaned = _clean_sources(sources)
    num_candidates = min(max(limit * 20, 150), 10000)

    vector_stage: dict[str, Any] = {
        "index": VECTOR_INDEX_NAME,
        "path": "embedding",
        "queryVector": query_vector,
        "numCandidates": num_candidates,
        "limit": limit,
    }
    if cleaned:
        vector_stage["filter"] = {"source": {"$in": cleaned}}

    pipeline = [
        {"$vectorSearch": vector_stage},
        {"$project": _PROJECTION},
    ]
    return list(get_collection().aggregate(pipeline))


def find_by_reference(reference: str) -> Optional[dict[str, Any]]:
    """Fetch a single document (with its stored embedding) by exact reference."""
    return get_collection().find_one({"reference": reference})


def find_verse(reference: str) -> Optional[dict[str, Any]]:
    """Look up a passage by exact reference for display (no embedding/_id)."""
    return get_collection().find_one(
        {"reference": reference}, {"embedding": 0, "_id": 0}
    )


def embedding_to_list(embedding: Any) -> list[float]:
    """Normalize a stored embedding (BSON binData vector or array) to a list."""
    if isinstance(embedding, Binary):
        return list(embedding.as_vector().data)
    return list(embedding)


def get_query_log_collection() -> Collection:
    return get_client()[MONGODB_DB][MONGODB_QUERY_LOG_COLLECTION]


def log_query(
    *,
    endpoint: str,
    query: str,
    k: int,
    sources: Optional[list[str]],
    result_count: int,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """Record a user search for analytics. Best-effort: never raises.

    Intended to run after the response is sent (e.g. via FastAPI ``BackgroundTasks``)
    so it adds no latency to the search itself. Any failure is swallowed and logged
    so a logging/connection hiccup can never break search.
    """
    if not LOG_QUERIES:
        return
    try:
        get_query_log_collection().insert_one(
            {
                "endpoint": endpoint,
                "query": query,
                "k": k,
                "sources": sources,
                "result_count": result_count,
                "ip": ip,
                "user_agent": user_agent,
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:  # logging must never break the request path
        logger.warning("Failed to log query", exc_info=True)
