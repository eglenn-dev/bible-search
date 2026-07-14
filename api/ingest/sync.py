"""One-command corpus sync — run this whenever you want to refresh the database.

Run from the ``api/`` directory::

    uv run python -m ingest.sync

What it does, per source:

* **Standard Works** (bible + Book of Mormon, D&C, Pearl of Great Price) — the
  static seed corpora. Ingested only when missing, so a *fresh/empty* database is
  fully repopulated but a normal refresh skips them (they never change).
* **General Conference** and **BYU Speeches** — incremental. Discovers newly
  published talks/speeches (re-fetching the listing pages so the on-disk scrape
  cache can't hide new content) and ingests only what isn't already stored.
* **General Handbook** — replaced in full every run (the Church revises it a few
  times a year). Fetched fresh, then the old ``source: "handbook"`` docs are
  deleted and the new ones inserted. The delete only happens *after* a successful
  fetch/parse, so a network hiccup can never leave the handbook wiped.

Finally it ensures the Atlas vector index exists (a dropped collection drops its
index too) and prints a before/after **diff** plus a **summary of work done**.

The whole thing is idempotent: run it on a healthy database and it only pulls in
what's new; run it against an empty one and it rebuilds everything from scratch.
"""

import argparse
import time
from datetime import datetime

import db
from ingest import bible, byu_speeches, conference, handbook, lds_scriptures
from ingest.common import (
    embed_and_upsert,
    embed_texts,
    ensure_vector_index,
    storage_stats,
    upsert_docs,
)

# The verse-level Standard Works and which source name(s) each runner populates.
SCRIPTURE_SOURCES = ["book-of-mormon", "doctrine-and-covenants", "pearl-of-great-price"]
# All sources shown in the diff table, in a stable, readable order.
ALL_SOURCES = ["bible", *SCRIPTURE_SOURCES, "conference", "byu-speeches", "handbook"]

# Refuse to replace the handbook if a fresh fetch yields implausibly few chunks
# (the real handbook is ~2,300) — protects the stored copy from a bad scrape.
MIN_HANDBOOK_CHUNKS = 100
# How many of the most recent conference years to re-fetch listings for (fresh),
# so newly published talks are found. Older years' listings come from the cache.
DEFAULT_FRESH_YEARS = 2


# --------------------------------------------------------------------------- #
# Snapshots + diff reporting
# --------------------------------------------------------------------------- #
def snapshot() -> dict:
    """Per-source document counts, distinct-document counts, and storage usage."""
    collection = db.get_collection()
    by_source = {
        row["_id"]: row["count"]
        for row in collection.aggregate(
            [{"$group": {"_id": "$source", "count": {"$sum": 1}}}]
        )
    }
    # Distinct underlying documents (talks / speeches / chapters), for the summary.
    docs = {
        "conference": len(
            collection.distinct("metadata.talk_uri", {"source": "conference"})
        ),
        "byu-speeches": len(
            collection.distinct("metadata.speech_path", {"source": "byu-speeches"})
        ),
        "handbook": len(
            collection.distinct("metadata.chapter_uri", {"source": "handbook"})
        ),
    }
    return {
        "by_source": by_source,
        "total": sum(by_source.values()),
        "docs": docs,
        "storage": storage_stats(),
    }


def print_diff(before: dict, after: dict) -> None:
    """Print a before/after chunk-count diff table across all sources."""
    print("\n" + "=" * 60)
    print("DATABASE DIFF (chunks)")
    print("=" * 60)
    print(f"{'source':<26}{'before':>9}{'after':>9}{'change':>9}")
    print("-" * 60)
    sources = [s for s in ALL_SOURCES if s in before["by_source"] or s in after["by_source"]]
    # Include any unexpected extra sources (e.g. a renamed corpus) so nothing hides.
    sources += [s for s in after["by_source"] if s not in sources]
    for source in sources:
        b = before["by_source"].get(source, 0)
        a = after["by_source"].get(source, 0)
        print(f"{source:<26}{b:>9}{a:>9}{_signed(a - b):>9}")
    print("-" * 60)
    tb, ta = before["total"], after["total"]
    print(f"{'TOTAL':<26}{tb:>9}{ta:>9}{_signed(ta - tb):>9}")

    db_docs, da_docs = before["docs"], after["docs"]
    print(
        f"\ndocuments: conference {db_docs['conference']} -> {da_docs['conference']} talks, "
        f"byu-speeches {db_docs['byu-speeches']} -> {da_docs['byu-speeches']} speeches, "
        f"handbook {db_docs['handbook']} -> {da_docs['handbook']} chapters"
    )

    sb, sa = before["storage"], after["storage"]
    print(
        f"storage: {sb['storage_mb']}MB -> {sa['storage_mb']}MB  "
        f"(data {sb['data_mb']}MB -> {sa['data_mb']}MB, "
        f"index {sb['index_mb']}MB -> {sa['index_mb']}MB) of the 512MB M0 cap"
    )


def _signed(n: int) -> str:
    return f"+{n}" if n > 0 else str(n)


# --------------------------------------------------------------------------- #
# Phase: Standard Works (repopulate only when missing)
# --------------------------------------------------------------------------- #
def sync_foundational(before: dict, force: bool, results: dict) -> None:
    """Ingest the static Standard Works only if absent (or forced)."""
    by_source = before["by_source"]

    if force or by_source.get("bible", 0) == 0:
        reason = "forced" if force else "missing"
        print(f"\n=== Standard Works: bible ({reason}) — ingesting ===")
        bible.run()
        results["foundational"].append("bible")
    else:
        print(f"\n=== Standard Works: bible present ({by_source['bible']} docs) — skip ===")

    missing_scriptures = [s for s in SCRIPTURE_SOURCES if by_source.get(s, 0) == 0]
    if force or missing_scriptures:
        reason = "forced" if force else f"missing {', '.join(missing_scriptures)}"
        print(f"\n=== Standard Works: scriptures ({reason}) — ingesting ===")
        lds_scriptures.run()
        results["foundational"].extend(SCRIPTURE_SOURCES)
    else:
        print("=== Standard Works: Book of Mormon / D&C / Pearl of Great Price present — skip ===")


# --------------------------------------------------------------------------- #
# Phase: General Conference (incremental)
# --------------------------------------------------------------------------- #
def sync_conference(fresh_years: int, results: dict) -> None:
    """Ingest any conference talks not already stored."""
    collection = db.get_collection()
    existing = set(collection.distinct("metadata.talk_uri", {"source": "conference"}))
    current_year = datetime.now().year
    fresh_from = current_year - max(fresh_years - 1, 0)
    mode = "full ingest" if not existing else "checking for new talks"
    print(
        f"\n=== General Conference ({mode}; {len(existing)} talks stored, "
        f"listings for {fresh_from}-{current_year} fetched fresh) ==="
    )

    new_talks: list[str] = []
    chunks = 0
    for year in range(conference.FIRST_YEAR, current_year + 1):
        for month in conference.MONTHS:
            # Re-fetch recent years' listings so freshly posted talks are seen;
            # older conferences are immutable, so their cached listing is fine.
            use_cache = year < fresh_from
            uris = conference.list_talk_uris(year, month, use_cache=use_cache)
            for uri in uris:
                if uri in existing:
                    continue
                talk = conference.parse_talk(uri)
                if not talk or not talk["paragraphs"]:
                    print(f"  ! no paragraphs parsed for {uri}")
                    continue
                records = conference.build_records(uri, year, month, talk)
                chunks += embed_and_upsert(records)
                label = _talk_label(year, month, talk)
                new_talks.append(label)
                print(f"  + {uri} ({len(records)} chunks) — {label}")

    results["conference"] = {"new": new_talks, "chunks": chunks}
    print(f"Conference: {len(new_talks)} new talk(s), {chunks} chunk(s) ingested.")


def _talk_label(year: int, month: str, talk: dict) -> str:
    who = f" — {talk['speaker']}" if talk.get("speaker") else ""
    return f"{year}/{month} {talk['title']}{who}"


# --------------------------------------------------------------------------- #
# Phase: BYU Speeches (incremental)
# --------------------------------------------------------------------------- #
def sync_byu_speeches(results: dict) -> None:
    """Ingest any BYU speeches not already stored (sitemaps fetched fresh)."""
    collection = db.get_collection()
    existing = set(
        collection.distinct("metadata.speech_path", {"source": "byu-speeches"})
    )
    urls = byu_speeches.list_speech_urls(use_cache=False)
    mode = "full ingest" if not existing else "checking for new speeches"
    print(
        f"\n=== BYU Speeches ({mode}; {len(existing)} stored, "
        f"{len(urls)} in sitemaps) ==="
    )

    new_speeches: list[str] = []
    chunks = 0
    skipped = 0
    for url in urls:
        path = byu_speeches._url_path(url)
        if path in existing:
            continue
        speech = byu_speeches.parse_speech(url)
        if not speech or not speech["paragraphs"]:
            skipped += 1  # video/audio-only: no transcript
            continue
        records = byu_speeches.build_records(url, speech)
        chunks += embed_and_upsert(records)
        label = _speech_label(speech)
        new_speeches.append(label)
        print(f"  + {path} ({len(records)} chunks) — {label}")

    results["byu-speeches"] = {"new": new_speeches, "chunks": chunks, "skipped": skipped}
    print(
        f"BYU Speeches: {len(new_speeches)} new speech(es), {chunks} chunk(s) "
        f"ingested ({skipped} skipped — no transcript)."
    )


def _speech_label(speech: dict) -> str:
    year = f"{speech['year']} " if speech.get("year") else ""
    who = f" — {speech['speaker']}" if speech.get("speaker") else ""
    return f"{year}{speech['title']}{who}"


# --------------------------------------------------------------------------- #
# Phase: General Handbook (full replace)
# --------------------------------------------------------------------------- #
def sync_handbook(results: dict) -> None:
    """Replace the stored handbook with a freshly fetched copy.

    Fetch + parse + embed everything first; only then delete the old docs and
    insert the new ones, so an interrupted or empty scrape never wipes the copy
    already in the database.
    """
    print("\n=== General Handbook (full replace) ===")
    chapter_uris = handbook.list_chapter_uris(use_cache=False)
    print(f"Handbook: {len(chapter_uris)} chapters (fetching fresh)")

    all_records: list[dict] = []
    chapters = 0
    for uri in chapter_uris:
        chapter = handbook.parse_chapter(uri, use_cache=False)
        if not chapter or not chapter["sections"]:
            print(f"  ! no sections parsed for {uri}")
            continue
        chapters += 1
        all_records.extend(handbook.build_records(uri, chapter))

    if len(all_records) < MIN_HANDBOOK_CHUNKS:
        reason = (
            f"fresh fetch produced only {len(all_records)} chunks "
            f"(< {MIN_HANDBOOK_CHUNKS}); keeping the existing handbook"
        )
        print(f"  ! {reason} — NOT replacing")
        results["handbook"] = {"replaced": False, "skipped_reason": reason}
        return

    # Embed before touching the database so a failure here leaves the old copy intact.
    embeddings = embed_texts([r["text"] for r in all_records])
    for record, embedding in zip(all_records, embeddings):
        record["embedding"] = embedding

    collection = db.get_collection()
    deleted = collection.delete_many({"source": "handbook"}).deleted_count
    upsert_docs(all_records)
    results["handbook"] = {
        "replaced": True,
        "deleted": deleted,
        "chunks": len(all_records),
        "chapters": chapters,
    }
    print(
        f"Handbook: replaced — deleted {deleted} old chunk(s), "
        f"inserted {len(all_records)} chunk(s) across {chapters} chapter(s)."
    )


# --------------------------------------------------------------------------- #
# Summary of work done
# --------------------------------------------------------------------------- #
def _print_list(items: list[str], cap: int = 40) -> None:
    for item in items[:cap]:
        print(f"    - {item}")
    if len(items) > cap:
        print(f"    ... and {len(items) - cap} more")


def print_summary(results: dict, elapsed: float) -> None:
    print("\n" + "=" * 60)
    print("SUMMARY OF WORK DONE")
    print("=" * 60)

    # Standard Works
    found = results["foundational"]
    if found:
        print(f"Standard Works: ingested/repopulated {', '.join(found)}")
    else:
        print("Standard Works: already present — nothing to do")

    # Conference
    conf = results.get("conference")
    if conf is None:
        print("General Conference: skipped (error — see above)")
    elif conf["new"]:
        print(
            f"General Conference: +{len(conf['new'])} new talk(s), "
            f"{conf['chunks']} chunk(s)"
        )
        _print_list(conf["new"])
    else:
        print("General Conference: up to date — no new talks")

    # BYU Speeches
    byu = results.get("byu-speeches")
    if byu is None:
        print("BYU Speeches: skipped (error — see above)")
    elif byu["new"]:
        print(
            f"BYU Speeches: +{len(byu['new'])} new speech(es), {byu['chunks']} chunk(s)"
        )
        _print_list(byu["new"])
    else:
        print("BYU Speeches: up to date — no new speeches")

    # Handbook
    hb = results.get("handbook")
    if hb is None:
        print("General Handbook: skipped (error — see above)")
    elif hb.get("replaced"):
        print(
            f"General Handbook: replaced — {hb['deleted']} old chunk(s) removed, "
            f"{hb['chunks']} new chunk(s) across {hb['chapters']} chapter(s)"
        )
    else:
        print(f"General Handbook: NOT replaced — {hb.get('skipped_reason')}")

    # Index
    if results.get("index"):
        print(f"Vector index: {results['index']}")

    # Errors
    if results["errors"]:
        print("\nErrors (phases that did not complete):")
        for phase, message in results["errors"]:
            print(f"    ! {phase}: {message}")

    print(f"\nElapsed: {elapsed:.0f}s")
    print("=" * 60)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #
def _run_phase(name: str, fn, results: dict) -> None:
    """Run one phase, capturing any failure so later phases + the summary still run."""
    try:
        fn()
    except Exception as exc:  # keep going: one flaky source shouldn't lose the rest
        print(f"  !! {name} failed: {exc}")
        results["errors"].append((name, str(exc)))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Sync all corpora: repopulate Standard Works if missing, add new "
        "Conference/BYU talks, replace the Handbook, then diff + summarize."
    )
    parser.add_argument(
        "--force-foundational",
        action="store_true",
        help="Re-ingest the Standard Works even if already present.",
    )
    parser.add_argument(
        "--fresh-years",
        type=int,
        default=DEFAULT_FRESH_YEARS,
        help="How many recent conference years to re-check for new talks "
        f"(default {DEFAULT_FRESH_YEARS}).",
    )
    parser.add_argument(
        "--skip-conference", action="store_true", help="Skip the Conference phase."
    )
    parser.add_argument(
        "--skip-byu", action="store_true", help="Skip the BYU Speeches phase."
    )
    parser.add_argument(
        "--skip-handbook", action="store_true", help="Skip the Handbook phase."
    )
    args = parser.parse_args()

    start = time.perf_counter()
    results: dict = {"foundational": [], "errors": [], "index": None}

    print("Connecting to the database and taking a baseline snapshot...")
    before = snapshot()
    print(
        f"Baseline: {before['total']} docs, "
        f"{before['storage']['storage_mb']}MB stored."
    )

    _run_phase(
        "Standard Works",
        lambda: sync_foundational(before, args.force_foundational, results),
        results,
    )
    if not args.skip_conference:
        _run_phase(
            "General Conference",
            lambda: sync_conference(args.fresh_years, results),
            results,
        )
    if not args.skip_byu:
        _run_phase("BYU Speeches", lambda: sync_byu_speeches(results), results)
    if not args.skip_handbook:
        _run_phase("General Handbook", lambda: sync_handbook(results), results)

    print("\n=== Ensuring vector index ===")

    def _index() -> None:
        existing = {ix["name"] for ix in db.get_collection().list_search_indexes()}
        ensure_vector_index()
        results["index"] = (
            "already exists" if db.VECTOR_INDEX_NAME in existing else "created (building)"
        )

    _run_phase("Vector index", _index, results)

    after = snapshot()
    print_diff(before, after)
    print_summary(results, time.perf_counter() - start)


if __name__ == "__main__":
    main()
