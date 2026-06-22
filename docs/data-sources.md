# Data Sources

Six corpora are indexed today, all in `gospel_library.documents`. Each is identified by its `source` field, which is also the filter value used by the API and the frontend chips.

## Summary

| `source` | Corpus | Documents | Granularity | Origin |
|---|---|---:|---|---|
| `bible` | Bible (KJV) | 31,102 | one verse / doc | `api/data/bible_verses.json` |
| `book-of-mormon` | Book of Mormon | 6,604 | one verse / doc | `api/data/new/bom.json` |
| `doctrine-and-covenants` | Doctrine and Covenants | 3,654 | one verse / doc | `api/data/new/dnc.json` |
| `pearl-of-great-price` | Pearl of Great Price | 635 | one verse / doc | `api/data/new/pogp.json` |
| `conference` | General Conference (1971–present) | 49,069 chunks (4,125 talks) | ~3 paragraphs / chunk | scraped (content API) |
| `handbook` | General Handbook | 2,330 chunks | ~1 section / chunk | scraped (content API) |
| | **Total** | **~93,394** | | ~193 MB / 512 MB cap |

`VALID_SOURCES` in `api/db.py` is the canonical list — the API only honors these as filters. The frontend mirrors them in `client/src/components/sources-filter.tsx` and `client/src/lib/types.ts`.

## Common document shape

Every source produces the same top-level shape (see [architecture.md](./architecture.md#data-model)); only `metadata` and how `text`/`url`/`reference` are derived differ.

```jsonc
{ "_id", "source", "text", "embedding", "reference", "title", "url", "metadata" }
```

## Per-source detail

### `bible` — KJV Bible
- **Module:** `api/ingest/bible.py` · **Command:** `uv run python -m ingest.run --source bible`
- **`_id`:** `bible:<reference>` (e.g. `bible:Genesis 1:1`)
- **`reference`:** verse reference; **`title`:** `null`
- **`url`:** `…/study/scriptures/{ot|nt}/{slug}/{chapter}?id=p{verse}#p{verse}` via `urls.bible_url`
- **`metadata`:** `{ book, chapter, verse, testament: "ot"|"nt", translation: "KJV" }`
- Note: the dataset names that book "Solomon's Song" (not "Song of Solomon") — both are mapped in `urls.OT_CHAPTER_MAP`.

### `book-of-mormon`, `doctrine-and-covenants`, `pearl-of-great-price` — other Standard Works
- **Module:** `api/ingest/lds_scriptures.py` · **Command:** `uv run python -m ingest.run --source scriptures` (does all three)
- **Source files:** `api/data/new/{bom,dnc,pogp}.json`, each shaped `{ "verses": [ { "reference", "text" } ], ... }`
- **`_id`:** `<source>:<reference>` (e.g. `book-of-mormon:Alma 32:21`, `doctrine-and-covenants:D&C 76:19`)
- **`url`** builders in `urls.py`:
  - Book of Mormon → `…/scriptures/bofm/{slug}/{ch}?id=p{v}#p{v}` (`urls.bofm_url`, `BOFM_MAP`)
  - D&C → `…/scriptures/dc-testament/dc/{section}?id=p{v}#p{v}` (`urls.dc_url`)
  - Pearl of Great Price → `…/scriptures/pgp/{slug}/{ch}?id=p{v}#p{v}` (`urls.pgp_url`, `PGP_MAP`; dash-normalized so "Joseph Smith—History" resolves)
- **`metadata`:** `{ volume, book, chapter, verse }` (`volume` = display name, e.g. "Book of Mormon")

### `conference` — General Conference
- **Module:** `api/ingest/conference.py` · **Command:** `uv run python -m ingest.run --source conference`
- **Source:** scraped from the Gospel Library **content API** (see below), April + October each year from **1971** to present.
- **Chunking:** groups of `CHUNK_PARAGRAPHS = 3` paragraphs. Session/meeting landing pages are filtered out.
- **`_id`:** `conference:<talk_uri>:<first_paragraph_id>`
- **`reference`/`title`:** the talk title; **`url`:** talk URL + `#p<id>` anchor of the chunk's first paragraph
- **`metadata`:** `{ speaker, calling, year, month, talk_uri, paragraph_id }`
- **Resumable** via `already_ingested({ "metadata.talk_uri": uri })`.

### `handbook` — General Handbook
- **Module:** `api/ingest/handbook.py` · **Command:** `uv run python -m ingest.run --source handbook`
- **Source:** scraped from the content API under `/manual/general-handbook` (all chapters).
- **Chunking:** split by section heading (`<h2>/<h3>` with an `id`), then groups of `SECTION_CHUNK_PARAGRAPHS = 5` paragraphs.
- **`_id`:** `handbook:<chapter_uri>:<anchor>:<i>`
- **`reference`:** section number or title; **`title`:** section title; **`url`:** chapter URL + `#<anchor>`
- **`metadata`:** `{ chapter, section_number, section_title, anchor, chapter_uri }`
- **Resumable** via `already_ingested({ "metadata.chapter_uri": uri })`.

## The churchofjesuschrist.org content API

The scrapers don't parse the rendered SPA; they use the content API, which returns JSON containing the page's HTML body:

```
https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=<uri>
```

`api/ingest/church.py` wraps it: `fetch_content(uri)` (on-disk cached under `.cache/`, 1 s rate-limited, descriptive `User-Agent`), `content_body(data)` (extracts `content.body` HTML — parsed with BeautifulSoup), and `study_url(uri, anchor)` (builds the public deep link). Paragraph `id`s in the HTML (`<p id="p3">`) double as deep-link anchors.

## Storage & limits (M0 free tier)

- Cap: **512 MB** storage; currently **~193 MB**.
- Watch it with `uv run python -m ingest.run --stats`.
- Mitigations already in place if you approach the cap: `binData` float32 vectors + scalar quantization + sensible chunking. If you outgrow M0, only the connection string changes to move to Atlas Flex/M10.
