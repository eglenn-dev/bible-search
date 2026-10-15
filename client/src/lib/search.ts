import type { Result, Source, ResultCount, SearchFilters } from "./types";
import { NO_FILTERS } from "./types";
import { addRecentSearch } from "./recent-searches";

export interface SearchParams {
    queryType: "natural" | "scripture";
    query: string; // natural-language text OR scripture reference
    resultCount: ResultCount;
    sources: Source[];
    filters?: SearchFilters;
}

// The request URL for a search. The service worker caches responses by URL,
// so a recent search re-run offline has to rebuild exactly this string.
export function searchUrl(params: SearchParams): string {
    const { queryType, query, resultCount, sources, filters } = params;
    const sourcesParam = sources.length ? `&sources=${sources.join(",")}` : "";
    const base = import.meta.env.VITE_API_DOMAIN;
    return (
        (queryType === "scripture"
            ? `${base}/search/by-reference?reference=${encodeURIComponent(
                  query.trim(),
              )}&k=${resultCount}${sourcesParam}`
            : `${base}/search?query=${encodeURIComponent(
                  query,
              )}&k=${resultCount}${sourcesParam}`) + filtersParam(filters)
    );
}

// Single source of truth for issuing a search request. Both input boxes, the
// "Load more results" button and the recent-searches list call this so they
// all hit the exact same request shape (natural-language `/search` vs.
// scripture `/search/by-reference`).
export async function runSearch(params: SearchParams): Promise<Result[]> {
    const response = await apiFetch(searchUrl(params));
    if (!response.ok) throw await apiError(response, "Failed to fetch results.");
    const data = await response.json();
    addRecentSearch({
        queryType: params.queryType,
        query: params.query,
        resultCount: params.resultCount,
        sources: params.sources,
        filters: params.filters ?? NO_FILTERS,
    });
    return (data.results as Result[]) || [];
}

// `fetch` only rejects when no response arrived at all: offline with nothing
// cached for this request, or the API unreachable. Say which, in words.
export async function apiFetch(url: string): Promise<Response> {
    try {
        return await fetch(url);
    } catch {
        throw new Error(
            navigator.onLine
                ? "Couldn’t reach the search service. Check your connection and try again."
                : "You’re offline. This search isn’t saved on this device yet.",
        );
    }
}

// The API explains filter problems (unknown speaker, filters not yet
// available) in `detail`; surface that instead of a generic message.
export async function apiError(
    response: Response,
    fallback: string,
): Promise<Error> {
    let detail = "";
    try {
        detail = (await response.json())?.detail ?? "";
    } catch {
        // not JSON — fall through to the generic message
    }
    return new Error(typeof detail === "string" && detail ? detail : fallback);
}

export function filtersParam(filters?: SearchFilters): string {
    if (!filters) return "";
    let out = "";
    if (filters.speaker)
        out += `&speaker=${encodeURIComponent(filters.speaker)}`;
    if (filters.yearFrom !== null) out += `&year_from=${filters.yearFrom}`;
    if (filters.yearTo !== null) out += `&year_to=${filters.yearTo}`;
    return out;
}
