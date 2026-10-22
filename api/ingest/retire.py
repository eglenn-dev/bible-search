"""Retire an old embedding version: drop its vector index and unset its field.

The last step of a model migration (see docs/embedding-migration.md), once the
new version is live and no rollback is wanted. **Irreversible**: getting the old
vectors back means re-embedding the whole corpus with the old model.

Takes raw names rather than a version, because a retired version has already
been removed from ``embeddings.VERSIONS``. Refuses to touch any field or index a
known version still uses, and refuses to run unless the active version's vectors
cover every document and its index is queryable.

Run from the ``api/`` directory::

    uv run python -m ingest.retire --field embedding --index vector_index --status
    uv run python -m ingest.retire --field embedding --index vector_index         # plan only
    uv run python -m ingest.retire --field embedding --index vector_index --yes   # do it

Resumable: each page only touches documents that still have the field, walking
the collection in ``_id`` order, so an interrupted run just continues.
"""

import argparse
import time

import db
import embeddings
from ingest.common import log_storage
from ingest.reembed import DEFAULT_MAX_WRITES_PER_SEC


def _search_indexes() -> dict[str, dict]:
    return {ix["name"]: ix for ix in db.get_collection().list_search_indexes()}


def _with_field(field: str) -> int:
    return db.get_collection().count_documents({field: {"$exists": True}})


def check_safe(field: str, index: str) -> None:
    """Refuse anything a known version still uses, or an incomplete active version."""
    for v in embeddings.VERSIONS.values():
        if field == v.field or index == v.index:
            raise SystemExit(
                f"Refusing: {v.name} still uses field '{v.field}' / index '{v.index}'."
            )
    active = embeddings.ACTIVE
    missing = db.get_collection().count_documents({active.field: {"$exists": False}})
    if missing:
        raise SystemExit(
            f"Refusing: {missing} document(s) lack the active version's '{active.field}'."
        )
    live = _search_indexes().get(active.index)
    if not live or live.get("status") != "READY" or not live.get("queryable"):
        raise SystemExit(f"Refusing: the active index '{active.index}' is not READY.")
    print(f"active version {active.name}: '{active.field}' on every doc, '{active.index}' READY")


def status(field: str, index: str) -> int:
    present = _with_field(field)
    live = _search_indexes().get(index)
    print(f"field '{field}': on {present} document(s)")
    print(f"index '{index}': {live['status'] if live else 'absent'}")
    log_storage()
    return present


def drop_index(index: str, *, timeout_s: float = 300) -> None:
    collection = db.get_collection()
    if index not in _search_indexes():
        print(f"index '{index}' already absent")
        return
    collection.drop_search_index(index)
    print(f"dropping index '{index}'…", flush=True)
    deadline = time.monotonic() + timeout_s
    while index in _search_indexes():
        if time.monotonic() > deadline:
            raise SystemExit(f"index '{index}' still listed after {timeout_s:.0f}s")
        time.sleep(5)
    print(f"index '{index}' dropped")


def unset_field(field: str, *, batch: int, max_writes_per_sec: float) -> int:
    """``$unset`` ``field`` page by page, throttled under the free tier's ops/s cap."""
    collection = db.get_collection()
    last_id = None
    done = 0
    started = time.perf_counter()
    while True:
        query: dict = {field: {"$exists": True}}
        if last_id is not None:
            query["_id"] = {"$gt": last_id}
        ids = [d["_id"] for d in collection.find(query, {"_id": 1}).sort("_id", 1).limit(batch)]
        if not ids:
            break
        last_id = ids[-1]
        t0 = time.perf_counter()
        result = collection.update_many(
            {"_id": {"$in": ids}, field: {"$exists": True}}, {"$unset": {field: ""}}
        )
        done += result.modified_count
        # Count every modified document as an op, as the backfill does.
        min_s = len(ids) / max_writes_per_sec
        elapsed = time.perf_counter() - t0
        if elapsed < min_s:
            time.sleep(min_s - elapsed)
        rate = done / (time.perf_counter() - started)
        print(f"  unset {done} docs ({rate:.0f} docs/s), last _id={last_id}", flush=True)
    return done


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Drop a retired embedding version's index and unset its field (irreversible)."
    )
    parser.add_argument("--field", required=True, help="Vector field to unset (e.g. embedding).")
    parser.add_argument("--index", required=True, help="Vector index to drop (e.g. vector_index).")
    parser.add_argument("--status", action="store_true", help="Print what's left and exit.")
    parser.add_argument("--yes", action="store_true",
                        help="Actually drop and unset. Without it, only print the plan.")
    parser.add_argument("--batch", type=int, default=500, help="Documents per update.")
    parser.add_argument("--max-writes-per-sec", type=float, default=DEFAULT_MAX_WRITES_PER_SEC)
    args = parser.parse_args()

    present = status(args.field, args.index)
    if args.status:
        return
    check_safe(args.field, args.index)
    if not args.yes:
        eta_min = present / args.max_writes_per_sec / 60
        print(f"plan: drop index '{args.index}', then unset '{args.field}' on {present} docs "
              f"(~{eta_min:.0f} min at {args.max_writes_per_sec:.0f}/s). Re-run with --yes.")
        return

    drop_index(args.index)
    done = unset_field(args.field, batch=args.batch, max_writes_per_sec=args.max_writes_per_sec)
    print(f"unset '{args.field}' on {done} document(s).")
    status(args.field, args.index)


if __name__ == "__main__":
    main()
