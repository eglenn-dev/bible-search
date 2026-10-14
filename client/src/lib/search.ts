import type { Result, Source, ResultCount, SearchFilters } from "./types";

// Single source of truth for issuing a search request. Both input boxes and the
// "Load more results" button call this so they all hit the exact same request
// shape (natural-language `/search` vs. scripture `/search/by-reference`).
export async function runSearch(params: {
    queryType: "natural" | "scripture";
    query: string; // natural-language text OR scripture reference
    resultCount: ResultCount;
    sources: Source[];
    filters?: SearchFilters;
}): Promise<Result[]> {
    const { queryType, query, resultCount, sources, filters } = params;
    const sourcesParam = sources.length ? `&sources=${sources.join(",")}` : "";
    const base = import.meta.env.VITE_API_DOMAIN;
    const url =
        (queryType === "scripture"
            ? `${base}/search/by-reference?reference=${encodeURIComponent(
                  query.trim(),
              )}&k=${resultCount}${sourcesParam}`
            : `${base}/search?query=${encodeURIComponent(
                  query,
              )}&k=${resultCount}${sourcesParam}`) + filtersParam(filters);
    const response = await fetch(url);
    if (!response.ok) throw await apiError(response, "Failed to fetch results.");
    const data = await response.json();
    return (data.results as Result[]) || [];
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
