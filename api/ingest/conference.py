"""Ingest General Conference addresses (1971–present) from the content API."""

import re
from datetime import UTC, datetime

from bs4 import BeautifulSoup

from ingest.church import content_body, fetch_content, study_url
from ingest.common import already_ingested, embed_and_upsert, log_storage

FIRST_YEAR = 1971
MONTHS = ["04", "10"]  # April and October conferences
CHUNK_PARAGRAPHS = 3

# Body paragraphs carry an id of either the legacy ``p12`` form or the newer
# random-suffix ``p_aB3dE`` form the site switched to in late 2024.
_PARA_ID_RE = re.compile(r"^p(?:\d+|_[A-Za-z0-9]+)$")
_SKIP_PARA_CLASSES = {
    "author-name",
    "author-role",
    "kicker",
    "study-summary",
    "title-number",
    "title",
}


def _is_session_link(slug: str) -> bool:
    """Session/meeting landing pages are not talks (e.g. 'saturday-morning-session')."""
    return (
        not slug
        or slug == "media"
        or slug.endswith(("session", "meeting"))
    )


def list_talk_uris(year: int, month: str, *, use_cache: bool = True) -> list[str]:
    """Return the ordered list of talk uris for a conference session.

    Pass ``use_cache=False`` to re-fetch the session listing (used when checking a
    recent conference for newly published talks, so the disk cache can't hide them).
    """
    session_uri = f"/general-conference/{year}/{month}"
    data = fetch_content(session_uri, use_cache=use_cache)
    if not data:
        return []

    soup = BeautifulSoup(content_body(data), "html.parser")
    prefix = f"/study/general-conference/{year}/{month}/"
    uris: list[str] = []
    seen = set()
    for a in soup.select("a[href]"):
        href = a["href"].split("?")[0].split("#")[0]
        if not href.startswith(prefix):
            continue
        slug = href[len(prefix):]
        # A talk slug is a single path segment and not a session/meeting header.
        if "/" in slug or _is_session_link(slug):
            continue
        uri = f"/general-conference/{year}/{month}/{slug}"
        if uri not in seen:
            seen.add(uri)
            uris.append(uri)
    return uris


def parse_talk(uri: str) -> dict | None:
    """Fetch a talk and extract title, speaker, calling, and paragraphs."""
    data = fetch_content(uri)
    if not data:
        return None
    soup = BeautifulSoup(content_body(data), "html.parser")

    h1 = soup.select_one("h1")
    title = h1.get_text(" ", strip=True) if h1 else uri.rsplit("/", 1)[-1]

    name_el = soup.select_one("p.author-name, .author-name")
    role_el = soup.select_one("p.author-role, .author-role")
    speaker = name_el.get_text(" ", strip=True) if name_el else None
    calling = role_el.get_text(" ", strip=True) if role_el else None

    paragraphs: list[tuple[str, str]] = []
    for p in soup.find_all("p"):
        pid = p.get("id", "")
        if not _PARA_ID_RE.match(pid):
            continue
        classes = set(p.get("class") or [])
        if classes & _SKIP_PARA_CLASSES:
            continue
        # In the new format, footnotes live in <footer class="notes"> and share
        # the ``p_…`` id form; skip them so only the sermon body is ingested.
        if p.find_parent("footer"):
            continue
        text = p.get_text(" ", strip=True)
        if text:
            paragraphs.append((pid, text))

    return {
        "title": title,
        "speaker": speaker,
        "calling": calling,
        "paragraphs": paragraphs,
    }


def build_records(uri: str, year: int, month: str, talk: dict) -> list[dict]:
    records = []
    paras = talk["paragraphs"]
    for i in range(0, len(paras), CHUNK_PARAGRAPHS):
        group = paras[i : i + CHUNK_PARAGRAPHS]
        first_pid = group[0][0]
        text = "\n\n".join(t for _, t in group)
        records.append(
            {
                "_id": f"conference:{uri}:{first_pid}",
                "source": "conference",
                "text": text,
                "reference": talk["title"],
                "title": talk["title"],
                "url": study_url(uri, anchor=first_pid),
                "metadata": {
                    "speaker": talk["speaker"],
                    "calling": talk["calling"],
                    "year": year,
                    "month": month,
                    "talk_uri": uri,
                    "paragraph_id": first_pid,
                },
            }
        )
    return records


def run(force: bool = False) -> None:
    current_year = datetime.now(UTC).year
    grand_total = 0
    for year in range(FIRST_YEAR, current_year + 1):
        for month in MONTHS:
            uris = list_talk_uris(year, month)
            if not uris:
                continue
            print(f"{year}/{month}: {len(uris)} talks")
            for uri in uris:
                if not force and already_ingested({"metadata.talk_uri": uri}):
                    continue
                talk = parse_talk(uri)
                if not talk or not talk["paragraphs"]:
                    print(f"  ! no paragraphs parsed for {uri}")
                    continue
                records = build_records(uri, year, month, talk)
                grand_total += embed_and_upsert(records)
                print(f"  + {uri} ({len(records)} chunks)")
        log_storage(f"after {year}")
    print(f"Conference: ingested {grand_total} chunks total.")


if __name__ == "__main__":
    run()
