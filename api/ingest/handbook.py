"""Ingest the General Handbook, chunked by numbered section."""

import re

from bs4 import BeautifulSoup

from ingest.church import content_body, fetch_content, study_url
from ingest.common import already_ingested, embed_and_upsert, log_storage

HANDBOOK_ROOT = "/manual/general-handbook"
SECTION_CHUNK_PARAGRAPHS = 5

_CHAPTER_HREF_RE = re.compile(r"^/study/manual/general-handbook/([a-z0-9\-]+)$")
_SECTION_NUMBER_RE = re.compile(r"\b(\d+(?:\.\d+)+)\b")


def list_chapter_uris() -> list[str]:
    data = fetch_content(HANDBOOK_ROOT)
    if not data:
        return []
    soup = BeautifulSoup(content_body(data), "html.parser")
    uris, seen = [], set()
    for a in soup.select("a[href]"):
        href = a["href"].split("?")[0].split("#")[0]
        m = _CHAPTER_HREF_RE.match(href)
        if not m:
            continue
        uri = f"/manual/general-handbook/{m.group(1)}"
        if uri not in seen:
            seen.add(uri)
            uris.append(uri)
    return uris


def parse_chapter(uri: str) -> dict | None:
    data = fetch_content(uri)
    if not data:
        return None
    soup = BeautifulSoup(content_body(data), "html.parser")

    h1 = soup.select_one("h1")
    chapter_title = h1.get_text(" ", strip=True) if h1 else uri.rsplit("/", 1)[-1]

    # Walk the body in order, splitting on section headings that carry an id.
    sections: list[dict] = []
    current = {
        "anchor": "",
        "title": chapter_title,
        "number": None,
        "paragraphs": [],
    }
    for el in soup.find_all(["h2", "h3", "p"]):
        if el.name in ("h2", "h3"):
            anchor = el.get("id", "")
            if not anchor:
                continue
            if current["paragraphs"]:
                sections.append(current)
            heading_text = el.get_text(" ", strip=True)
            num_match = _SECTION_NUMBER_RE.search(heading_text)
            current = {
                "anchor": anchor,
                "title": heading_text,
                "number": num_match.group(1) if num_match else None,
                "paragraphs": [],
            }
        else:  # paragraph
            text = el.get_text(" ", strip=True)
            if text:
                current["paragraphs"].append(text)
    if current["paragraphs"]:
        sections.append(current)

    return {"chapter_title": chapter_title, "sections": sections}


def build_records(uri: str, chapter: dict) -> list[dict]:
    records = []
    for section in chapter["sections"]:
        paras = section["paragraphs"]
        anchor = section["anchor"] or "p1"
        for i in range(0, len(paras), SECTION_CHUNK_PARAGRAPHS):
            group = paras[i : i + SECTION_CHUNK_PARAGRAPHS]
            text = "\n\n".join(group)
            ref = section["number"] or section["title"]
            records.append(
                {
                    "_id": f"handbook:{uri}:{anchor}:{i}",
                    "source": "handbook",
                    "text": text,
                    "reference": ref,
                    "title": section["title"],
                    "url": study_url(uri, anchor=anchor),
                    "metadata": {
                        "chapter": chapter["chapter_title"],
                        "section_number": section["number"],
                        "section_title": section["title"],
                        "anchor": anchor,
                        "chapter_uri": uri,
                    },
                }
            )
    return records


def run(force: bool = False) -> None:
    chapter_uris = list_chapter_uris()
    print(f"Handbook: {len(chapter_uris)} chapters")
    grand_total = 0
    for uri in chapter_uris:
        if not force and already_ingested({"metadata.chapter_uri": uri}):
            continue
        chapter = parse_chapter(uri)
        if not chapter or not chapter["sections"]:
            print(f"  ! no sections parsed for {uri}")
            continue
        records = build_records(uri, chapter)
        grand_total += embed_and_upsert(records)
        print(f"  + {uri} ({len(records)} chunks)")
    log_storage("after handbook")
    print(f"Handbook: ingested {grand_total} chunks total.")


if __name__ == "__main__":
    run()
