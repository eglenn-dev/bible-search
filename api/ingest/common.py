"""Shared ingestion helpers: embedding, upserts, and index management.

Run ingestion modules from the ``api/`` directory, e.g.::

    python -m ingest.run --source bible
    python -m ingest.run --source all
"""

from collections.abc import Iterable
from typing import Any

from bson.binary import Binary
from pymongo import ReplaceOne
from pymongo.operations import SearchIndexModel

import db
import embeddings
from embeddings import EmbeddingVersion

UPSERT_BATCH = 500


def embed_texts(texts: list[str], version: EmbeddingVersion | None = None) -> list[Binary]:
    """Encode passages to binData vectors for one embedding version (default: active)."""
    return embeddings.encode_passages(texts, version or embeddings.ACTIVE)


def embed_records(records: list[dict[str, Any]]) -> None:
    """Set every written embedding field (``EMBEDDING_WRITE_VERSIONS``) on records.

    Upserts replace whole documents, so a version left out here would be wiped
    from re-ingested docs — keep every version in use in EMBEDDING_WRITE_VERSIONS.
    """
    texts = [r["text"] for r in records]
    for version in embeddings.WRITE_VERSIONS:
        for record, vector in zip(records, embed_texts(texts, version)):
            record[version.field] = vector


def upsert_docs(docs: list[dict[str, Any]]) -> int:
    """Upsert documents by their deterministic ``_id`` (idempotent / resumable)."""
    if not docs:
        return 0
    collection = db.get_collection()
    written = 0
    for i in range(0, len(docs), UPSERT_BATCH):
        batch = docs[i : i + UPSERT_BATCH]
        ops = [ReplaceOne({"_id": d["_id"]}, d, upsert=True) for d in batch]
        result = collection.bulk_write(ops, ordered=False)
        written += (result.upserted_count or 0) + (result.modified_count or 0)
    return written


def embed_and_upsert(records: list[dict[str, Any]]) -> int:
    """Given records missing only their embeddings, embed their ``text`` and upsert."""
    if not records:
        return 0
    embed_records(records)
    return upsert_docs(records)


def already_ingested(query: dict[str, Any]) -> bool:
    """True if at least one doc matches ``query`` (used for resumable scrapes)."""
    return db.get_collection().count_documents(query, limit=1) > 0


def _same_fields(live: dict[str, Any] | None, wanted: dict[str, Any]) -> bool:
    """True if a live index definition has exactly the wanted fields.

    Order-insensitive, and tolerant of keys Atlas adds to a field on its own:
    each wanted field must match one live field on every key it sets.
    """
    live_fields = (live or {}).get("fields", [])
    wanted_fields = wanted["fields"]
    if len(live_fields) != len(wanted_fields):
        return False
    return all(
        any(all(lf.get(k) == v for k, v in wf.items()) for lf in live_fields)
        for wf in wanted_fields
    )


def ensure_vector_index(version: EmbeddingVersion | None = None) -> str:
    """Create a version's vector index (default: active), or update it if it differs.

    The definition comes from ``embeddings.index_definition``. Returns
    ``"created"``, ``"updated"`` or ``"unchanged"``. Either change makes Atlas
    (re)build the index asynchronously; during an update the old definition
    keeps serving queries until the rebuild finishes and Atlas swaps it in, so
    filters on newly added paths only work once it reports READY.
    """
    version = version or embeddings.ACTIVE
    wanted = embeddings.index_definition(version)
    collection = db.get_collection()
    existing = {ix["name"]: ix for ix in collection.list_search_indexes()}
    current = existing.get(version.index)

    if current is None:
        model = SearchIndexModel(
            name=version.index, type="vectorSearch", definition=wanted
        )
        collection.create_search_index(model)
        print(
            f"Created vector index '{version.index}' on '{version.field}'. "
            "Atlas builds it asynchronously; wait until it is READY before querying."
        )
        return "created"

    live = current.get("latestDefinition")
    if _same_fields(live, wanted):
        print(f"Vector index '{version.index}' is up to date.")
        return "unchanged"

    live_paths = sorted(f.get("path", "?") for f in (live or {}).get("fields", []))
    new_paths = sorted(f["path"] for f in wanted["fields"])
    collection.update_search_index(version.index, wanted)
    print(
        f"Updating vector index '{version.index}': fields {live_paths} -> "
        f"{new_paths}. Atlas rebuilds it in the background and keeps serving the "
        "old definition until the new one is READY."
    )
    return "updated"


def storage_stats() -> dict[str, float]:
    """Return database storage usage in MB (watch this against the M0 512MB cap)."""
    stats = db.get_client()[db.MONGODB_DB].command("dbstats", scale=1024 * 1024)
    return {
        "data_mb": round(stats.get("dataSize", 0), 1),
        "storage_mb": round(stats.get("storageSize", 0), 1),
        "index_mb": round(stats.get("indexSize", 0), 1),
        "docs": stats.get("objects", 0),
    }


def log_storage(label: str = "") -> None:
    s = storage_stats()
    print(
        f"[storage{(' ' + label) if label else ''}] docs={s['docs']} "
        f"data={s['data_mb']}MB storage={s['storage_mb']}MB index={s['index_mb']}MB"
    )


def chunked(items: list[Any], size: int) -> Iterable[list[Any]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]
