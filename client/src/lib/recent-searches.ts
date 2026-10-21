// Searches run on this device, newest first. Only the parameters are kept
// here (a few hundred bytes each); the results themselves sit in the service
// worker's "api-search" cache, keyed by the request URL. Re-running an entry
// rebuilds that same URL, so it opens offline whenever the cache still holds
// it (see vite.config.ts).

import { useEffect, useState, useSyncExternalStore } from "react";
import { SOURCES, RESULT_COUNTS } from "./types";
import type { ResultCount, SearchFilters, Source } from "./types";

export const RECENT_SEARCHES_STORAGE_KEY = "gs-recent-searches";
const MAX_RECENT = 20;

export interface RecentSearch {
    queryType: "natural" | "scripture";
    query: string;
    sources: Source[];
    filters: SearchFilters;
    resultCount: ResultCount;
    /** Epoch ms. */
    at: number;
}

/** Same search, whatever the result count: "Load more" updates in place. */
export function recentKey(r: Omit<RecentSearch, "at" | "resultCount">): string {
    return JSON.stringify([
        r.queryType,
        r.query.trim().toLowerCase(),
        [...r.sources].sort(),
        r.filters.speaker,
        r.filters.yearFrom,
        r.filters.yearTo,
    ]);
}

function isRecentSearch(value: unknown): value is RecentSearch {
    if (!value || typeof value !== "object") return false;
    const r = value as Partial<RecentSearch>;
    return (
        (r.queryType === "natural" || r.queryType === "scripture") &&
        typeof r.query === "string" &&
        Array.isArray(r.sources) &&
        r.sources.every((s) => (SOURCES as readonly string[]).includes(s)) &&
        !!r.filters &&
        typeof r.filters === "object" &&
        RESULT_COUNTS.includes(r.resultCount as ResultCount) &&
        typeof r.at === "number"
    );
}

// Same external-store shape as bookmarks.ts: a parsed copy so
// useSyncExternalStore gets a stable array until something changes.
let cache: RecentSearch[] | null = null;
const listeners = new Set<() => void>();

function read(): RecentSearch[] {
    if (cache) return cache;
    try {
        const raw = localStorage.getItem(RECENT_SEARCHES_STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : [];
        cache = Array.isArray(parsed) ? parsed.filter(isRecentSearch) : [];
    } catch {
        cache = [];
    }
    return cache;
}

function write(next: RecentSearch[]): void {
    cache = next;
    try {
        localStorage.setItem(RECENT_SEARCHES_STORAGE_KEY, JSON.stringify(next));
    } catch {
        // Private mode or a full quota: the list still works for this visit.
    }
    listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    const onStorage = (e: StorageEvent) => {
        if (e.key === RECENT_SEARCHES_STORAGE_KEY || e.key === null) {
            cache = null;
            listener();
        }
    };
    window.addEventListener("storage", onStorage);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
    };
}

/** Records a completed search at the top of the list. */
export function addRecentSearch(entry: Omit<RecentSearch, "at">): void {
    const query = entry.query.trim();
    if (!query) return;
    const next: RecentSearch = {
        ...entry,
        query,
        sources: [...entry.sources],
        filters: { ...entry.filters },
        at: Date.now(),
    };
    const key = recentKey(next);
    write(
        [next, ...read().filter((r) => recentKey(r) !== key)].slice(
            0,
            MAX_RECENT,
        ),
    );
}

export function clearRecentSearches(): void {
    write([]);
}

export function useRecentSearches(): RecentSearch[] {
    return useSyncExternalStore(subscribe, read);
}

/**
 * Which of `urls` the service worker can answer without the network. Only
 * checked while `enabled` (offline), since online everything is available.
 */
export function useCachedUrls(urls: string[], enabled: boolean): Set<string> {
    const [cached, setCached] = useState<Set<string>>(() => new Set());
    const signature = urls.join("\n");

    useEffect(() => {
        if (!enabled || !("caches" in window)) return;
        let cancelled = false;
        Promise.all(
            signature
                .split("\n")
                .filter(Boolean)
                .map(async (url) =>
                    (await caches.match(url).catch(() => undefined))
                        ? url
                        : null,
                ),
        ).then((hits) => {
            if (!cancelled)
                setCached(new Set(hits.filter((u): u is string => !!u)));
        });
        return () => {
            cancelled = true;
        };
    }, [signature, enabled]);

    return cached;
}
