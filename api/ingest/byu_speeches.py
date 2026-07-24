"""Ingest BYU Speeches devotionals, forums, and addresses (speeches.byu.edu).

The speech URLs come from the site's sitemaps; each page is static HTML whose
transcript lives in ``.single-speech__content``. Some speeches are video/audio
only and carry ``single-speech__unavailable-message`` instead of a transcript —
those are skipped (and counted).
"""

import re

from bs4 import BeautifulSoup

from ingest.byu import DISALLOWED_PATHS, SITE_BASE, SPEECH_SITEMAPS, fetch_html
from ingest.common import already_ingested, embed_and_upsert, log_storage

CHUNK_PARAGRAPHS = 3

_LOC_RE = re.compile(r"<loc>([^<]+)</loc>")
# A transcript URL is exactly /talks/<speaker-slug>/<title-slug>/ (two segments).
_SPEECH_PATH_RE = re.compile(r"^/talks/[^/]+/[^/]+/$")
_YEAR_RE = re.compile(r"\b(19|20)\d{2}\b")
# Video/audio-only speeches show this notice instead of a transcript. It appears
# either as a class on the content div or as a stray <p> alongside a summary line.
_UNAVAILABLE_MARKER = "text for this speech is unavailable"


def _url_path(url: str) -> str:
    """Return the site-relative path (with trailing slash) for a full URL."""
    path = url.removeprefix(SITE_BASE)
    return path.split("?")[0].split("#")[0]


def list_speech_urls(*, use_cache: bool = True) -> list[str]:
    """Return every transcript URL from the speech sitemaps, in order, deduped.

    Pass ``use_cache=False`` to re-fetch the sitemaps (used when checking for newly
    published speeches — the sitemap URLs are stable, so a cached copy would hide
    anything added since the last run).
    """
    urls: list[str] = []
    seen: set[str] = set()
    for sitemap in SPEECH_SITEMAPS:
        xml = fetch_html(sitemap, use_cache=use_cache)
        if not xml:
            continue
        for loc in _LOC_RE.findall(xml):
            url = loc.strip()
            path = _url_path(url)
            if not _SPEECH_PATH_RE.match(path) or path in DISALLOWED_PATHS:
                continue
            if url not in seen:
                seen.add(url)
                urls.append(url)
    return urls


def parse_speech(url: str) -> dict | None:
    """Fetch a speech and extract title, speaker, position, date, paragraphs.

    Returns ``None`` if the page is missing or has no transcript (video-only).
    """
    html = fetch_html(url)
    if not html:
        return None
    soup = BeautifulSoup(html, "html.parser")

    content = soup.select_one(".single-speech__content")
    if not content:
        return None
    classes = content.get("class") or []
    if (
        "single-speech__unavailable-message" in classes
        or _UNAVAILABLE_MARKER in content.get_text(" ", strip=True).lower()
    ):
        return None

    title_el = soup.select_one(".single-speech__title")
    speaker_el = soup.select_one(".single-speech__speaker")
    position_el = soup.select_one(".single-speech__speaker-position")
    date_el = soup.select_one(".single-speech__date")

    title = (
        title_el.get_text(" ", strip=True)
        if title_el
        else _url_path(url).rstrip("/").rsplit("/", 1)[-1]
    )
    speaker = speaker_el.get_text(" ", strip=True) if speaker_el else None
    position = position_el.get_text(" ", strip=True) if position_el else None
    date = date_el.get_text(" ", strip=True) if date_el else None
    year_match = _YEAR_RE.search(date or "")
    year = int(year_match.group(0)) if year_match else None

    paragraphs: list[str] = []
    for p in content.find_all("p"):
        text = p.get_text(" ", strip=True).replace("\xa0", " ")
        # Drop the trailing "© … All rights reserved." boilerplate line.
        if not text or text.startswith("©"):
            continue
        paragraphs.append(text)

    return {
        "title": title,
        "speaker": speaker,
        "position": position,
        "date": date,
        "year": year,
        "paragraphs": paragraphs,
    }


def build_records(url: str, speech: dict) -> list[dict]:
    path = _url_path(url)
    records = []
    paras = speech["paragraphs"]
    for i in range(0, len(paras), CHUNK_PARAGRAPHS):
        group = paras[i : i + CHUNK_PARAGRAPHS]
        text = "\n\n".join(group)
        records.append(
            {
                "_id": f"byu-speeches:{path}:{i}",
                "source": "byu-speeches",
                "text": text,
                "reference": speech["title"],
                "title": speech["title"],
                "url": url,
                "metadata": {
                    "speaker": speech["speaker"],
                    "position": speech["position"],
                    "date": speech["date"],
                    "year": speech["year"],
                    "speech_path": path,
                    "paragraph_index": i,
                },
            }
        )
    return records


def run(force: bool = False) -> None:
    urls = list_speech_urls()
    print(f"BYU Speeches: {len(urls)} speech URLs from sitemaps")
    grand_total = 0
    unavailable = 0
    for n, url in enumerate(urls, 1):
        path = _url_path(url)
        if not force and already_ingested({"metadata.speech_path": path}):
            continue
        speech = parse_speech(url)
        if not speech or not speech["paragraphs"]:
            unavailable += 1
            continue
        records = build_records(url, speech)
        grand_total += embed_and_upsert(records)
        print(f"  + {path} ({len(records)} chunks)")
        if n % 200 == 0:
            log_storage(f"after {n}/{len(urls)} speeches")
    log_storage("after byu-speeches")
    print(
        f"BYU Speeches: ingested {grand_total} chunks total "
        f"({unavailable} speeches skipped — no transcript)."
    )


if __name__ == "__main__":
    run()
