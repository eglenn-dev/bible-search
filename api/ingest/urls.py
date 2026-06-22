"""Church (churchofjesuschrist.org) URL + reference helpers.

Ported from client/src/lib/chapter-map.ts so the backend can precompute deep
links at ingest time. Bible verse URLs look like:

    https://www.churchofjesuschrist.org/study/scriptures/ot/gen/1?id=p1#p1
"""

STUDY_BASE = "https://www.churchofjesuschrist.org/study"

OT_CHAPTER_MAP: dict[str, str] = {
    "Genesis": "gen", "Exodus": "ex", "Leviticus": "lev", "Numbers": "num",
    "Deuteronomy": "deut", "Joshua": "josh", "Judges": "judg", "Ruth": "ruth",
    "1 Samuel": "1-sam", "2 Samuel": "2-sam", "1 Kings": "1-kgs", "2 Kings": "2-kgs",
    "1 Chronicles": "1-chr", "2 Chronicles": "2-chr", "Ezra": "ezra",
    "Nehemiah": "neh", "Esther": "esth", "Job": "job", "Psalms": "ps",
    "Proverbs": "prov", "Ecclesiastes": "eccl", "Song of Solomon": "song",
    "Solomon's Song": "song",  # KJV dataset's name for Song of Solomon
    "Isaiah": "isa", "Jeremiah": "jer", "Lamentations": "lam", "Ezekiel": "ezek",
    "Daniel": "dan", "Hosea": "hosea", "Joel": "joel", "Amos": "amos",
    "Obadiah": "obad", "Jonah": "jonah", "Micah": "micah", "Nahum": "nahum",
    "Habakkuk": "hab", "Zephaniah": "zeph", "Haggai": "hag", "Zechariah": "zech",
    "Malachi": "mal",
}

NT_CHAPTER_MAP: dict[str, str] = {
    "Matthew": "matt", "Mark": "mark", "Luke": "luke", "John": "john",
    "Acts": "acts", "Romans": "rom", "1 Corinthians": "1-cor",
    "2 Corinthians": "2-cor", "Galatians": "gal", "Ephesians": "eph",
    "Philippians": "philip", "Colossians": "col", "1 Thessalonians": "1-thes",
    "2 Thessalonians": "2-thes", "1 Timothy": "1-tim", "2 Timothy": "2-tim",
    "Titus": "titus", "Philemon": "philem", "Hebrews": "heb", "James": "james",
    "1 Peter": "1-pet", "2 Peter": "2-pet", "1 John": "1-jn", "2 John": "2-jn",
    "3 John": "3-jn", "Jude": "jude", "Revelation": "rev",
}


def parse_reference(reference: str) -> tuple[str, str, str]:
    """Split 'Song of Solomon 2:1' -> ('Song of Solomon', '2', '1')."""
    book, chapter_verse = reference.rsplit(" ", 1)
    chapter, verse = chapter_verse.split(":")
    return book, chapter, verse


def bible_metadata(reference: str) -> dict:
    book, chapter, verse = parse_reference(reference)
    testament = "ot" if book in OT_CHAPTER_MAP else "nt"
    return {
        "book": book,
        "chapter": int(chapter),
        "verse": int(verse),
        "testament": testament,
        "translation": "KJV",
    }


def bible_url(reference: str) -> str:
    book, chapter, verse = parse_reference(reference)
    if book in OT_CHAPTER_MAP:
        section, slug = "ot", OT_CHAPTER_MAP[book]
    elif book in NT_CHAPTER_MAP:
        section, slug = "nt", NT_CHAPTER_MAP[book]
    else:
        return ""
    return f"{STUDY_BASE}/scriptures/{section}/{slug}/{chapter}?id=p{verse}#p{verse}"


# --- Other Standard Works -------------------------------------------------

# Book of Mormon: /study/scriptures/bofm/<slug>/<chapter>
BOFM_MAP: dict[str, str] = {
    "1 Nephi": "1-ne", "2 Nephi": "2-ne", "Jacob": "jacob", "Enos": "enos",
    "Jarom": "jarom", "Omni": "omni", "Words of Mormon": "w-of-m",
    "Mosiah": "mosiah", "Alma": "alma", "Helaman": "hel", "3 Nephi": "3-ne",
    "4 Nephi": "4-ne", "Mormon": "morm", "Ether": "ether", "Moroni": "moro",
}

# Pearl of Great Price: /study/scriptures/pgp/<slug>/<chapter>
# Keys normalized (em/en dashes -> hyphen) so lookups are robust to the source's dash style.
PGP_MAP: dict[str, str] = {
    "Moses": "moses", "Abraham": "abr", "Joseph Smith-Matthew": "js-m",
    "Joseph Smith-History": "js-h", "Articles of Faith": "a-of-f",
}


def _normalize_dashes(text: str) -> str:
    return text.replace("—", "-").replace("–", "-")


def bofm_url(reference: str) -> str:
    book, chapter, verse = parse_reference(reference)
    slug = BOFM_MAP.get(book)
    if not slug:
        return ""
    return f"{STUDY_BASE}/scriptures/bofm/{slug}/{chapter}?id=p{verse}#p{verse}"


def dc_url(reference: str) -> str:
    # "D&C 76:19" -> section 76, verse 19
    _, section, verse = parse_reference(reference)
    return f"{STUDY_BASE}/scriptures/dc-testament/dc/{section}?id=p{verse}#p{verse}"


def pgp_url(reference: str) -> str:
    book, chapter, verse = parse_reference(reference)
    slug = PGP_MAP.get(_normalize_dashes(book))
    if not slug:
        return ""
    return f"{STUDY_BASE}/scriptures/pgp/{slug}/{chapter}?id=p{verse}#p{verse}"
