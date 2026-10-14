export type Source =
    | "bible"
    | "book-of-mormon"
    | "doctrine-and-covenants"
    | "pearl-of-great-price"
    | "conference"
    | "byu-speeches"
    | "handbook";

// Result ordering: by semantic relevance (server ranking) or newest-first.
export type SortKey = "relevance" | "date";

// How many results to request (the API caps k at 50).
export const RESULT_COUNTS = [10, 20, 30, 40, 50] as const;
export type ResultCount = (typeof RESULT_COUNTS)[number];
export const DEFAULT_RESULT_COUNT: ResultCount = 20;

// Canonical list of valid source keys — used to validate URL-supplied filters.
export const SOURCES: Source[] = [
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
    "conference",
    "byu-speeches",
    "handbook",
];

export interface ResultMetadata {
    // scriptures (bible + other standard works)
    book?: string;
    chapter?: number | string;
    verse?: number;
    testament?: string;
    translation?: string;
    volume?: string;
    // conference
    speaker?: string | null;
    calling?: string | null;
    year?: number;
    month?: string;
    talk_uri?: string;
    paragraph_id?: string;
    // conference + handbook: reading order within the talk/chapter
    chunk_index?: number;
    // byu-speeches
    position?: string | null;
    date?: string | null;
    speech_path?: string;
    paragraph_index?: number;
    // handbook
    section_title?: string;
    section_number?: string | null;
    anchor?: string;
    chapter_uri?: string;
    [key: string]: unknown;
}

export interface Result {
    /** Stable document id from the API. Absent on bookmarks saved before the
     *  API returned one. */
    id?: string;
    source: Source;
    reference: string;
    text: string;
    title?: string | null;
    url: string;
    score: number;
    metadata?: ResultMetadata;
}

/** One passage of a /passage/context response. */
export interface ContextPassage extends Omit<Result, "score" | "id"> {
    id: string;
    is_target: boolean;
}

export interface PassageContext {
    id: string;
    /** The passage and its neighbours, in reading order. */
    passages: ContextPassage[];
    more_before: boolean;
    more_after: boolean;
    /** Why the context is narrower than asked, when it is. */
    note: string | null;
}

export interface BibleVerse {
    reference: string;
    text: string;
}
