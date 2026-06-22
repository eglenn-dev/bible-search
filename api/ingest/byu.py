"""Polite, cached HTTP client for speeches.byu.edu.

Unlike churchofjesuschrist.org (``church.py``), BYU Speeches has no content API;
it is a static WordPress site whose pages render the full transcript server-side,
so plain HTML is fetched and parsed directly. Responses are cached on disk and
requests are rate-limited + User-Agent identified, matching ``church.py``.

robots.txt (checked 2026-06) allows crawling everything except a short list of
paths, which are honored via ``DISALLOWED_PATHS``.
"""

import hashlib
import os
import time
from typing import Optional

import requests

SITE_BASE = "https://speeches.byu.edu"

# The three English speech sitemaps enumerate every transcript URL (~2,500).
SPEECH_SITEMAPS = [
    f"{SITE_BASE}/speech-sitemap.xml",
    f"{SITE_BASE}/speech-sitemap2.xml",
    f"{SITE_BASE}/speech-sitemap3.xml",
]

# Paths explicitly Disallow-ed by speeches.byu.edu/robots.txt — never fetch these.
DISALLOWED_PATHS = {
    "/talks/william-j-barber-ii/the-need-for-a-mass-coming-together-of-poor-people-"
    "and-people-of-faith-in-this-moment-of-crisis/",
}

CACHE_DIR = os.path.join(os.path.dirname(__file__), ".cache_byu")
REQUEST_DELAY_S = 1.0  # be polite
USER_AGENT = (
    "gospel-library-search/1.0 (personal educational project; "
    "https://github.com/eglenn-dev/bible-search)"
)

_last_request = 0.0


def _cache_path(url: str) -> str:
    digest = hashlib.sha1(url.encode()).hexdigest()
    return os.path.join(CACHE_DIR, f"{digest}.html")


def fetch_html(url: str, *, use_cache: bool = True) -> Optional[str]:
    """Fetch a page (or sitemap) from speeches.byu.edu as text.

    Returns the response body, or ``None`` on 404. Results are cached on disk so
    re-runs and selector tweaks don't re-hit the site.
    """
    global _last_request
    os.makedirs(CACHE_DIR, exist_ok=True)
    cache_file = _cache_path(url)

    if use_cache and os.path.exists(cache_file):
        with open(cache_file, "r", encoding="utf-8") as f:
            return f.read()

    # Rate limit.
    elapsed = time.time() - _last_request
    if elapsed < REQUEST_DELAY_S:
        time.sleep(REQUEST_DELAY_S - elapsed)

    headers = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xml"}
    response = requests.get(url, headers=headers, timeout=30)
    _last_request = time.time()

    if response.status_code == 404:
        return None
    response.raise_for_status()
    body = response.text

    with open(cache_file, "w", encoding="utf-8") as f:
        f.write(body)
    return body
