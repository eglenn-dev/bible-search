import type { Result, Source } from "./types";
import { dateLabelFor } from "./result-date";

// How a result is titled and captioned, shared by the desktop result list and
// the mobile cards so the two never drift apart.

export const SOURCE_LABELS: Record<Source, string> = {
    bible: "Bible",
    "book-of-mormon": "Book of Mormon",
    "doctrine-and-covenants": "D&C",
    "pearl-of-great-price": "Pearl of Great Price",
    conference: "Conference",
    "byu-speeches": "BYU Speeches",
    handbook: "Handbook",
};

// Sources whose results are scripture verses (heading = reference, subtitle = volume).
const SCRIPTURE_SOURCES: Source[] = [
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
];

export function headingFor(result: Result): string {
    if (SCRIPTURE_SOURCES.includes(result.source)) return result.reference;
    if (result.source === "conference" || result.source === "byu-speeches")
        return result.title || result.reference;
    return result.metadata?.section_title || result.title || result.reference;
}

// Secondary line under the heading (joined with the date label where present).
function subtitleFor(result: Result): string {
    const m = result.metadata || {};
    if (result.source === "conference" || result.source === "byu-speeches") {
        return m.speaker || "";
    }
    if (result.source === "handbook") {
        return [m.chapter, m.section_number].filter(Boolean).join(" · ");
    }
    return m.volume || m.translation || "";
}

/** "Speaker · April 2024", "KJV", … — empty when there is nothing to add. */
export function metaLineFor(result: Result): string {
    return [subtitleFor(result), dateLabelFor(result)]
        .filter(Boolean)
        .join(" · ");
}

/** Relevance as a whole percentage, clamped to 0–100. */
export function scorePercent(result: Result): number {
    return Math.round(Math.max(0, Math.min(1, result.score)) * 100);
}
