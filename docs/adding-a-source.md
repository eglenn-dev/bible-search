# Adding a New Source

This guide walks through adding a new corpus end-to-end. The architecture is built for this: documents of any `source` share one collection and one vector index, so a new source is mostly **(1) a small ingestion module** and **(2) wiring its slug into a few lists**.

There are two ingestion paths:
- **Path A — local dataset** (you have a JSON/text file): model it on `api/ingest/lds_scriptures.py`.
- **Path B — scraped from churchofjesuschrist.org**: model it on `api/ingest/conference.py` / `handbook.py`.

Throughout, we'll use a running example: a corpus of **Come, Follow Me** lessons with slug `come-follow-me`.

---

## 0. Pick a slug and a label

- **Slug** (`source` value): lowercase, hyphenated, stable — e.g. `come-follow-me`. This is stored on every document and used as the filter value. **Don't change it later** without re-ingesting.
- **Label:** human-facing display name — e.g. `Come, Follow Me`.

## Checklist (files you'll touch)

| File | Change |
|---|---|
| `api/ingest/<your_source>.py` | **New** — builds records + embeds + upserts. |
| `api/ingest/urls.py` | *(optional)* deep-link builder, if not provided in your data. |
| `api/ingest/run.py` | Register the runner in `ORDER` / `RUNNERS` (and `_NO_FORCE` if no scrape). |
| `api/db.py` | Add the slug to `VALID_SOURCES`. |
| `client/src/lib/types.ts` | Add the slug to the `Source` union. |
| `client/src/components/sources-filter.tsx` | Add a filter chip. |
| `client/src/components/render-results.tsx` | Add a badge (+ heading/subtitle behavior). |

---

## 1. Write the ingestion module

A source module just needs to produce a list of record dicts with this shape (everything except `embedding`, which the shared helper fills in):

```python
{
  "_id": f"{source}:{unique_key}",   # deterministic → idempotent re-runs
  "source": "come-follow-me",
  "text": "<text to embed>",          # keep chunks roughly paragraph-sized
  "reference": "...",                  # human label shown as the card heading
  "title": "...",                      # or None
  "url": "https://www.churchofjesuschrist.org/...",  # deep link (precompute it)
  "metadata": { ... },                 # any source-specific fields you want to show/filter
}
```

Then hand the records to `embed_and_upsert(records)` from `ingest/common.py` — it embeds each `text` with the shared model and upserts by `_id`.

### Path A — local dataset (recommended starting point)

`api/ingest/come_follow_me.py`:

```python
"""Ingest Come, Follow Me lessons from api/data/new/cfm.json."""
import json, os
from ingest.common import chunked, embed_and_upsert, log_storage

SOURCE = "come-follow-me"
LABEL = "Come, Follow Me"
DATA = os.path.join(os.path.dirname(__file__), "..", "data", "new", "cfm.json")

def build_records() -> list[dict]:
    items = json.load(open(DATA))            # adapt to your file's shape
    records = []
    for it in items:
        ref = it["reference"]
        records.append({
            "_id": f"{SOURCE}:{ref}",
            "source": SOURCE,
            "text": it["text"],
            "reference": ref,
            "title": it.get("title"),
            "url": it.get("url", ""),         # or build it (see step 2)
            "metadata": {"label": LABEL, **it.get("metadata", {})},
        })
    return records

def run() -> None:
    records = build_records()
    print(f"{LABEL}: {len(records)} records")
    total = 0
    for batch in chunked(records, 2000):     # embed in chunks for visible progress
        total += embed_and_upsert(batch)
        print(f"  upserted {total}/{len(records)}")
    log_storage(f"after {SOURCE}")

if __name__ == "__main__":
    run()
```

### Path B — scraped source

If you're scraping churchofjesuschrist.org, reuse `api/ingest/church.py`:
- `fetch_content(uri)` → cached, rate-limited content-API JSON.
- `content_body(data)` → the page's HTML (parse with BeautifulSoup).
- `study_url(uri, anchor)` → public deep link.

Copy the structure of `conference.py` (list items → parse each → chunk → `embed_and_upsert`) and make it **resumable** by skipping work already present:

```python
from ingest.common import already_ingested
if not force and already_ingested({"metadata.lesson_uri": uri}):
    continue
```

Keep chunks to a few paragraphs (`embed`s shorter texts; better retrieval granularity), and precompute each chunk's `url` with the first paragraph's `#p<id>` anchor.

## 2. (Optional) Deep-link builder

If your data doesn't include URLs, add a builder to `api/ingest/urls.py` and call it in `build_records`. Follow the existing pattern (`bible_url`, `bofm_url`, `dc_url`, `pgp_url`), which all use `STUDY_BASE` and `parse_reference()`. churchofjesuschrist.org verse URLs look like `…/study/scriptures/<vol>/<book-slug>/<chapter>?id=p<verse>#p<verse>`.

## 3. Wire the runner into `run.py`

```python
from ingest import bible, conference, handbook, lds_scriptures, come_follow_me  # add import

ORDER = ["bible", "scriptures", "come-follow-me", "conference", "handbook"]      # add slug
RUNNERS = { ..., "come-follow-me": come_follow_me.run }                          # add runner
_NO_FORCE = {"bible", "scriptures", "come-follow-me"}  # add here IF run() takes no force= arg
```

`_NO_FORCE` lists sources whose `run()` has no `force` parameter (local datasets). Scraped sources take `run(force=...)` for re-scraping, so leave them out.

Now `uv run python -m ingest.run --source come-follow-me` works (and the source is included in `--source all`).

## 4. Register the slug in the backend

`api/db.py`:

```python
VALID_SOURCES = {
    "bible", "book-of-mormon", "doctrine-and-covenants", "pearl-of-great-price",
    "conference", "handbook",
    "come-follow-me",        # add it
}
```

Without this, the API silently ignores `sources=come-follow-me` as a filter (the docs are still returned by unfiltered search).

> No index change is needed. The vector index covers `embedding` for **all** documents and has `source` as a filter field, so new sources are searchable/filterable the moment their docs land in Atlas.

## 5. Wire the frontend (3 edits)

**`client/src/lib/types.ts`** — extend the union:
```ts
export type Source =
  | "bible" | "book-of-mormon" | "doctrine-and-covenants" | "pearl-of-great-price"
  | "conference" | "handbook"
  | "come-follow-me";
```

**`client/src/components/sources-filter.tsx`** — add a chip:
```ts
{ key: "come-follow-me", label: "Come, Follow Me" },
```

**`client/src/components/render-results.tsx`** — add a badge to `SOURCE_META` (required — it's a `Record<Source, …>`, so TS won't compile without it):
```ts
"come-follow-me": { label: "Come, Follow Me", badge: "bg-[oklch(0.5_0.1_150)] text-white" },
```
If results are verse-like (heading = `reference`, subtitle = a volume/label), add the slug to `SCRIPTURE_SOURCES`. Otherwise extend `headingFor`/`subtitleFor` to format your `metadata` (e.g. how `conference` shows speaker + date).

## 6. Run and verify

```bash
cd api
uv run python -m ingest.run --source come-follow-me      # ingest
uv run python -m ingest.run --stats                      # check storage vs the 512MB cap

# query it (filtered)
uv run uvicorn app:app --port 10000 &
curl "http://localhost:10000/search?query=faith&k=5&sources=come-follow-me"
```

Then `cd client && npm run build` (confirms the `Source` union is satisfied everywhere) and `npm run dev` to see the new chip and badges.

If the index was just created (first source ever), wait for it to be `READY` before querying. For an existing index, new docs are queryable within moments.

---

## Gotchas

- **Same embedding model, always.** New sources must use `paraphrase-MiniLM-L3-v2` (the shared `embed_texts`). Mixing models/dimensions breaks similarity. Switching models means re-embedding every source.
- **Deterministic, unique `_id`s.** Re-running upserts instead of duplicating. Make the key stable (a reference, or `uri:anchor`).
- **Mind the M0 cap.** ~93k docs ≈ 193 MB today. Check `--stats` after large ingests; chunk coarser or move to Atlas Flex if you approach 512 MB.
- **Be polite when scraping.** Keep `church.py`'s rate-limit and `User-Agent`; rely on its on-disk cache so re-runs don't re-hit the site.
- **Frontend `SOURCE_META` is exhaustive.** It's typed `Record<Source, …>`; forgetting an entry is a compile error (a feature — it forces you to finish the wiring).
