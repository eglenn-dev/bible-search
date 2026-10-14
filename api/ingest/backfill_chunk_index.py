"""Backfill ``metadata.chunk_index`` on already-ingested conference and handbook chunks.

Run from the ``api/`` directory::

    uv run python -m ingest.backfill_chunk_index            # dry run: report only
    uv run python -m ingest.backfill_chunk_index --apply    # write chunk_index

``/passage/context`` orders a talk's (or handbook chapter's) chunks by
``metadata.chunk_index``, which ingest now records. Chunks stored before that
have none, and their ids can't stand in for it: new-format conference paragraph
ids (``p_aB3dE``) are random, and handbook ids only order chunks within a
section. This rebuilds each document's records with the same parser and
``build_records`` the ingest uses — from the on-disk scrape cache, fetching only
what isn't cached — and sets ``chunk_index`` on the stored chunks.

Only ``metadata.chunk_index`` is written; text and embeddings are untouched. A
document is updated only when the rebuilt chunk ids match the stored ones
exactly (otherwise the page changed since it was ingested, so the order can't be
trusted); those are listed in the report instead. Re-running is a no-op for
chunks that already have the right index. To undo:
``db.documents.updateMany({}, {$unset: {"metadata.chunk_index": ""}})``.
"""

import argparse
import time
from collections import defaultdict

from pymongo import UpdateOne

import db
from ingest import conference, handbook

SOURCES = ("conference", "handbook")
# Stored-document field naming the talk / chapter each chunk belongs to.
_GROUP_FIELD = {"conference": "talk_uri", "handbook": "chapter_uri"}


def _stored_groups(source: str) -> dict[str, dict]:
    """``{talk/chapter uri: {"ids": {_id: chunk_index}, "year", "month"}}`` from Atlas."""
    field = _GROUP_FIELD[source]
    groups: dict[str, dict] = defaultdict(lambda: {"ids": {}})
    cursor = db.get_collection().find(
        {"source": source},
        {"_id": 1, f"metadata.{field}": 1, "metadata.year": 1, "metadata.month": 1,
         "metadata.chunk_index": 1},
    )
    for d in cursor:
        meta = d.get("metadata") or {}
        group = groups[meta.get(field)]
        group["ids"][d["_id"]] = meta.get("chunk_index")
        group["year"], group["month"] = meta.get("year"), meta.get("month")
    groups.pop(None, None)
    return groups


def _rebuild(source: str, uri: str, group: dict) -> list[dict] | None:
    """The records ingest would build for ``uri`` today (None if unparseable)."""
    if source == "conference":
        talk = conference.parse_talk(uri)
        if not talk or not talk["paragraphs"]:
            return None
        return conference.build_records(uri, group["year"], group["month"], talk)
    chapter = handbook.parse_chapter(uri)
    if not chapter:
        return None
    return handbook.build_records(uri, chapter)


def backfill(source: str, apply: bool) -> dict:
    groups = _stored_groups(source)
    print(f"{source}: {len(groups)} documents, "
          f"{sum(len(g['ids']) for g in groups.values())} chunks stored", flush=True)
    stats = {"documents": len(groups), "matched": 0, "already": 0, "updated": 0,
             "mismatched": [], "unparseable": []}
    ops: list[UpdateOne] = []
    for n, (uri, group) in enumerate(sorted(groups.items()), 1):
        records = _rebuild(source, uri, group)
        if records is None:
            stats["unparseable"].append(uri)
            continue
        rebuilt = {r["_id"]: r["metadata"]["chunk_index"] for r in records}
        if set(rebuilt) != set(group["ids"]):
            stats["mismatched"].append(
                (uri, len(group["ids"]), len(rebuilt),
                 len(set(rebuilt) & set(group["ids"])))
            )
            continue
        stats["matched"] += 1
        for _id, index in rebuilt.items():
            if group["ids"][_id] == index:
                stats["already"] += 1
                continue
            ops.append(UpdateOne({"_id": _id}, {"$set": {"metadata.chunk_index": index}}))
        if n % 250 == 0:
            print(f"  …{n}/{len(groups)} rebuilt", flush=True)

    stats["updated"] = len(ops)
    if apply and ops:
        coll = db.get_collection()
        for start in range(0, len(ops), 1000):
            coll.bulk_write(ops[start : start + 1000], ordered=False)
    return stats


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--apply", action="store_true",
                        help="Write chunk_index (default: dry run, report only).")
    parser.add_argument("--source", choices=SOURCES, action="append",
                        help="Limit to one source (repeatable). Default: both.")
    args = parser.parse_args()

    t0 = time.time()
    for source in args.source or SOURCES:
        s = backfill(source, apply=args.apply)
        verb = "updated" if args.apply else "would update"
        print(f"{source}: {s['matched']}/{s['documents']} documents matched; "
              f"{verb} {s['updated']} chunks ({s['already']} already correct)")
        for uri, stored, rebuilt, common in s["mismatched"]:
            print(f"  ! changed since ingest, skipped: {uri} "
                  f"(stored {stored}, rebuilt {rebuilt}, {common} in common)")
        for uri in s["unparseable"]:
            print(f"  ! could not parse, skipped: {uri}")
    print(f"done in {time.time() - t0:.0f}s" + ("" if args.apply else " (dry run)"))


if __name__ == "__main__":
    main()
