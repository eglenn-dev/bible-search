"""Polite, cached HTTP client for the churchofjesuschrist.org content API.

The Gospel Library site renders from a content API that returns JSON with the
page's HTML body, which is far more stable to parse than the rendered SPA:

    https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content?lang=eng&uri=<uri>

Responses are cached on disk so re-runs and selector tweaks don't re-hit the
site. Requests are rate-limited and identify themselves via User-Agent.
"""

import hashlib
import json
import os
import time

import requests

CONTENT_API = (
    "https://www.churchofjesuschrist.org/study/api/v3/language-pages/type/content"
)
SITE_BASE = "https://www.churchofjesuschrist.org/study"
CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache")
REQUEST_DELAY_S = 1.0  # be polite
USER_AGENT = (
    "gospel-library-search/1.0 (personal educational project; "
    "https://github.com/eglenn-dev/bible-search)"
)

_last_request = 0.0


def _cache_path(uri: str) -> str:
    digest = hashlib.sha1(uri.encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{digest}.json")


def fetch_content(uri: str, *, use_cache: bool = True) -> dict | None:
    """Fetch the content-API JSON for a Gospel Library ``uri`` (e.g.
    ``/general-conference/2024/04/...``). Returns the parsed dict or None on 404.
    """
    global _last_request
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_file = _cache_path(uri)

    if use_cache and os.path.exists(cache_file):
        with open(cache_file, "r") as f:
            return json.load(f)

    # Rate limit.
    elapsed = time.time() - _last_request
    if elapsed < REQUEST_DELAY_S:
        time.sleep(REQUEST_DELAY_S - elapsed)

    params = {"lang": "eng", "uri": uri}
    headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    response = requests.get(CONTENT_API, params=params, headers=headers, timeout=30)
    _last_request = time.time()

    if response.status_code == 404:
        return None
    response.raise_for_status()
    data = response.json()

    with open(cache_file, "w") as f:
        json.dump(data, f)
    return data


def content_body(data: dict) -> str:
    """Extract the HTML body string from a content-API response."""
    content = data.get("content") or {}
    return content.get("body") or ""


def study_url(uri: str, anchor: str = "") -> str:
    """Build a public deep link from a content uri (+ optional ``#anchor``)."""
    url = f"{SITE_BASE}{uri}?lang=eng"
    return f"{url}#{anchor}" if anchor else url
