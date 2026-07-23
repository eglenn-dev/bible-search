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
MONGODB_STATS_COLLECTION = os.getenv("MONGODB_STATS_COLLECTION", "stats")
LOG_QUERIES = os.getenv("LOG_QUERIES", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "",
}


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, "") or default)
    except ValueError:
        return default


# --- Result re-ranking: recency boost + per-document de-duplication ----------
# After $vectorSearch we (1) gently lift more-recent dated passages so the newest
# General Conference / BYU Speeches aren't buried under the far larger back
# catalogue, and (2) collapse the multiple chunks of one talk/speech/section to
# its single best-matching chunk so one source can't fill the whole page.
#
# The factor is multiplicative on the cosine score and neutral-centered (see
# _recency_factor): a passage ``RECENCY_HALFLIFE_YEARS`` old is neutral, newer
# ones are lifted up to ×(1+RECENCY_WEIGHT), older ones lowered toward
# ×(1-RECENCY_WEIGHT). Tuned so recent talks surface without burying the
# undated scriptures. Set RECENCY_WEIGHT=0 to disable.
RECENCY_WEIGHT = _env_float("RECENCY_WEIGHT", 0.06)
RECENCY_HALFLIFE_YEARS = _env_float("RECENCY_HALFLIFE_YEARS", 8.0)
DEDUPE_RESULTS = os.getenv("DEDUPE_RESULTS", "1").strip().lower() not in {
    "0",
    "false",
    "no",
    "",
}
# Pull this many × the requested hits before dedupe/re-rank so the final list
# still fills `limit` distinct documents.
RESULT_OVERFETCH = 6

# Per-source field identifying the underlying document (talk/speech/section).
# Chunks sharing this value are the same document and are de-duplicated.
_DOC_GROUP_FIELDS = {
    "conference": "talk_uri",
    "byu-speeches": "speech_path",
    "handbook": "chapter_uri",
}

_CURRENT_YEAR = datetime.now(timezone.utc).year

VALID_SOURCES = {
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
    "conference",
    "byu-speeches",
    "handbook",
}

# Fields fetched for every hit. `_id` is the deterministic document key, recorded
# in the query log for analytics; it's dropped from the API payload by the
# `SearchResult` response model (which has no `_id`/`id` field).
_PROJECTION = {
    "_id": 1,
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


def _recency_factor(hit: dict[str, Any]) -> float:
    """Neutral-centered score multiplier based on a dated passage's age.

    Centered on ``1.0`` so it lifts *recent* dated passages and gently lowers
    *old* ones, rather than handing every dated source a blanket edge over the
    undated, timeless scriptures. A passage from the current year is scored
    ``×(1 + RECENCY_WEIGHT)``, one ``RECENCY_HALFLIFE_YEARS`` old is neutral
    (``×1.0``, the same as scripture/handbook), and very old ones approach
    ``×(1 - RECENCY_WEIGHT)``.
    """
    if RECENCY_WEIGHT <= 0 or RECENCY_HALFLIFE_YEARS <= 0:
        return 1.0
    year = (hit.get("metadata") or {}).get("year")
    if not isinstance(year, int):
        return 1.0
    age = max(0, _CURRENT_YEAR - year)
    decay = 0.5 ** (age / RECENCY_HALFLIFE_YEARS)  # 1.0 at age 0 → 0 as age grows
    return 1.0 + RECENCY_WEIGHT * (2.0 * decay - 1.0)


def _group_key(hit: dict[str, Any]) -> tuple:
    """Key identifying a hit's underlying source document, for de-duplication."""
    source = hit.get("source")
    field = _DOC_GROUP_FIELDS.get(source)
    if field:
        value = (hit.get("metadata") or {}).get(field)
        if value:
            return (source, value)
    # Scriptures are one chunk per verse; for those (or a missing group field)
    # key on the passage itself so distinct passages are never merged.
    return (source, hit.get("reference"), hit.get("url"))


def _rerank_and_dedupe(
    hits: list[dict[str, Any]], limit: int
) -> list[dict[str, Any]]:
    """Apply the recency boost, then keep each document's best chunk, up to ``limit``.

    Ranking uses ``score * recency_factor``, but the cosine ``score`` returned to
    callers is left unchanged so the displayed "% match" stays truthful.
    """
    if RECENCY_WEIGHT > 0:
        hits = sorted(
            hits,
            key=lambda h: h.get("score", 0.0) * _recency_factor(h),
            reverse=True,
        )
    if not DEDUPE_RESULTS:
        return hits[:limit]

    seen: set = set()
    out: list[dict[str, Any]] = []
    for hit in hits:
        key = _group_key(hit)
        if key in seen:
            continue
        seen.add(key)
        out.append(hit)
        if len(out) >= limit:
            break
    return out


def vector_search(
    query_vector: list[float],
    k: int = 10,
    sources: Optional[list[str]] = None,
    limit: Optional[int] = None,
) -> list[dict[str, Any]]:
    """Run an Atlas ``$vectorSearch`` and return re-ranked, de-duplicated hits.

    - ``query_vector``: normalized 384-dim query embedding.
    - ``sources``: optional subset of {bible, conference, handbook} to filter on.
    - ``limit``: number of hits to return (defaults to ``k``); callers that need
      to drop a self-match request one extra.

    Raw chunks are over-fetched, lifted by a recency factor (see
    ``_recency_factor``), then collapsed to one hit per source document (see
    ``_rerank_and_dedupe``) before the top ``limit`` are returned.
    """
    limit = limit or k
    cleaned = _clean_sources(sources)
    # Over-fetch so recency re-ranking + de-duplication still yield `limit`
    # distinct documents.
    fetch_limit = min(max(limit * RESULT_OVERFETCH, 100), 1000)
    num_candidates = min(max(fetch_limit * 20, 150), 10000)

    vector_stage: dict[str, Any] = {
        "index": VECTOR_INDEX_NAME,
        "path": "embedding",
        "queryVector": query_vector,
        "numCandidates": num_candidates,
        "limit": fetch_limit,
    }
    if cleaned:
        vector_stage["filter"] = {"source": {"$in": cleaned}}

    pipeline = [
        {"$vectorSearch": vector_stage},
        {"$project": _PROJECTION},
    ]
    hits = list(get_collection().aggregate(pipeline))
    return _rerank_and_dedupe(hits, limit)


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


def get_stats_collection() -> Collection:
    return get_client()[MONGODB_DB][MONGODB_STATS_COLLECTION]


def get_site_stats() -> Optional[dict[str, Any]]:
    """Return the precomputed stats-page payload, or None if never generated.

    Written offline by ``python -m ingest.stats`` as a single document
    ``{_id: "site_stats", generated_at, data}``; served verbatim by ``GET /stats``.
    """
    doc = get_stats_collection().find_one({"_id": "site_stats"})
    if doc:
        doc.pop("_id", None)
    return doc


def log_query(
    *,
    endpoint: str,
    query: str,
    k: int,
    sources: Optional[list[str]],
    result_count: int,
    result_ids: Optional[list[str]] = None,
    ip: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> None:
    """Record a user search for analytics. Best-effort: never raises.

    ``sources`` and ``k`` capture the filter params applied to the search, and
    ``result_ids`` records the deterministic ``_id`` of each returned passage, in
    result order, so we can see which documents surfaced for a query/filter combo.

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
                "result_ids": result_ids,
                "ip": ip,
                "user_agent": user_agent,
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception:  # logging must never break the request path
        logger.warning("Failed to log query", exc_info=True)
