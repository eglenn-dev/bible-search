import { useEffect, useState } from "react";
import type { SearchFilters, SpeakerOption } from "./types";

// GET /speakers changes only when new talks are ingested, so it's fetched at
// most once per page load and shared by every picker (sidebar + mobile sheet).
let speakersPromise: Promise<SpeakerOption[]> | null = null;

function fetchSpeakers(): Promise<SpeakerOption[]> {
    if (!speakersPromise) {
        speakersPromise = fetch(
            `${import.meta.env.VITE_API_DOMAIN}/speakers?variants=false`,
        )
            .then((res) => {
                if (!res.ok) throw new Error("Failed to load speakers.");
                return res.json();
            })
            .then((data) => (data.speakers as SpeakerOption[]) || [])
            .catch((e) => {
                // Let a later picker retry instead of caching the failure.
                speakersPromise = null;
                throw e;
            });
    }
    return speakersPromise;
}

/** The speaker list for the picker; `null` while loading. */
export function useSpeakers(): {
    speakers: SpeakerOption[] | null;
    error: boolean;
} {
    const [speakers, setSpeakers] = useState<SpeakerOption[] | null>(null);
    const [error, setError] = useState(false);

    useEffect(() => {
        let cancelled = false;
        fetchSpeakers()
            .then((list) => {
                if (!cancelled) setSpeakers(list);
            })
            .catch(() => {
                if (!cancelled) setError(true);
            });
        return () => {
            cancelled = true;
        };
    }, []);

    return { speakers, error };
}

// Case- and accent-insensitive form for matching typed text against names
// ("gerald" finds "Gérald Caussé").
export function foldName(s: string): string {
    return s
        .normalize("NFKD")
        .replace(/[̀-ͯ]/g, "")
        .replace(/\./g, "")
        .toLowerCase()
        .trim();
}

/** Speakers whose name contains every typed word, most talks first. */
export function matchSpeakers(
    speakers: SpeakerOption[],
    text: string,
    limit = 50,
): SpeakerOption[] {
    const words = foldName(text).split(/\s+/).filter(Boolean);
    if (!words.length) return speakers.slice(0, limit);
    const out: SpeakerOption[] = [];
    for (const s of speakers) {
        const name = foldName(s.name);
        if (words.every((w) => name.includes(w))) {
            out.push(s);
            if (out.length >= limit) break;
        }
    }
    return out;
}

export function hasFilters(filters: SearchFilters): boolean {
    return (
        !!filters.speaker || filters.yearFrom !== null || filters.yearTo !== null
    );
}

/** "2010–2020", "2010 or later", "Up to 2020" — or null when unbounded. */
export function yearRangeLabel(filters: SearchFilters): string | null {
    const { yearFrom: from, yearTo: to } = filters;
    if (from !== null && to !== null)
        return from === to ? String(from) : `${from}–${to}`;
    if (from !== null) return `${from} or later`;
    if (to !== null) return `Up to ${to}`;
    return null;
}

/** "1974–2025" (or a single year) for a speaker's talks. */
export function yearSpan(s: SpeakerOption): string {
    if (s.first_year === null) return "";
    if (s.last_year === null || s.last_year === s.first_year)
        return String(s.first_year);
    return `${s.first_year}–${s.last_year}`;
}
