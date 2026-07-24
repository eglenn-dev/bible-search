"""Precompute the /stats page payload and store it in MongoDB.

Computes corpus-wide analytics (speaker stats, word trends, scripture-citation
counts, trivia, and embedding-based stats like talk twins and k-means clusters)
and upserts a single document into the ``stats`` collection:

    { "_id": "site_stats", "generated_at": <ISO-8601 UTC>, "data": { ... } }

The API serves it verbatim from ``GET /stats``. Run after a content refresh:

    uv run python -m ingest.stats

Unlike the API (which never loads the dataset), this command pulls every
document *and* its embedding into memory — it is an offline job on par with
ingestion, not something the server does.
"""

from __future__ import annotations

import math
import re
import sys
import time
from collections import Counter, defaultdict
from datetime import UTC, datetime

import numpy as np

import db

# --- Speaker normalization & procedural-talk filter -----------------------

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


# Sustainings, audit/statistical reports, and solemn assemblies are part of the
# conference record but aren't sermons; left in, they dominate every outlier-,
# twin-, and length-based stat.
_PROC_RE = re.compile(
    r"sustaining|church officers|audit|statistical report|solemn assembly"
    r"|general authorities|church finance|financial report",
    re.IGNORECASE,
)


def is_procedural(title: str | None) -> bool:
    return bool(_PROC_RE.search(title or ""))


# --- Scripture-citation matching ------------------------------------------
# Talks cite both full names ("Alma 32:21") and standard LDS abbreviations
# ("1 Ne. 3:7", "Matt. 5:48"), usually with a non-breaking space between the
# leading numeral and the book name.

BOM_BOOKS = ["1 Nephi", "2 Nephi", "Jacob", "Enos", "Jarom", "Omni", "Words of Mormon",
             "Mosiah", "Alma", "Helaman", "3 Nephi", "4 Nephi", "Mormon", "Ether", "Moroni"]
OT = ["Genesis", "Exodus", "Leviticus", "Numbers", "Deuteronomy", "Joshua", "Judges", "Ruth",
      "1 Samuel", "2 Samuel", "1 Kings", "2 Kings", "1 Chronicles", "2 Chronicles", "Ezra",
      "Nehemiah", "Esther", "Job", "Psalm", "Psalms", "Proverbs", "Ecclesiastes",
      "Song of Solomon", "Isaiah", "Jeremiah", "Lamentations", "Ezekiel", "Daniel", "Hosea",
      "Joel", "Amos", "Obadiah", "Jonah", "Micah", "Nahum", "Habakkuk", "Zephaniah",
      "Haggai", "Zechariah", "Malachi"]
NT = ["Matthew", "Mark", "Luke", "John", "Acts", "Romans", "1 Corinthians", "2 Corinthians",
      "Galatians", "Ephesians", "Philippians", "Colossians", "1 Thessalonians",
      "2 Thessalonians", "1 Timothy", "2 Timothy", "Titus", "Philemon", "Hebrews", "James",
      "1 Peter", "2 Peter", "1 John", "2 John", "3 John", "Jude", "Revelation"]
PGP = ["Moses", "Abraham", "Joseph Smith—History", "Joseph Smith—Matthew", "Articles of Faith"]
DC = ["D&C", "Doctrine and Covenants"]

ABBREV = {
    "1 Ne.": "1 Nephi", "2 Ne.": "2 Nephi", "Hel.": "Helaman", "3 Ne.": "3 Nephi",
    "4 Ne.": "4 Nephi", "W of M": "Words of Mormon", "Morm.": "Mormon", "Moro.": "Moroni",
    "Gen.": "Genesis", "Ex.": "Exodus", "Lev.": "Leviticus", "Num.": "Numbers",
    "Deut.": "Deuteronomy", "Josh.": "Joshua", "Judg.": "Judges", "1 Sam.": "1 Samuel",
    "2 Sam.": "2 Samuel", "1 Kgs.": "1 Kings", "2 Kgs.": "2 Kings", "1 Chr.": "1 Chronicles",
    "2 Chr.": "2 Chronicles", "Neh.": "Nehemiah", "Esth.": "Esther", "Ps.": "Psalm",
    "Pss.": "Psalm", "Prov.": "Proverbs", "Eccl.": "Ecclesiastes", "Song.": "Song of Solomon",
    "Isa.": "Isaiah", "Jer.": "Jeremiah", "Lam.": "Lamentations", "Ezek.": "Ezekiel",
    "Dan.": "Daniel", "Obad.": "Obadiah", "Hab.": "Habakkuk", "Zeph.": "Zephaniah",
    "Hag.": "Haggai", "Zech.": "Zechariah", "Mal.": "Malachi", "Matt.": "Matthew",
    "Rom.": "Romans", "1 Cor.": "1 Corinthians", "2 Cor.": "2 Corinthians",
    "Gal.": "Galatians", "Eph.": "Ephesians", "Philip.": "Philippians", "Phil.": "Philippians",
    "Col.": "Colossians", "1 Thes.": "1 Thessalonians", "2 Thes.": "2 Thessalonians",
    "1 Thess.": "1 Thessalonians", "2 Thess.": "2 Thessalonians", "1 Tim.": "1 Timothy",
    "2 Tim.": "2 Timothy", "Philem.": "Philemon", "Heb.": "Hebrews", "1 Pet.": "1 Peter",
    "2 Pet.": "2 Peter", "1 Jn.": "1 John", "2 Jn.": "2 John", "3 Jn.": "3 John",
    "Rev.": "Revelation", "Abr.": "Abraham", "JS—H": "Joseph Smith—History",
    "JS—M": "Joseph Smith—Matthew", "JS-H": "Joseph Smith—History",
    "JS-M": "Joseph Smith—Matthew", "A of F": "Articles of Faith",
}
CANON = {"Psalms": "Psalm", "Doctrine and Covenants": "D&C"}

BOOK_VOLUME: dict[str, str] = {}
for _b in BOM_BOOKS:
    BOOK_VOLUME[_b] = "Book of Mormon"
for _b in OT:
    BOOK_VOLUME[_b] = "Old Testament"
for _b in NT:
    BOOK_VOLUME[_b] = "New Testament"
for _b in PGP:
    BOOK_VOLUME[_b] = "Pearl of Great Price"
for _b in DC:
    BOOK_VOLUME[_b] = "Doctrine and Covenants"

_alts = sorted((re.escape(b) for b in set(BOM_BOOKS + OT + NT + PGP + DC + list(ABBREV))),
               key=len, reverse=True)
CITE_RE = re.compile(r"(?<![A-Za-z])(" + "|".join(_alts) + r")\s+(\d{1,3}):(\d{1,3})")


def find_citations(text: str):
    """Yield (book, chapter, verse) canonical citations found in text."""
    text = text.replace(" ", " ").replace("‑", "-")
    for m in CITE_RE.finditer(text):
        book = ABBREV.get(m.group(1), m.group(1))
        yield CANON.get(book, book), m.group(2), m.group(3)


# --- Extraction -----------------------------------------------------------

SCRIPTURE_SOURCES = ["bible", "book-of-mormon", "doctrine-and-covenants", "pearl-of-great-price"]


def _fetch(source: str, with_embeddings: bool) -> tuple[list[dict], np.ndarray | None]:
    """Pull one corpus into memory; optionally decode binData embeddings."""
    col = db.get_collection()
    docs, embs = [], []
    for d in col.find({"source": source}, batch_size=500):
        emb = d.pop("embedding", None)
        if with_embeddings and emb is not None:
            embs.append(np.array(emb.as_vector().data, dtype=np.float32))
        docs.append(d)
    arr = None
    if embs:
        arr = np.vstack(embs)
        arr /= np.linalg.norm(arr, axis=1, keepdims=True)
    return docs, arr


_wc = lambda t: len(t.split())

STOP = {"the", "of", "and", "to", "a", "in", "that", "is", "was", "he", "for", "it", "with", "as", "his", "on", "be", "at", "by", "i", "had", "not", "are", "but", "from", "or", "have", "an", "they", "which", "one", "you", "were", "her", "all", "she", "there", "would", "their", "we", "him", "been", "has", "when", "who", "will", "more", "no", "if", "out", "so", "said", "what", "up", "its", "about", "into", "than", "them", "can", "only", "other", "new", "some", "could", "time", "these", "two", "may", "then", "do", "first", "any", "my", "now", "such", "like", "our", "over", "man", "me", "even", "most", "made", "after", "also", "did", "many", "before", "must", "through", "back", "years", "where", "much", "your", "way", "well", "down", "should", "because", "each", "just", "those", "people", "how", "too", "little", "good", "very", "make", "world", "still", "own", "see", "men", "work", "long", "get", "here", "between", "both", "life", "being", "under", "never", "day", "same", "another", "know", "while", "last", "might", "us", "great", "old", "year", "off", "come", "since", "against", "go", "came", "right", "used", "take", "three", "himself", "few", "house", "use", "during", "without", "again", "place", "around", "home", "small", "found", "thought", "went", "say", "part", "once", "every", "don't", "does", "got", "left", "number", "course", "until", "always", "away", "something", "fact", "though", "think", "almost", "hand", "enough", "far", "took", "head", "yet", "nothing", "night", "end", "why", "called", "eyes", "find", "going", "look", "asked", "later", "knew", "thy", "thou", "thee", "shall", "unto", "ye", "hath", "yea", "behold", "verily", "saith"}

WORD_TREND_TERMS = {
    "covenant path": r"covenant path", "ministering": r"minister(?:ing|ed)\b",
    "home teaching": r"home teach", "internet": r"internet", "social media": r"social media",
    "pornography": r"pornograph", "technology": r"technolog", "mormon (as name/label)": r"mormons?\b",
    "temple": r"temples?\b", "pioneer": r"pioneers?\b", "atonement": r"atonement",
    "grace": r"\bgrace\b", "agency": r"\bagency\b",
    "plan of salvation": r"plan of (?:salvation|happiness)",
    "gathering of israel": r"gather(?:ing)? (?:of )?israel", "missionary": r"missionar",
    "repentance": r"repent", "revelation": r"revelation", "priesthood": r"priesthood",
    "family": r"famil(?:y|ies)", "welfare": r"welfare", "communism": r"communis",
    "war": r"\bwars?\b", "freedom": r"\bfreedom\b", "self-reliance": r"self.relian",
    "depression/anxiety": r"depression|anxiety", "abuse": r"\babuse", "tithing": r"tith",
    "jesus christ": r"jesus christ", "holy ghost": r"holy ghost|holy spirit",
}


def _calling_group(c: str) -> str:
    c = c.lower()
    if "first presidency" in c or "president of the church" in c:
        return "First Presidency"
    if "quorum of the twelve" in c or "council of the twelve" in c:
        return "Quorum of the Twelve"
    if "seventy" in c:
        return "Seventy"
    if "presiding bishop" in c:
        return "Presiding Bishopric"
    if "relief society" in c:
        return "Relief Society"
    if "young women" in c:
        return "Young Women"
    if "primary" in c:
        return "Primary"
    if "sunday school" in c:
        return "Sunday School"
    if "young men" in c:
        return "Young Men"
    return "Other"


def _syllables(word: str) -> int:
    groups = re.findall(r"[aeiouy]+", word)
    n = len(groups)
    if word.endswith("e") and n > 1 and not word.endswith(("le", "ee", "ye")):
        n -= 1
    return max(1, n)


# --- Text/metadata analytics ----------------------------------------------

def compute_text_stats(conference, byu, scriptures, handbook) -> dict:
    stats: dict = {}
    bible, bom, dnc, pogp = (scriptures[s] for s in SCRIPTURE_SOURCES)

    # group conference chunks into talks
    talks: dict[str, dict] = {}
    for d in conference:
        m = d["metadata"]
        t = talks.setdefault(m["talk_uri"], {
            "title": d.get("title"), "speaker": m.get("speaker") or "Unknown",
            "calling": m.get("calling") or "", "year": m["year"], "month": m["month"],
            "url": d["url"].split("#")[0], "words": 0})
        t["words"] += _wc(d["text"])
    for t in talks.values():
        t["speaker_n"] = norm_speaker(t["speaker"])
        t["proc"] = is_procedural(t["title"])
    sermons = {u: t for u, t in talks.items()
               if not t["proc"] and t["speaker_n"] != "Unknown"}

    speeches: dict[str, dict] = {}
    for d in byu:
        m = d["metadata"]
        t = speeches.setdefault(m["speech_path"], {
            "title": d.get("title"), "speaker": m.get("speaker") or "Unknown",
            "year": m.get("year"), "url": d["url"].split("#")[0], "words": 0})
        t["words"] += _wc(d["text"])
    for t in speeches.values():
        t["speaker_n"] = norm_speaker(t["speaker"])

    # meta tiles
    conf_words = sum(t["words"] for t in talks.values())
    byu_words = sum(t["words"] for t in speeches.values())
    scripture_words = {name: sum(_wc(d["text"]) for d in corp) for name, corp in
                       [("Bible (KJV)", bible), ("Book of Mormon", bom),
                        ("Doctrine and Covenants", dnc), ("Pearl of Great Price", pogp)]}
    years = sorted({t["year"] for t in talks.values()})
    stats["procedural_talks"] = sum(1 for t in talks.values() if t["proc"])
    stats["meta"] = {
        "total_docs": len(conference) + len(byu) + len(handbook)
        + sum(len(scriptures[s]) for s in SCRIPTURE_SOURCES),
        "sources": {
            "bible": len(bible), "book_of_mormon": len(bom),
            "doctrine_and_covenants": len(dnc), "pearl_of_great_price": len(pogp),
            "conference_chunks": len(conference), "byu_chunks": len(byu),
            "handbook_chunks": len(handbook)},
        "talks": len(talks), "speeches": len(speeches),
        "conference_speakers": len({t["speaker_n"] for t in talks.values()}),
        "byu_speakers": len({t["speaker_n"] for t in speeches.values()}),
        "conference_years": [years[0], years[-1]],
        "total_words": conf_words + byu_words + sum(scripture_words.values())
        + sum(_wc(d["text"]) for d in handbook),
    }

    # speakers
    by_speaker: dict[str, list[dict]] = defaultdict(list)
    for t in sermons.values():
        by_speaker[t["speaker_n"]].append(t)
    prolific = []
    for s, ts in by_speaker.items():
        ys = [t["year"] for t in ts]
        decades = Counter((y // 10) * 10 for y in ys)
        prolific.append({
            "speaker": s, "talks": len(ts), "first": min(ys), "last": max(ys),
            "span": max(ys) - min(ys),
            "decades": {str(k): v for k, v in sorted(decades.items())},
            "avg_words": round(sum(t["words"] for t in ts) / len(ts))})
    prolific.sort(key=lambda x: -x["talks"])
    stats["prolific"] = prolific[:30]
    stats["longest_span"] = sorted(prolific, key=lambda x: -x["span"])[:15]
    qualified = [p for p in prolific if p["talks"] >= 10]
    stats["wordiest"] = sorted(qualified, key=lambda x: -x["avg_words"])[:12]
    stats["most_concise"] = sorted(qualified, key=lambda x: x["avg_words"])[:12]

    len_by_year: dict[int, list[int]] = defaultdict(list)
    for t in sermons.values():
        len_by_year[t["year"]].append(t["words"])
    stats["talk_length_by_year"] = {
        str(y): round(sum(v) / len(v)) for y, v in sorted(len_by_year.items())}

    tl = sorted(sermons.values(), key=lambda t: -t["words"])
    def _pick(t):
        return {"title": t["title"], "speaker": t["speaker_n"], "year": t["year"],
                "words": t["words"], "url": t["url"]}
    stats["longest_talks"] = [_pick(t) for t in tl[:10]]
    stats["shortest_talks"] = [_pick(t) for t in tl[-10:]][::-1]

    # callings over time (full record, procedural included)
    calling_by_decade: dict[int, Counter] = defaultdict(Counter)
    for t in talks.values():
        calling_by_decade[(t["year"] // 10) * 10][_calling_group(t["calling"])] += 1
    stats["callings_by_decade"] = {str(k): dict(v) for k, v in sorted(calling_by_decade.items())}

    women = {"Relief Society", "Young Women", "Primary"}
    wo, tot = defaultdict(int), defaultdict(int)
    for t in talks.values():
        tot[t["year"]] += 1
        if _calling_group(t["calling"]) in women:
            wo[t["year"]] += 1
    stats["women_org_talks_by_year"] = {str(y): [wo[y], tot[y]] for y in sorted(tot)}

    # crossover with BYU speeches
    byu_by_speaker: dict[str, list[dict]] = defaultdict(list)
    for t in speeches.values():
        byu_by_speaker[t["speaker_n"]].append(t)
    crossover = sorted(
        ({"speaker": s, "conference_talks": len(by_speaker[s]),
          "byu_speeches": len(byu_by_speaker[s])}
         for s in set(by_speaker) & set(byu_by_speaker)),
        key=lambda x: -(x["conference_talks"] + x["byu_speeches"]))
    stats["crossover"] = crossover[:25]
    stats["crossover_total"] = len(crossover)
    stats["byu_prolific"] = sorted(
        [{"speaker": s, "speeches": len(v)} for s, v in byu_by_speaker.items()],
        key=lambda x: -x["speeches"])[:15]

    # word trends (per million words, per year)
    year_text: dict[int, list[str]] = defaultdict(list)
    for d in conference:
        year_text[d["metadata"]["year"]].append(d["text"].lower())
    year_blob = {y: " ".join(v) for y, v in year_text.items()}
    year_words = {y: len(b.split()) for y, b in year_blob.items()}
    stats["word_trends"] = {
        label: {str(y): round(len(re.compile(pat).findall(year_blob[y])) / year_words[y] * 1e6, 1)
                for y in sorted(year_blob)}
        for label, pat in WORD_TREND_TERMS.items()}

    # vocabulary fingerprints
    speaker_tf = {s: Counter() for s, ts in by_speaker.items() if len(ts) >= 8}
    all_tf: Counter = Counter()
    for d in conference:
        s = norm_speaker(d["metadata"].get("speaker") or "")
        words = [w for w in re.findall(r"[a-z']{3,}", d["text"].lower()) if w not in STOP]
        all_tf.update(words)
        if s in speaker_tf:
            speaker_tf[s].update(words)
    total_all = sum(all_tf.values())
    fingerprints = {}
    for s, tf in speaker_tf.items():
        total_s = sum(tf.values())
        if total_s < 20000:
            continue
        scored = []
        for w, c in tf.items():
            if c < 12:
                continue
            lift = (c / total_s) / (all_tf[w] / total_all)
            if lift > 2.2:
                scored.append((lift * math.log1p(c), w, round(lift, 1), c))
        scored.sort(reverse=True)
        fingerprints[s] = [{"word": w, "lift": l, "count": c} for _, w, l, c in scored[:10]]
    stats["fingerprints"] = {
        p["speaker"]: fingerprints[p["speaker"]]
        for p in prolific[:20] if p["speaker"] in fingerprints}

    # readability
    read_by_year = {}
    for y in sorted(year_blob):
        blob = year_blob[y]
        sentences = [s for s in re.split(r"[.!?]+", blob) if len(s.split()) > 2]
        words = blob.split()
        sample = [re.sub(r"[^a-z']", "", w) for w in words[::7]]
        sample = [w for w in sample if w]
        asl = len(words) / max(1, len(sentences))
        asw = sum(_syllables(w) for w in sample) / max(1, len(sample))
        read_by_year[str(y)] = {
            "avg_sentence_len": round(asl, 1),
            "flesch": round(206.835 - 1.015 * asl - 84.6 * asw, 1)}
    stats["readability_by_year"] = read_by_year

    # scripture citations in conference
    verse_counts: Counter = Counter()
    book_counts: Counter = Counter()
    volume_counts: Counter = Counter()
    verse_by_decade: dict[int, Counter] = defaultdict(Counter)
    for d in conference:
        decade = (d["metadata"]["year"] // 10) * 10
        for book, ch, v in find_citations(d["text"]):
            ref = f"{book} {ch}:{v}"
            verse_counts[ref] += 1
            book_counts[book] += 1
            volume_counts[BOOK_VOLUME[book]] += 1
            verse_by_decade[decade][ref] += 1
    stats["top_verses"] = [{"ref": r, "count": c} for r, c in verse_counts.most_common(30)]
    stats["book_citations"] = [
        {"book": b, "count": c, "volume": BOOK_VOLUME.get(b, "?")}
        for b, c in book_counts.most_common()]
    stats["volume_citations"] = dict(volume_counts.most_common())
    stats["top_verse_by_decade"] = {
        str(d): [{"ref": r, "count": c} for r, c in vc.most_common(5)]
        for d, vc in sorted(verse_by_decade.items())}
    stats["never_cited_books"] = [
        b for b in BOM_BOOKS + OT + NT + PGP
        if b != "Psalms" and b not in book_counts]
    stats["least_cited_books"] = [
        {"book": b, "count": c, "volume": BOOK_VOLUME.get(b, "?")}
        for b, c in book_counts.most_common()[:-16:-1]]

    # scripture trivia
    def _volume_of(d):
        if d["source"] == "bible":
            return "Old Testament" if d["metadata"]["testament"] == "ot" else "New Testament"
        return d["metadata"]["volume"]

    all_verses = bible + bom + dnc + pogp
    vs = sorted(all_verses, key=lambda d: _wc(d["text"]))
    stats["shortest_verses"] = [
        {"ref": d["reference"], "text": d["text"], "words": _wc(d["text"])} for d in vs[:8]]
    stats["longest_verses"] = [
        {"ref": d["reference"], "words": _wc(d["text"]), "text": d["text"][:180] + "…"}
        for d in vs[-8:]][::-1]

    icp: Counter = Counter()
    for d in all_verses:
        n = len(re.findall(r"it came to pass", d["text"].lower()))
        if n:
            icp[_volume_of(d)] += n
    book_icp: Counter = Counter()
    for d in bom:
        n = len(re.findall(r"it came to pass", d["text"].lower()))
        if n:
            book_icp[d["metadata"]["book"]] += n
    stats["came_to_pass"] = {
        "by_volume": dict(icp.most_common()), "bom_by_book": dict(book_icp.most_common())}

    ch_verses: Counter = Counter()
    for d in all_verses:
        m = d["metadata"]
        book = m.get("book") or ("D&C" if d["source"] == "doctrine-and-covenants" else "?")
        ch_verses[f"{book} {m['chapter']}"] += 1
    stats["biggest_chapters"] = [
        {"chapter": c, "verses": n} for c, n in ch_verses.most_common(10)]
    stats["verses_by_volume"] = dict(Counter(_volume_of(d) for d in all_verses).most_common())
    return stats


# --- Embedding analytics --------------------------------------------------

def compute_embedding_stats(conference, conf_emb, scriptures, scripture_embs) -> dict:
    stats: dict = {}

    talk_rows: dict[str, list[int]] = defaultdict(list)
    for i, d in enumerate(conference):
        if is_procedural(d.get("title")):
            continue
        talk_rows[d["metadata"]["talk_uri"]].append(i)
    talk_uris = sorted(talk_rows)
    centroids = np.vstack([conf_emb[talk_rows[u]].mean(axis=0) for u in talk_uris])
    centroids /= np.linalg.norm(centroids, axis=1, keepdims=True)

    talk_meta = {}
    for u in talk_uris:
        d = conference[talk_rows[u][0]]
        talk_meta[u] = {"title": d.get("title"),
                        "speaker": norm_speaker(d["metadata"].get("speaker")),
                        "year": d["metadata"]["year"], "url": d["url"].split("#")[0]}

    # typicality
    center = centroids.mean(axis=0)
    center /= np.linalg.norm(center)
    sim = centroids @ center
    order = np.argsort(sim)

    def _tinfo(i):
        return {**talk_meta[talk_uris[i]], "sim": round(float(sim[i]), 3)}

    stats["most_typical"] = [_tinfo(i) for i in order[::-1][:10]]
    stats["most_unusual"] = [_tinfo(i) for i in order[:10]]

    # talk twins (nearest talk by a different speaker)
    S = centroids @ centroids.T
    np.fill_diagonal(S, -1)
    speakers = np.array([talk_meta[u]["speaker"] for u in talk_uris])
    years = np.array([talk_meta[u]["year"] for u in talk_uris])
    pairs, seen = [], set()
    for i in range(len(talk_uris)):
        row = S[i].copy()
        row[speakers == speakers[i]] = -1
        j = int(np.argmax(row))
        if row[j] <= 0:
            continue
        key = tuple(sorted((i, j)))
        if key not in seen:
            seen.add(key)
            pairs.append((float(row[j]), i, j))
    pairs.sort(reverse=True)

    def _pairinfo(sim_, i, j):
        a, b = talk_meta[talk_uris[i]], talk_meta[talk_uris[j]]
        return {"sim": round(sim_, 3), "a": a, "b": b,
                "years_apart": abs(a["year"] - b["year"])}

    stats["twins"] = [_pairinfo(*p) for p in pairs[:10]]
    stats["twins_cross_era"] = [
        _pairinfo(*p) for p in pairs if abs(years[p[1]] - years[p[2]]) >= 25][:10]

    # k-means clusters of talk centroids
    K = 12
    rng = np.random.default_rng(42)
    centers = centroids[rng.choice(len(centroids), K, replace=False)]
    for _ in range(40):
        labels = np.argmax(centroids @ centers.T, axis=1)
        new = np.vstack([
            centroids[labels == k].mean(axis=0) if (labels == k).any() else centers[k]
            for k in range(K)])
        new /= np.linalg.norm(new, axis=1, keepdims=True)
        if np.allclose(new, centers, atol=1e-6):
            break
        centers = new
    labels = np.argmax(centroids @ centers.T, axis=1)

    cluster_stop = STOP | {"today", "things", "love", "lord", "god", "jesus", "christ", "church"}
    chunks_by_talk: dict[str, list[str]] = defaultdict(list)
    for d in conference:
        chunks_by_talk[d["metadata"]["talk_uri"]].append(d["text"])
    all_tf: Counter = Counter()
    cluster_tf = [Counter() for _ in range(K)]
    for idx, u in enumerate(talk_uris):
        words = [w for w in re.findall(r"[a-z']{4,}", " ".join(chunks_by_talk[u]).lower())
                 if w not in cluster_stop]
        c = Counter(words)
        all_tf.update(c)
        cluster_tf[labels[idx]].update(c)
    total_all = sum(all_tf.values())

    clusters = []
    for k in range(K):
        tf = cluster_tf[k]
        total_k = sum(tf.values())
        scored = []
        for w, c in tf.items():
            if c < 30:
                continue
            lift = (c / total_k) / (all_tf[w] / total_all)
            if lift > 1.5:
                scored.append((lift * math.log1p(c), w))
        scored.sort(reverse=True)
        members = np.where(labels == k)[0]
        csims = centroids[members] @ centers[k]
        top_members = members[np.argsort(csims)[::-1][:2]]
        clusters.append({
            "size": len(members),
            "top_words": [w for _, w in scored[:8]],
            "by_decade": {str(d): int(c) for d, c in
                          sorted(Counter((years[i] // 10) * 10 for i in members).items())},
            "examples": [talk_meta[talk_uris[i]] for i in top_members]})
    clusters.sort(key=lambda c: -c["size"])
    stats["clusters"] = clusters
    stats["cluster_decade_totals"] = {
        str(d): int(c) for d, c in sorted(Counter((y // 10) * 10 for y in years).items())}

    # verse echo: nearest verse for every (non-procedural) conference chunk
    verse_docs: list[dict] = []
    verse_emb_list = []
    for s in SCRIPTURE_SOURCES:
        verse_docs.extend(scriptures[s])
        verse_emb_list.append(scripture_embs[s])
    V = np.vstack(verse_emb_list)

    keep = [i for i, d in enumerate(conference) if not is_procedural(d.get("title"))]
    E = conf_emb[keep]
    echo: Counter = Counter()
    strong: Counter = Counter()
    best_sim_sum = 0.0
    B = 2000
    for start in range(0, len(E), B):
        block = E[start:start + B] @ V.T
        arg = np.argmax(block, axis=1)
        mx = block[np.arange(len(arg)), arg]
        best_sim_sum += float(mx.sum())
        for a, s_ in zip(arg, mx):
            ref = verse_docs[a]["reference"]
            echo[ref] += 1
            if s_ > 0.6:
                strong[ref] += 1
    text_of = {d["reference"]: d["text"] for d in verse_docs}
    stats["verse_echo_strong"] = [
        {"ref": r, "count": c, "text": text_of[r][:160]} for r, c in strong.most_common(25)]
    stats["verse_echo_mean_sim"] = round(best_sim_sum / len(E), 3)
    return stats


# --- Entry point ----------------------------------------------------------

def main() -> None:
    t0 = time.time()
    print("fetching corpora from Atlas (this pulls embeddings — a few minutes)…", flush=True)
    conference, conf_emb = _fetch("conference", with_embeddings=True)
    byu, _ = _fetch("byu-speeches", with_embeddings=False)
    handbook, _ = _fetch("handbook", with_embeddings=False)
    scriptures, scripture_embs = {}, {}
    for s in SCRIPTURE_SOURCES:
        scriptures[s], scripture_embs[s] = _fetch(s, with_embeddings=True)
    print(f"fetched in {time.time() - t0:.0f}s; computing…", flush=True)

    data = compute_text_stats(conference, byu, scriptures, handbook)
    data.update(compute_embedding_stats(conference, conf_emb, scriptures, scripture_embs))

    doc = {
        "_id": "site_stats",
        "generated_at": datetime.now(UTC).isoformat(),
        "data": data,
    }
    db.get_stats_collection().replace_one({"_id": "site_stats"}, doc, upsert=True)
    print(f"upserted stats doc ({time.time() - t0:.0f}s total, "
          f"generated_at={doc['generated_at']})")


if __name__ == "__main__":
    sys.exit(main())
