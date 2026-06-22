"""Ingestion orchestrator.

Examples (run from the api/ directory):

    python -m ingest.run --source bible
    python -m ingest.run --source scriptures   # Book of Mormon, D&C, Pearl of Great Price
    python -m ingest.run --source conference
    python -m ingest.run --source handbook
    python -m ingest.run --source all
    python -m ingest.run --create-index      # (re)create the vector index
    python -m ingest.run --stats             # print storage usage
"""

import argparse

from ingest import bible, conference, handbook, lds_scriptures
from ingest.common import ensure_vector_index, log_storage

# Priority order: always-useful Bible + other Standard Works first, then the
# large Conference scrape, then the Handbook. Watch storage vs the M0 512MB cap.
ORDER = ["bible", "scriptures", "conference", "handbook"]
RUNNERS = {
    "bible": bible.run,
    "scriptures": lds_scriptures.run,
    "conference": conference.run,
    "handbook": handbook.run,
}
# Sources whose run() takes no --force argument.
_NO_FORCE = {"bible", "scriptures"}


def main() -> None:
    parser = argparse.ArgumentParser(description="Gospel Library ingestion")
    parser.add_argument(
        "--source", choices=ORDER + ["all"], help="Which corpus to ingest."
    )
    parser.add_argument(
        "--create-index", action="store_true", help="Create the Atlas vector index."
    )
    parser.add_argument(
        "--stats", action="store_true", help="Print database storage usage and exit."
    )
    parser.add_argument(
        "--force", action="store_true", help="Re-ingest even if already present."
    )
    args = parser.parse_args()

    if args.stats:
        log_storage()
        return

    if args.source:
        sources = ORDER if args.source == "all" else [args.source]
        for source in sources:
            print(f"\n=== Ingesting: {source} ===")
            runner = RUNNERS[source]
            if source in _NO_FORCE:
                runner()
            else:
                runner(force=args.force)

    if args.create_index or args.source:
        print("\n=== Ensuring vector index ===")
        ensure_vector_index()

    log_storage("final")


if __name__ == "__main__":
    main()
