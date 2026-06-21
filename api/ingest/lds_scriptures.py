"""Ingest the other Standard Works (Book of Mormon, Doctrine and Covenants,
Pearl of Great Price) from api/data/new/*.json.

These are verse-level like the Bible, so each verse is one document. Each volume
gets its own ``source`` so it can be filtered independently.
"""

import json
import os

from ingest.common import chunked, embed_and_upsert, log_storage
from ingest.urls import bofm_url, dc_url, pgp_url, parse_reference

DATA_DIR = os.path.join(os.path.dirname(__file__), "..", "data", "new")

VOLUMES = {
    "book-of-mormon": {
        "file": "bom.json",
        "label": "Book of Mormon",
        "url": bofm_url,
        "expected": 6604,
    },
    "doctrine-and-covenants": {
        "file": "dnc.json",
        "label": "Doctrine and Covenants",
        "url": dc_url,
        "expected": 3654,
    },
    "pearl-of-great-price": {
        "file": "pogp.json",
        "label": "Pearl of Great Price",
        "url": pgp_url,
        "expected": 635,
    },
}


def build_records(source: str, cfg: dict) -> list[dict]:
    with open(os.path.join(DATA_DIR, cfg["file"]), "r") as f:
        verses = json.load(f)["verses"]

    url_fn = cfg["url"]
    records = []
    for v in verses:
        reference = v["reference"]
        book, chapter, verse = parse_reference(reference)
        records.append(
            {
                "_id": f"{source}:{reference}",
                "source": source,
                "text": v["text"],
                "reference": reference,
                "title": None,
                "url": url_fn(reference),
                "metadata": {
                    "volume": cfg["label"],
                    "book": book,
                    "chapter": int(chapter) if chapter.isdigit() else chapter,
                    "verse": int(verse) if verse.isdigit() else verse,
                },
            }
        )
    return records


def run() -> None:
    for source, cfg in VOLUMES.items():
        records = build_records(source, cfg)
        empty = sum(1 for r in records if not r["url"])
        print(
            f"{cfg['label']}: {len(records)} verses "
            f"(expected {cfg['expected']}, empty urls: {empty})"
        )
        total = 0
        for batch in chunked(records, 2000):
            total += embed_and_upsert(batch)
            print(f"  {source}: upserted {total}/{len(records)}")
    log_storage("after standard works")


if __name__ == "__main__":
    run()
