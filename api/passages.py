"""Reading context: a passage plus its neighbours, in reading order.

Every document's ``_id`` is deterministic and says where the passage sits, so
neighbours are found through the built-in ``_id`` index alone — no extra indexes:

- **Scripture** (``<source>:<book> <chapter>:<verse>``): the adjacent verses'
  ids are computed directly and fetched with one ``$in``.
- **Chunked sources** (conference / BYU Speeches / handbook): every chunk of one
  talk/speech/chapter shares an ``_id`` prefix, so an anchored prefix regex
  (``^conference:<talk_uri>:``) is an index range scan over just that document.

What decides the order of chunks within a document:

- ``metadata.chunk_index`` when the passage has one (written by the conference
  and handbook ingesters from now on; older chunks predate it). Neighbours are
  then one range query on the prefix plus ``chunk_index``.
- **BYU Speeches:** the paragraph offset in the ``_id`` (``…:<paragraph_index>``).
- **Conference, legacy ids** (``p12``): the paragraph number.
- **Conference, new ids** (``p_aB3dE``, late 2024 on): the suffix is random and
  nothing else stored records the order (insertion order was checked and is not
  reliable), so only the passage itself is returned until the talk is
  re-ingested with ``chunk_index``.
- **Handbook** (``…:<anchor>:<offset>``): only the order *within* a section is
  recorded, so context is the rest of that section until the next handbook
  sync writes ``chunk_index`` for whole chapters.
"""

import re
from typing import Any

import db

# Upper bound on neighbours per side, so one request can't pull a whole chapter.
MAX_NEIGHBORS = 10

# Everything but the vector, which is large and useless to a reader.
_PROJECTION = {"embedding": 0}

_SCRIPTURE_SOURCES = {
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
}
_LEGACY_PARA_RE = re.compile(r"^p(\d+)$")

NOTE_UNORDERED_TALK = (
    "The paragraph order of this talk isn't recorded yet, so only the matched "
    "passage is returned."
)
NOTE_HANDBOOK_SECTION = "Context is limited to this handbook section."


def _prefix_filter(prefix: str) -> dict[str, Any]:
    """An anchored, escaped prefix regex — Mongo turns it into an ``_id`` index range."""
    return {"_id": {"$regex": "^" + re.escape(prefix)}}


def _suffix(doc_id: str) -> str:
    """The last ``:``-separated part of an ``_id`` (paragraph id / offset / verse)."""
    return doc_id.rpartition(":")[2]


def _fetch_in_order(ids: list[str]) -> list[dict[str, Any]]:
    """Fetch documents by ``_id`` and return them in the order of ``ids``."""
    found = {
        d["_id"]: d
        for d in db.get_collection().find({"_id": {"$in": ids}}, _PROJECTION)
    }
    return [found[i] for i in ids if i in found]


def _window(
    ordered_ids: list[str], target_id: str, before: int, after: int
) -> tuple[list[str], bool, bool]:
    """Slice ``before``/``after`` ids around the target; also report what's beyond."""
    i = ordered_ids.index(target_id)
    start, end = max(0, i - before), min(len(ordered_ids), i + after + 1)
    return ordered_ids[start:end], start > 0, end < len(ordered_ids)


def _scripture_context(
    doc: dict[str, Any], before: int, after: int
) -> tuple[list[dict[str, Any]], bool, bool]:
    # "bible:Genesis 1:3" -> prefix "bible:Genesis 1", verse "3". Verses never
    # cross a chapter, so missing ids simply mark the chapter's edges.
    prefix, _, verse = doc["_id"].rpartition(":")
    if not verse.isdigit():
        return [doc], False, False
    v = int(verse)
    # One extra verse each side tells us whether the chapter continues.
    lo, hi = max(1, v - before - 1), v + after + 1
    docs = _fetch_in_order([f"{prefix}:{n}" for n in range(lo, hi + 1)])
    by_verse = {int(d["_id"].rpartition(":")[2]): d for d in docs}
    window = [by_verse[n] for n in range(v - before, v + after + 1) if n in by_verse]
    return window, (v - before - 1) in by_verse, (v + after + 1) in by_verse


def _group_prefix(doc_id: str, source: str) -> str:
    """The ``_id`` prefix shared by every chunk of one talk/speech/chapter."""
    if source == "handbook":
        # handbook:<chapter_uri>:<anchor>:<offset>
        return doc_id.rsplit(":", 2)[0] + ":"
    # conference:<talk_uri>:<paragraph_id> / byu-speeches:<path>:<index>
    return doc_id.rpartition(":")[0] + ":"


def _indexed_chunk_context(
    doc: dict[str, Any], chunk_index: int, before: int, after: int
) -> tuple[list[dict[str, Any]], bool, bool]:
    """Neighbours by ``metadata.chunk_index``: one ``_id``-prefix range query."""
    lo, hi = chunk_index - before - 1, chunk_index + after + 1
    query = {
        **_prefix_filter(_group_prefix(doc["_id"], doc["source"])),
        "metadata.chunk_index": {"$gte": lo, "$lte": hi},
    }
    by_index = {
        d["metadata"]["chunk_index"]: d
        for d in db.get_collection().find(query, _PROJECTION)
    }
    window = [
        by_index[n]
        for n in range(chunk_index - before, chunk_index + after + 1)
        if n in by_index
    ]
    return window, lo in by_index, hi in by_index


def _ordered_chunk_ids(doc: dict[str, Any]) -> tuple[list[str], str | None]:
    """All chunk ids of ``doc``'s talk/speech/chapter in reading order, plus a note.

    Uses only what the ids themselves record, so the scan is covered by the
    ``_id`` index (no documents are read). Returns ``([doc_id], note)`` when the
    ids carry no reliable order.
    """
    source, doc_id = doc["source"], doc["_id"]
    ids = [
        d["_id"]
        for d in db.get_collection().find(
            _prefix_filter(_group_prefix(doc_id, source)), {"_id": 1}
        )
    ]

    if source == "byu-speeches":
        if all(_suffix(i).isdigit() for i in ids):
            return sorted(ids, key=lambda i: int(_suffix(i))), None
        return [doc_id], None

    if source == "conference":
        nums = [_LEGACY_PARA_RE.match(_suffix(i)) for i in ids]
        if all(nums):
            return [i for _, i in sorted(zip((int(m[1]) for m in nums), ids))], None
        return [doc_id], NOTE_UNORDERED_TALK

    if source == "handbook":
        section_prefix = doc_id.rpartition(":")[0] + ":"
        section = [
            i for i in ids if i.startswith(section_prefix) and _suffix(i).isdigit()
        ]
        if doc_id not in section:
            return [doc_id], NOTE_HANDBOOK_SECTION
        return sorted(section, key=lambda i: int(_suffix(i))), NOTE_HANDBOOK_SECTION

    return [doc_id], None


def passage_context(
    doc: dict[str, Any], before: int, after: int
) -> dict[str, Any]:
    """Return ``doc`` with up to ``before``/``after`` neighbours in reading order.

    Shape: ``{id, passages, more_before, more_after, note}``; each passage
    carries ``is_target``.
    """
    before = max(0, min(before, MAX_NEIGHBORS))
    after = max(0, min(after, MAX_NEIGHBORS))
    note = None
    chunk_index = (doc.get("metadata") or {}).get("chunk_index")

    if doc["source"] in _SCRIPTURE_SOURCES:
        passages, more_before, more_after = _scripture_context(doc, before, after)
    elif isinstance(chunk_index, int):
        passages, more_before, more_after = _indexed_chunk_context(
            doc, chunk_index, before, after
        )
    else:
        ordered, note = _ordered_chunk_ids(doc)
        if doc["_id"] not in ordered:
            ordered = [doc["_id"]]
        ids, more_before, more_after = _window(ordered, doc["_id"], before, after)
        passages = _fetch_in_order(ids)

    if not any(p["_id"] == doc["_id"] for p in passages):
        passages = [doc]
    return {
        "id": doc["_id"],
        "passages": [{**p, "is_target": p["_id"] == doc["_id"]} for p in passages],
        "more_before": more_before,
        "more_after": more_after,
        "note": note,
    }
