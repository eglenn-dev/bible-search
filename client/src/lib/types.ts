export type Source =
    | "bible"
    | "book-of-mormon"
    | "doctrine-and-covenants"
    | "pearl-of-great-price"
    | "conference"
    | "handbook";

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
    // handbook
    section_title?: string;
    section_number?: string | null;
    anchor?: string;
    chapter_uri?: string;
    [key: string]: unknown;
}

export interface Result {
    source: Source;
    reference: string;
    text: string;
    title?: string | null;
    url: string;
    score: number;
    metadata?: ResultMetadata;
}

export interface BibleVerse {
    reference: string;
    text: string;
}
