"""Shared ingestion helpers: embedding, upserts, and index management.

Run ingestion modules from the ``api/`` directory, e.g.::

    python -m ingest.run --source bible
    python -m ingest.run --source all
"""

from collections.abc import Iterable
from typing import Any

from bson.binary import Binary, BinaryVectorDtype
from pymongo import ReplaceOne
from pymongo.operations import SearchIndexModel

import db
import encoder

EMBED_DIM = 384
EMBED_BATCH = 256
UPSERT_BATCH = 500


def embed_texts(texts: list[str]) -> list[Binary]:
    """Encode texts to normalized 384-dim BSON float32 binData vectors (ONNX)."""
    vectors = encoder.encode_batch(texts, batch_size=EMBED_BATCH)
    return [
        Binary.from_vector([float(x) for x in vec], BinaryVectorDtype.FLOAT32)
        for vec in vectors
    ]


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
    """Given records missing only ``embedding``, embed their ``text`` and upsert."""
    if not records:
        return 0
    embeddings = embed_texts([r["text"] for r in records])
    for record, embedding in zip(records, embeddings):
        record["embedding"] = embedding
    return upsert_docs(records)


def already_ingested(query: dict[str, Any]) -> bool:
    """True if at least one doc matches ``query`` (used for resumable scrapes)."""
    return db.get_collection().count_documents(query, limit=1) > 0


def ensure_vector_index() -> None:
    """Create the Atlas Vector Search index if it does not already exist."""
    collection = db.get_collection()
    existing = {ix["name"] for ix in collection.list_search_indexes()}
    if db.VECTOR_INDEX_NAME in existing:
        print(f"Vector index '{db.VECTOR_INDEX_NAME}' already exists.")
        return

    model = SearchIndexModel(
        name=db.VECTOR_INDEX_NAME,
        type="vectorSearch",
        definition={
            "fields": [
                {
                    "type": "vector",
                    "path": "embedding",
                    "numDimensions": EMBED_DIM,
                    "similarity": "cosine",
                    "quantization": "scalar",
                },
                {"type": "filter", "path": "source"},
            ]
        },
    )
    collection.create_search_index(model)
    print(
        f"Created vector index '{db.VECTOR_INDEX_NAME}'. "
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
