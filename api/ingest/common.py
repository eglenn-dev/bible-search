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


def ensure_vector_index(version: EmbeddingVersion | None = None) -> None:
    """Create a version's Atlas Vector Search index (default: active) if missing."""
    version = version or embeddings.ACTIVE
    collection = db.get_collection()
    existing = {ix["name"] for ix in collection.list_search_indexes()}
    if version.index in existing:
        print(f"Vector index '{version.index}' already exists.")
        return

    model = SearchIndexModel(
        name=version.index,
        type="vectorSearch",
        definition=embeddings.index_definition(version),
    )
    collection.create_search_index(model)
    print(
        f"Created vector index '{version.index}' on '{version.field}'. "
        "Atlas builds it asynchronously; wait until it is READY before querying."
    )


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
