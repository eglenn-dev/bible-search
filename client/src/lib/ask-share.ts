// Sharing an Ask answer: the question, the answer and the passages it cites,
// as a link (`/#ask=v1.<data>`) or as plain text. Like a shared collection
// (see share.ts), the link carries everything in the URL hash: answers aren't
// stored on the server, so there's nothing to look up, and the hash never
// reaches it.
//
// A link is untrusted. Anyone can write one, so the decoder caps every size,
// rebuilds passages through share.ts's `fromWire` (which drops any link that
// isn't a churchofjesuschrist.org / speeches.byu.edu page), and the page that
// shows it says it was shared, not answered here.

import type { AskSegment } from "./ask";
import { headingFor } from "./result-display";
import {
    MAX_SHARE_URL_LENGTH,
    ShareError,
    fromWire,
    packToken,
    toWire,
    unpackToken,
    type WireEntry,
} from "./share";
import type { Result } from "./types";

/** Hash key: `#ask=…`. */
export const ASK_SHARE_HASH_KEY = "ask";

/** What an answer is made of, on screen and in a link. */
export interface SharedAnswer {
    question: string;
    segments: AskSegment[];
    /** Cited passages by citation number. */
    citations: Record<number, Result>;
}

/** On the wire: `a` is [text, citation numbers] per run of text. */
interface WireAnswer {
    q: string;
    a: [string, number[]][];
    p: (WireEntry & { n: number })[];
}

// When the whole answer won't fit in a link, passages are cut to this many
// characters; the recipient still has each one's link to the full text.
const TRIMMED_PASSAGE_CHARS = 400;

// Decoder limits, looser than what Ask produces (a 500-character question,
// at most 24 passages, an answer of a few thousand words).
const MAX_QUESTION_LENGTH = 1_000;
const MAX_SEGMENTS = 500;
const MAX_ANSWER_LENGTH = 40_000;
const MAX_CITES_PER_SEGMENT = 30;
const MAX_PASSAGES = 60;
const MAX_CITATION_NUMBER = 200;

function trimText(text: string, max: number): string {
    if (text.length <= max) return text;
    // Cut at a word boundary where there's one nearby.
    const cut = text.slice(0, max);
    const space = cut.lastIndexOf(" ");
    return `${(space > max * 0.8 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

function toWireAnswer(answer: SharedAnswer, passageChars?: number): WireAnswer {
    return {
        q: answer.question,
        a: answer.segments.map((s) => [s.text, s.cites]),
        p: Object.entries(answer.citations).map(([n, passage]) => {
            const entry = toWire(passage);
            if (passageChars) entry.x = trimText(entry.x, passageChars);
            return { n: Number(n), ...entry };
        }),
    };
}

const urlFor = (origin: string, token: string) =>
    `${origin}/#${ASK_SHARE_HASH_KEY}=${token}`;

/**
 * Full share link for an answer, rooted at `origin`. Passages are shortened
 * if that's what it takes to fit; throws a "too-long" ShareError if even that
 * doesn't.
 */
export async function buildAnswerShareUrl(
    answer: SharedAnswer,
    origin: string,
): Promise<string> {
    const full = urlFor(origin, await packToken(toWireAnswer(answer)));
    if (full.length <= MAX_SHARE_URL_LENGTH) return full;
    const trimmed = urlFor(
        origin,
        await packToken(toWireAnswer(answer, TRIMMED_PASSAGE_CHARS)),
    );
    if (trimmed.length <= MAX_SHARE_URL_LENGTH) return trimmed;
    throw new ShareError(
        "too-long",
        "This answer is too long to fit in a link. Copy it as text instead.",
    );
}

const invalid = () =>
    new ShareError("invalid", "The link is incomplete or damaged.");

/** Reverses buildAnswerShareUrl's token, treating it as hostile. */
export async function decodeAnswer(token: string): Promise<SharedAnswer> {
    const payload = await unpackToken(token, "answer");
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
        throw invalid();
    }
    const { q, a, p } = payload as Record<string, unknown>;
    if (typeof q !== "string" || !q.trim() || !Array.isArray(a) || !Array.isArray(p)) {
        throw invalid();
    }
    if (
        q.length > MAX_QUESTION_LENGTH ||
        a.length > MAX_SEGMENTS ||
        p.length > MAX_PASSAGES
    ) {
        throw new ShareError("too-large", "This answer is too large to open.");
    }

    const citations: Record<number, Result> = {};
    for (const entry of p) {
        const n = (entry as { n?: unknown } | null)?.n;
        if (
            typeof n !== "number" ||
            !Number.isInteger(n) ||
            n < 1 ||
            n > MAX_CITATION_NUMBER ||
            citations[n]
        ) {
            continue;
        }
        const passage = fromWire(entry);
        if (passage) citations[n] = passage;
    }

    let length = 0;
    const segments: AskSegment[] = [];
    for (const item of a) {
        if (!Array.isArray(item) || typeof item[0] !== "string") throw invalid();
        const text = item[0];
        length += text.length;
        if (length > MAX_ANSWER_LENGTH) {
            throw new ShareError("too-large", "This answer is too large to open.");
        }
        const cites = Array.isArray(item[1])
            ? [...new Set(item[1])]
                  .slice(0, MAX_CITES_PER_SEGMENT)
                  // A number with no passage behind it has nothing to open.
                  .filter((n): n is number => typeof n === "number" && !!citations[n])
            : [];
        segments.push({ text, cites });
    }
    if (!segments.some((s) => s.text.trim())) {
        throw new ShareError("empty", "There's no answer in this link.");
    }
    return { question: q.trim(), segments, citations };
}

/** The cited passages in citation order. */
export function sourcesOf(
    citations: Record<number, Result>,
): { n: number; passage: Result }[] {
    return Object.entries(citations)
        .map(([n, passage]) => ({ n: Number(n), passage }))
        .sort((a, b) => a.n - b.n);
}

/**
 * The answer as plain text for messages and notes: the question, the answer
 * with [n] markers, then each source's heading and link.
 */
export function answerToText(answer: SharedAnswer): string {
    const body = answer.segments
        .map(
            (s, i) =>
                (i === 0 ? s.text.trimStart() : s.text) +
                s.cites.map((n) => `[${n}]`).join(""),
        )
        .join("")
        .trim();
    const sources = sourcesOf(answer.citations).map(
        ({ n, passage }) => `[${n}] ${headingFor(passage)}\n${passage.url}`,
    );
    return [
        answer.question,
        body,
        ...(sources.length ? [`Sources\n${sources.join("\n")}`] : []),
        "Written by AI on Gospel Help from the sources above. It can get things wrong, so read the sources.",
    ].join("\n\n");
}
