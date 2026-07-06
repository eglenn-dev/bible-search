import type { Result, Source, ResultCount } from "./types";

// Single source of truth for issuing a search request. Both input boxes and the
// "Load more results" button call this so they all hit the exact same request
// shape (natural-language `/search` vs. scripture `/search/by-reference`).
export async function runSearch(params: {
    queryType: "natural" | "scripture";
    query: string; // natural-language text OR scripture reference
    resultCount: ResultCount;
    sources: Source[];
}): Promise<Result[]> {
    const { queryType, query, resultCount, sources } = params;
    const sourcesParam = sources.length ? `&sources=${sources.join(",")}` : "";
    const base = import.meta.env.VITE_API_DOMAIN;
    const url =
        queryType === "scripture"
            ? `${base}/search/by-reference?reference=${encodeURIComponent(
                  query.trim(),
              )}&k=${resultCount}${sourcesParam}`
            : `${base}/search?query=${encodeURIComponent(
                  query,
              )}&k=${resultCount}${sourcesParam}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error("Failed to fetch results.");
    const data = await response.json();
    return (data.results as Result[]) || [];
}
