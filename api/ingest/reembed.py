"""Re-embed the corpus into another embedding version's field — non-destructively.

Writes ``$set: {<version.field>: <vector>}`` onto existing documents and never
touches any other field, so the live version keeps serving while this runs.
Resumable: each run only processes documents that don't have the field yet,
walking the collection in ``_id`` order (no long-lived cursor, so an interrupted
run just continues where it stopped). See docs/embedding-migration.md.

Run from the ``api/`` directory::

    uv run python -m ingest.reembed --version v2 --status        # coverage only
    uv run python -m ingest.reembed --version v2 --dry-run --limit 500
    uv run python -m ingest.reembed --version v2                 # the real backfill
    uv run python -m ingest.reembed --version v2 --create-index  # then build its index

``--dry-run`` reads + embeds but writes nothing (and never creates indexes).
"""

import argparse
import time

from pymongo import UpdateOne

import db
import embeddings
from ingest.common import embed_texts, storage_stats

# Atlas free tier: 512 MB = uncompressed BSON of all documents + index bytes.
STORAGE_CAP_MB = 512
# Refuse to start a backfill that's projected to leave less than this free.
STORAGE_HEADROOM_MB = 40
# Free tier throughput cap is 100 ops/s; stay under it so the live API isn't throttled.
DEFAULT_MAX_WRITES_PER_SEC = 60
# Approximate BSON bytes a vector field adds per document (field name + binData).
_VECTOR_BYTES = {"float32": 4, "int8": 1}


def _field_bytes(version: embeddings.EmbeddingVersion) -> int:
    # type byte + name + NUL + int32 length + subtype + 2-byte vector header + payload
    return 1 + len(version.field) + 1 + 4 + 1 + 2 + version.dim * _VECTOR_BYTES[version.dtype]


def _missing_filter(version: embeddings.EmbeddingVersion, source: str | None) -> dict:
    query: dict = {version.field: {"$exists": False}}
    if source:
        query["source"] = source
    return query


def status(version: embeddings.EmbeddingVersion) -> int:
    """Print per-source coverage of ``version.field``; return the number missing."""
    collection = db.get_collection()
    rows = collection.aggregate(
        [
            {
                "$group": {
                    "_id": "$source",
                    "total": {"$sum": 1},
                    "done": {
                        "$sum": {
                            "$cond": [{"$ifNull": [f"${version.field}", False]}, 1, 0]
                        }
                    },
                }
            },
            {"$sort": {"_id": 1}},
        ]
    )
    total = done = 0
    print(f"{version.name} ({version.model}) → field '{version.field}':")
    for row in rows:
        total += row["total"]
        done += row["done"]
        print(f"  {row['_id']:<24} {row['done']:>7}/{row['total']:<7}")
    print(f"  {'TOTAL':<24} {done:>7}/{total:<7}  missing={total - done}")
    return total - done


def check_storage(version: embeddings.EmbeddingVersion, missing: int, force: bool) -> None:
    s = storage_stats()
    used = s["data_mb"] + s["index_mb"]
    added = missing * _field_bytes(version) / (1024 * 1024)
    projected = used + added
    print(
        f"storage: data+index={used:.1f}MB, +{missing} × {_field_bytes(version)}B "
        f"≈ +{added:.1f}MB → ~{projected:.1f}MB of {STORAGE_CAP_MB}MB"
    )
    if projected > STORAGE_CAP_MB - STORAGE_HEADROOM_MB and not force:
        raise SystemExit(
            f"Refusing: projected {projected:.0f}MB leaves < {STORAGE_HEADROOM_MB}MB "
            "headroom under the free-tier cap (pass --force to override)."
        )


def reembed(
    version: embeddings.EmbeddingVersion,
    *,
    batch: int,
    limit: int | None,
    source: str | None,
    dry_run: bool,
    max_writes_per_sec: float,
) -> int:
    collection = db.get_collection()
    query = _missing_filter(version, source)
    last_id = None
    processed = 0
    started = time.perf_counter()
    while limit is None or processed < limit:
        page_query = dict(query)
        if last_id is not None:
            page_query["_id"] = {"$gt": last_id}
        size = batch if limit is None else min(batch, limit - processed)
        page = list(
            collection.find(page_query, {"_id": 1, "text": 1}).sort("_id", 1).limit(size)
        )
        if not page:
            break
        last_id = page[-1]["_id"]

        t0 = time.perf_counter()
        vectors = embed_texts([d.get("text") or "" for d in page], version)
        embed_s = time.perf_counter() - t0

        if not dry_run:
            ops = [
                # Guarded on the field still being absent, so a concurrent ingest
                # that already wrote this version is never overwritten.
                UpdateOne({"_id": d["_id"], version.field: {"$exists": False}},
                          {"$set": {version.field: v}})
                for d, v in zip(page, vectors)
            ]
            t1 = time.perf_counter()
            collection.bulk_write(ops, ordered=False)
            # Throttle to stay under the free tier's ops/s cap.
            min_s = len(ops) / max_writes_per_sec
            elapsed = time.perf_counter() - t1
            if elapsed < min_s:
                time.sleep(min_s - elapsed)

        processed += len(page)
        rate = processed / (time.perf_counter() - started)
        print(
            f"  {'[dry-run] ' if dry_run else ''}{processed} docs "
            f"(embed {embed_s:.1f}s/batch, {rate:.0f} docs/s overall), last _id={last_id}",
            flush=True,
        )
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description="Backfill another embedding version's vectors.")
    parser.add_argument("--version", required=True, choices=sorted(embeddings.VERSIONS),
                        help="Embedding version to write (its field gets the vectors).")
    parser.add_argument("--status", action="store_true", help="Print coverage and exit.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Read + embed but write nothing (no index creation either).")
    parser.add_argument("--limit", type=int, help="Stop after this many documents.")
    parser.add_argument("--source", help="Only re-embed one source (e.g. bible).")
    parser.add_argument("--batch", type=int, default=500, help="Documents per read/write page.")
    parser.add_argument("--max-writes-per-sec", type=float, default=DEFAULT_MAX_WRITES_PER_SEC)
    parser.add_argument("--create-index", action="store_true",
                        help="Create the version's vector index (after the backfill).")
    parser.add_argument("--force", action="store_true", help="Skip the storage-cap guard.")
    args = parser.parse_args()

    version = embeddings.get_version(args.version)
    if version is embeddings.ACTIVE and not args.status:
        print(f"note: {version.name} is the active version (EMBEDDING_VERSION).")

    missing = status(version)
    if args.status:
        return

    if args.create_index:
        if args.dry_run:
            print(f"[dry-run] would ensure index '{version.index}': "
                  f"{embeddings.index_definition(version)}")
        else:
            from ingest.common import ensure_vector_index

            ensure_vector_index(version)
        return

    check_storage(version, missing if args.limit is None else min(missing, args.limit),
                  args.force)
    done = reembed(
        version,
        batch=args.batch,
        limit=args.limit,
        source=args.source,
        dry_run=args.dry_run,
        max_writes_per_sec=args.max_writes_per_sec,
    )
    print(f"{'[dry-run] embedded' if args.dry_run else 'wrote'} {done} document(s).")
    if not args.dry_run:
        status(version)


if __name__ == "__main__":
    main()
