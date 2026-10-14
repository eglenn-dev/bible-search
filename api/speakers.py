"""Speaker-name normalization, shared by the API's speaker filter and ingest.stats.

``metadata.speaker`` is stored exactly as each source printed it, and the same
person is spelled many ways across five decades: conference bylines carry
titles ("By Elder M. Russell Ballard", "By President …"), older pages use a
non-breaking space after an initial, some years add or drop a middle initial or
a "Jr.", and BYU joint devotionals list several people in one byline
("Jeffrey R. Holland , Patricia T. Holland").

Rather than rewrite the stored documents, the API groups the raw strings at
read time: ``build_speaker_index`` folds every distinct raw value into one
entry per person, and a search's ``speaker`` filter expands back to that
person's raw variants for an ``$in`` pre-filter on ``metadata.speaker``.
"""

from __future__ import annotations

import difflib
import os
import re
import threading
import time
import unicodedata
from collections import defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field

import db

# --- Display normalization (also used by ingest.stats) --------------------

# Conference `metadata.speaker` strings carry byline prefixes ("By President
# Gordon B. Hinckley", "Presented by F. Michael Watson"); strip them so the
# same person groups under one name.
def norm_speaker(s: str | None) -> str:
    s = (s or "Unknown").strip()
    prev = None
    while prev != s:
        prev = s
        s = re.sub(r"^(?:By|Presented by|Sung by|Read by)\s+", "", s, flags=re.IGNORECASE)
        s = re.sub(r"^(?:President|Elder|Bishop|Sister|Brother)\s+", "", s, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", s).strip() or "Unknown"


# --- Matching -------------------------------------------------------------

# BYU joint devotionals separate speakers with a spaced comma ("A , B"); a
# suffix comma ("Hartman Rector, Jr.") has no space before it.
_JOINT_SEP = re.compile(r"\s+,\s+")


def split_speakers(raw: str) -> list[str]:
    """Split a joint byline into the individual names it lists."""
    parts = [p.strip() for p in _JOINT_SEP.split(raw) if p.strip()]
    return parts or [raw]


def speaker_key(name: str | None) -> str:
    """Loose matching key: title-stripped, accent-, case- and punctuation-free.

    "By Elder M.\\u00a0Russell Ballard" and "M. Russell Ballard" both become
    ``"m russell ballard"``. Generational suffixes are kept ("jr"), since a
    father and son can both have spoken (LeGrand R. Curtis / LeGrand R. Curtis
    Jr. are two different Seventies).
    """
    s = unicodedata.normalize("NFKD", norm_speaker(name))
    s = "".join(ch for ch in s if not unicodedata.combining(ch)).casefold()
    s = re.sub(r"[.'’`]", "", s)
    s = re.sub(r"[^\w]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# Same person, spelled differently enough that the automatic rules can't tell
# (nicknames, "Wm.", a dropped "Jr.", a full middle name). Keys are
# `speaker_key` values; map each variant to one canonical key. Extend this
# when GET /speakers shows a split person.
SPEAKER_ALIASES: dict[str, str] = {
    "m russell ballard jr": "m russell ballard",
    "cecil o samuelson jr": "cecil o samuelson",
    "christoffel golden": "christoffel golden jr",
    "rex c reeve sr": "rex c reeve",
    "william grant bangerter": "w grant bangerter",
    "wm grant bangerter": "w grant bangerter",
    "wm rolfe kerr": "w rolfe kerr",
    "brad wilcox": "bradley r wilcox",
    "teddy e brewerton": "ted e brewerton",
    "helio da rocha camargo": "helio r camargo",
    "ardeth greene kapp": "ardeth g kapp",
    "michael john u teh": "michael j teh",
}


def _adds_only_initials(short: list[str], long: list[str]) -> bool:
    """True if ``long`` is ``short`` plus single-letter middle initials.

    "charles didier" → "charles a didier", "larry echo hawk" → "larry j echo
    hawk". First and last tokens must match, so a suffix ("jr") never counts.
    """
    if len(long) <= len(short) or short[0] != long[0] or short[-1] != long[-1]:
        return False
    i = 0
    for tok in long:
        if i < len(short) and tok == short[i]:
            i += 1
        elif len(tok) != 1:
            return False
    return i == len(short)


def _merge_map(keys: Iterable[str]) -> dict[str, str]:
    """Map every key to its canonical key (aliases, then missing initials)."""
    keys = set(keys)
    canon = {k: SPEAKER_ALIASES.get(k, k) for k in keys}
    targets = set(canon.values())
    by_ends: dict[tuple[str, str], list[list[str]]] = defaultdict(list)
    for t in targets:
        toks = t.split()
        if len(toks) >= 2:
            by_ends[(toks[0], toks[-1])].append(toks)
    # A name without a middle initial joins the one spelling that has it —
    # only when exactly one candidate exists, so "John Smith" is never
    # guessed into one of several "John _. Smith"s.
    absorb: dict[str, str] = {}
    for t in targets:
        toks = t.split()
        if len(toks) < 2:
            continue
        cands = [c for c in by_ends[(toks[0], toks[-1])] if _adds_only_initials(toks, c)]
        if len(cands) == 1:
            absorb[t] = " ".join(cands[0])
    return {k: absorb.get(c, c) for k, c in canon.items()}


# --- Index ----------------------------------------------------------------


@dataclass
class Speaker:
    name: str
    talks: int = 0
    sources: set[str] = field(default_factory=set)
    first_year: int | None = None
    last_year: int | None = None
    variants: set[str] = field(default_factory=set)
    keys: set[str] = field(default_factory=set)

    def as_dict(self, include_variants: bool = True) -> dict:
        out = {
            "name": self.name,
            "talks": self.talks,
            "sources": sorted(self.sources),
            "first_year": self.first_year,
            "last_year": self.last_year,
        }
        if include_variants:
            out["variants"] = sorted(self.variants)
        return out


class UnknownSpeakerError(ValueError):
    """No (or no single) speaker matches; ``suggestions`` lists close names."""

    def __init__(self, name: str, suggestions: list[str]):
        self.name = name
        self.suggestions = suggestions
        hint = f" Did you mean: {', '.join(suggestions)}?" if suggestions else ""
        super().__init__(
            f"Unknown or ambiguous speaker: {name!r}.{hint} "
            "See GET /speakers for the full list."
        )


class SpeakerIndex:
    def __init__(self, speakers: list[Speaker]):
        self.speakers = speakers
        self._by_key = {k: s for s in speakers for k in s.keys}

    def resolve(self, name: str) -> Speaker:
        """Find a speaker by any spelling, or a unique partial name.

        Exact matches go through the same key + merge rules as the index, so
        "Elder Charles A. Didier" finds "Charles Didier". Otherwise a name
        whose words all appear in exactly one speaker's name ("Bednar",
        "Russell Nelson") resolves to that speaker.
        """
        key = speaker_key(name)
        if not key or key == "unknown":
            raise UnknownSpeakerError(name, [])
        key = SPEAKER_ALIASES.get(key, key)
        if key in self._by_key:
            return self._by_key[key]
        want = set(key.split())
        partial = [s for s in self.speakers if any(want <= set(k.split()) for k in s.keys)]
        if len(partial) == 1:
            return partial[0]
        if partial:
            suggestions = [s.name for s in partial[:8]]  # already most-talks first
        else:
            close = difflib.get_close_matches(key, list(self._by_key), n=5, cutoff=0.75)
            suggestions = list(dict.fromkeys(self._by_key[k].name for k in close))
        raise UnknownSpeakerError(name, suggestions)


def build_speaker_index(rows: Iterable[dict]) -> SpeakerIndex:
    """Group raw-speaker rows into one ``Speaker`` per person.

    Each row is ``{speaker, source, talks, first, last}`` for one distinct raw
    ``metadata.speaker`` string within one source (see
    ``db.speaker_talk_counts``). A joint byline counts toward each person it
    names, and its raw string is a variant of each, so filtering on any of
    them includes the shared talk.
    """
    rows = [r for r in rows if r.get("speaker")]
    split = [(r, [(n, speaker_key(n)) for n in split_speakers(r["speaker"])]) for r in rows]
    merge = _merge_map(k for _, names in split for _, k in names)

    groups: dict[str, Speaker] = {}
    # Talk count per display spelling, to pick each person's display name.
    spellings: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for r, names in split:
        for name, key in names:
            if not key or key == "unknown":
                continue
            canon = merge[key]
            s = groups.setdefault(canon, Speaker(name=""))
            s.talks += r["talks"]
            s.sources.add(r["source"])
            s.variants.add(r["speaker"])
            s.keys.add(key)
            for attr, pick in (("first_year", min), ("last_year", max)):
                year = r.get("first" if attr == "first_year" else "last")
                if isinstance(year, int):
                    cur = getattr(s, attr)
                    setattr(s, attr, year if cur is None else pick(cur, year))
            spellings[canon][norm_speaker(name)] += r["talks"]

    for canon, s in groups.items():
        s.keys.add(canon)
        # Most-used spelling; ties go to the fuller one ("Charles A. Didier").
        s.name = max(spellings[canon].items(), key=lambda kv: (kv[1], len(kv[0]), kv[0]))[0]

    speakers = sorted(groups.values(), key=lambda s: (-s.talks, s.name))
    return SpeakerIndex(speakers)


# --- In-process cache -----------------------------------------------------

# Speakers only change when new talks are ingested, so the index is built once
# per process (one ~1 s aggregation) and refreshed after this many seconds.
SPEAKERS_CACHE_SECONDS = float(os.getenv("SPEAKERS_CACHE_SECONDS", "") or 6 * 3600)

_lock = threading.Lock()
_cached: tuple[float, SpeakerIndex] | None = None


def get_speaker_index() -> SpeakerIndex:
    """Return the cached ``SpeakerIndex``, building it on first use."""
    global _cached
    now = time.monotonic()
    if _cached and now - _cached[0] < SPEAKERS_CACHE_SECONDS:
        return _cached[1]
    with _lock:
        if _cached and time.monotonic() - _cached[0] < SPEAKERS_CACHE_SECONDS:
            return _cached[1]
        index = build_speaker_index(db.speaker_talk_counts())
        _cached = (time.monotonic(), index)
        return index
