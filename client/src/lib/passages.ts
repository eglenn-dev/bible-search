import type { PassageContext, Result, ResultCount, Source } from "./types";

// Requests that start from one passage (by its stable API id) rather than from
// a query: "More like this" and its surrounding context.

// "More like this": passages similar to the one with this id (any source). The
// seed comes back too, so a shared or reloaded ?similar= link can say what the
// results are similar to.
export async function runSimilar(params: {
    id: string;
    resultCount: ResultCount;
    sources: Source[];
}): Promise<{ seed: Result; results: Result[] }> {
    const { id, resultCount, sources } = params;
    const response = await fetch(
        `${import.meta.env.VITE_API_DOMAIN}/search/similar?id=${encodeURIComponent(
            id,
        )}&k=${resultCount}${sources.length ? `&sources=${sources.join(",")}` : ""}`,
    );
    if (!response.ok) throw new Error("Failed to fetch similar passages.");
    const data = await response.json();
    return {
        // The seed is a passage, not a hit; it has no score of its own.
        seed: { ...data.seed, score: 1 } as Result,
        results: (data.results as Result[]) || [],
    };
}

// Surrounding verses / paragraphs never change, so each passage's context is
// fetched once per visit; collapsing and re-expanding is instant.
const contextCache = new Map<string, Promise<PassageContext>>();

export function fetchPassageContext(id: string): Promise<PassageContext> {
    let pending = contextCache.get(id);
    if (!pending) {
        pending = fetch(
            `${import.meta.env.VITE_API_DOMAIN}/passage/context?id=${encodeURIComponent(
                id,
            )}&before=2&after=2`,
        ).then((response) => {
            if (!response.ok) throw new Error("Failed to fetch context.");
            return response.json() as Promise<PassageContext>;
        });
        // A failure shouldn't stick: drop it so the next expand retries.
        pending.catch(() => contextCache.delete(id));
        contextCache.set(id, pending);
    }
    return pending;
}
