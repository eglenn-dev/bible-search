// Types + fetch for the precomputed /stats payload. The shape mirrors what
// `api/ingest/stats.py` writes to the `stats` collection — regenerate that,
// and this page updates on the next load.

export interface SpeakerAgg {
    speaker: string;
    talks: number;
    first: number;
    last: number;
    span: number;
    decades: Record<string, number>;
    avg_words: number;
}

export interface TalkRef {
    title: string;
    speaker: string;
    year: number;
    url: string;
    words?: number;
    sim?: number;
}

export interface TwinPair {
    sim: number;
    a: TalkRef;
    b: TalkRef;
    years_apart: number;
}

export interface Cluster {
    size: number;
    top_words: string[];
    by_decade: Record<string, number>;
    examples: TalkRef[];
}

export interface CitedRef {
    ref: string;
    count: number;
    text?: string;
}

export interface BookCitations {
    book: string;
    count: number;
    volume: string;
}

export interface VerseExtreme {
    ref: string;
    text: string;
    words: number;
}

export interface StatsData {
    procedural_talks: number;
    meta: {
        total_docs: number;
        sources: Record<string, number>;
        talks: number;
        speeches: number;
        conference_speakers: number;
        byu_speakers: number;
        conference_years: [number, number];
        total_words: number;
    };
    prolific: SpeakerAgg[];
    longest_span: SpeakerAgg[];
    wordiest: SpeakerAgg[];
    most_concise: SpeakerAgg[];
    talk_length_by_year: Record<string, number>;
    longest_talks: TalkRef[];
    shortest_talks: TalkRef[];
    callings_by_decade: Record<string, Record<string, number>>;
    women_org_talks_by_year: Record<string, [number, number]>;
    crossover: { speaker: string; conference_talks: number; byu_speeches: number }[];
    crossover_total: number;
    byu_prolific: { speaker: string; speeches: number }[];
    word_trends: Record<string, Record<string, number>>;
    fingerprints: Record<string, { word: string; lift: number; count: number }[]>;
    readability_by_year: Record<string, { avg_sentence_len: number; flesch: number }>;
    top_verses: CitedRef[];
    book_citations: BookCitations[];
    volume_citations: Record<string, number>;
    top_verse_by_decade: Record<string, CitedRef[]>;
    never_cited_books: string[];
    least_cited_books: BookCitations[];
    shortest_verses: VerseExtreme[];
    longest_verses: VerseExtreme[];
    came_to_pass: { by_volume: Record<string, number>; bom_by_book: Record<string, number> };
    biggest_chapters: { chapter: string; verses: number }[];
    verses_by_volume: Record<string, number>;
    most_typical: TalkRef[];
    most_unusual: TalkRef[];
    twins: TwinPair[];
    twins_cross_era: TwinPair[];
    clusters: Cluster[];
    cluster_decade_totals: Record<string, number>;
    verse_echo_strong: CitedRef[];
    verse_echo_mean_sim: number;
}

export interface StatsResponse {
    generated_at: string;
    data: StatsData;
}

export async function fetchStats(): Promise<StatsResponse> {
    const base = import.meta.env.VITE_API_DOMAIN;
    const response = await fetch(`${base}/stats`);
    if (!response.ok) throw new Error("Failed to fetch stats.");
    return (await response.json()) as StatsResponse;
}

export const fmt = new Intl.NumberFormat("en-US");

/** Fixed volume → series-color mapping (identity, not rank). */
export const VOLUME_COLOR: Record<string, string> = {
    "Doctrine and Covenants": "var(--series-1)",
    "New Testament": "var(--series-2)",
    "Book of Mormon": "var(--series-3)",
    "Old Testament": "var(--series-4)",
    "Pearl of Great Price": "var(--series-5)",
};

export function volumeOfRef(ref: string, books: BookCitations[]): string {
    const book = ref.replace(/ \d+:\d+$/, "");
    return books.find((b) => b.book === book)?.volume ?? "Old Testament";
}
