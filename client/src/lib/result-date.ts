import type { Result, SortKey } from "./types";

const MONTHS: Record<string, string> = { "04": "April", "10": "October" };

// Human-readable date for a result card, or "" for undated sources
// (scriptures, handbook).
export function dateLabelFor(result: Result): string {
    const m = result.metadata || {};
    if (result.source === "conference") {
        if (m.year && m.month) return `${MONTHS[m.month] || m.month} ${m.year}`;
        return m.year ? String(m.year) : "";
    }
    if (result.source === "byu-speeches") {
        return m.date || (m.year ? String(m.year) : "");
    }
    return "";
}

// Sortable timestamp (ms) for "newest first"; null for undated sources so they
// can be pushed below dated results without disturbing their relevance order.
export function dateKeyFor(result: Result): number | null {
    const m = result.metadata || {};
    if (result.source === "conference" && m.year) {
        // Conferences are held in April ("04") and October ("10").
        const monthIndex = m.month ? parseInt(m.month, 10) - 1 : 0;
        return Date.UTC(m.year, monthIndex, 1);
    }
    if (result.source === "byu-speeches") {
        if (m.date) {
            const parsed = Date.parse(m.date);
            if (!Number.isNaN(parsed)) return parsed;
        }
        if (m.year) return Date.UTC(m.year, 0, 1);
    }
    return null;
}

// Re-order results for display. "relevance" keeps the server's ranking;
// "date" sorts dated passages newest-first and leaves undated ones (in their
// relevance order) at the end. Array.sort is stable, so ties are preserved.
export function sortResults(results: Result[], sortBy: SortKey): Result[] {
    if (sortBy !== "date") return results;
    return [...results].sort((a, b) => {
        const ka = dateKeyFor(a);
        const kb = dateKeyFor(b);
        if (ka === null && kb === null) return 0;
        if (ka === null) return 1;
        if (kb === null) return -1;
        return kb - ka;
    });
}
