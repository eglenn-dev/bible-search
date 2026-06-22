"""Ingest the KJV Bible (31,102 verses) from api/data/bible_verses.json."""

import json
import os

from ingest.common import chunked, embed_and_upsert, log_storage
from ingest.urls import bible_metadata, bible_url

DATA_PATH = os.path.join(os.path.dirname(__file__), "..", "data", "bible_verses.json")
EXPECTED_VERSES = 31102


def build_records() -> list[dict]:
    with open(DATA_PATH, "r") as f:
        verses = json.load(f)

    records = []
    for verse in verses:
        reference = verse["reference"]
        records.append(
            {
                "_id": f"bible:{reference}",
                "source": "bible",
                "text": verse["text"],
                "reference": reference,
                "title": None,
                "url": bible_url(reference),
                "metadata": bible_metadata(reference),
            }
        )
    return records


def run() -> None:
    records = build_records()
    print(f"Bible: {len(records)} verses (expected {EXPECTED_VERSES}).")
    total = 0
    # Embed in chunks so progress is visible and memory stays bounded.
    for batch in chunked(records, 2000):
        total += embed_and_upsert(batch)
        print(f"  upserted {total}/{len(records)}")
    log_storage("after bible")


if __name__ == "__main__":
    run()
