import type { Result } from "./types";

// Ask mode: POST /ask streams one cited answer as server-sent events (see
// api/ask.py for the event list). POST, so the service worker never caches it.

/** A run of answer text and the citation numbers it ends with. */
export interface AskSegment {
    text: string;
    cites: number[];
}

export interface AskQuota {
    hourLeft: number;
    dayLeft: number;
}

export interface AskHandlers {
    onQuota: (quota: AskQuota) => void;
    onSearch: (query: string) => void;
    /** The answer so far; replaced whole on every change. */
    onAnswer: (segments: AskSegment[]) => void;
    /** A passage cited for the first time, as citation number `n`. */
    onCitation: (n: number, passage: Result) => void;
    /**
     * The answer so far was a draft written before another search: drop its
     * citations too. Numbering starts again at 1, and each passage comes
     * again with its first citation.
     */
    onReset: () => void;
}

export const MAX_QUESTION_CHARS = 500;

/** Why Ask won't take a question from this user right now, and until when. */
export interface AskClosed {
    code: "budget" | "hourly_limit" | "daily_limit" | "unavailable";
    /** When it lifts; null when the API didn't say (Ask switched off). */
    resetAt: Date | null;
}

/** A question refused by a limit, not a failure: explain it, don't retry. */
export class AskClosedError extends Error {
    closed: AskClosed;
    constructor(closed: AskClosed, message: string) {
        super(message);
        this.closed = closed;
    }
}

const CLOSED_CODES = new Set<string>([
    "budget",
    "hourly_limit",
    "daily_limit",
    "unavailable",
]);

function closedFrom(body: Record<string, unknown> | null): AskClosed | null {
    const code = body?.code;
    if (typeof code !== "string" || !CLOSED_CODES.has(code)) return null;
    const reset =
        typeof body?.reset_at === "string" ? new Date(body.reset_at) : null;
    return {
        code: code as AskClosed["code"],
        resetAt: reset && !Number.isNaN(reset.getTime()) ? reset : null,
    };
}

export interface AskStatus {
    closed: AskClosed | null;
    quota: AskQuota;
}

/**
 * Whether this user can ask right now, without using a question. Null when
 * the check fails; the box then stays open and a refused question explains
 * itself instead.
 */
export async function fetchAskStatus(
    signal?: AbortSignal,
): Promise<AskStatus | null> {
    try {
        const response = await fetch(
            `${import.meta.env.VITE_API_DOMAIN}/ask/status`,
            { signal },
        );
        if (!response.ok) return null;
        const body = await response.json();
        return {
            closed: body.available ? null : closedFrom(body),
            quota: {
                hourLeft: Number(body.hour_left ?? 0),
                dayLeft: Number(body.day_left ?? 0),
            },
        };
    } catch {
        return null;
    }
}

const dayStart = (d: Date) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "at 6:00 PM", "tomorrow at 9:00 AM": a reset time in the user's zone. */
export function resetPhrase(resetAt: Date, now = new Date()): string {
    const time = new Intl.DateTimeFormat(undefined, {
        hour: "numeric",
        minute: "2-digit",
    }).format(resetAt);
    const days = Math.round((dayStart(resetAt) - dayStart(now)) / 86_400_000);
    if (days <= 0) return `at ${time}`;
    if (days === 1) return `tomorrow at ${time}`;
    const weekday = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
    }).format(resetAt);
    return `on ${weekday} at ${time}`;
}

/** The heading and sentence the Ask tab shows while it's closed. */
export function closedMessage(closed: AskClosed): {
    title: string;
    body: string;
} {
    const when = closed.resetAt ? resetPhrase(closed.resetAt) : null;
    switch (closed.code) {
        case "budget":
            return {
                title: "Ask is resting for today.",
                body: `It has answered as many questions as it can for now${
                    when ? ` and will be back ${when}` : ""
                }. Search still works in the meantime.`,
            };
        case "daily_limit":
            return {
                title: "You’ve used today’s questions.",
                body: `You can ask again ${when ?? "tomorrow"}. Search still works in the meantime.`,
            };
        case "hourly_limit":
            return {
                title: "That’s a lot of questions for one hour.",
                body: `You can ask again ${when ?? "soon"}. Search still works in the meantime.`,
            };
        default:
            return {
                title: "Ask isn’t available right now.",
                body: "Search still works in the meantime.",
            };
    }
}

/**
 * Ask one question and stream the answer into `handlers`. Resolves when the
 * answer is complete; rejects with a readable message otherwise, or with an
 * `AskClosedError` when a quota or the day's budget refused the question.
 */
export async function streamAsk(
    question: string,
    handlers: AskHandlers,
    signal: AbortSignal,
): Promise<void> {
    let response: Response;
    try {
        response = await fetch(`${import.meta.env.VITE_API_DOMAIN}/ask`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question }),
            signal,
        });
    } catch (error) {
        if (signal.aborted) throw error;
        throw new Error(
            navigator.onLine
                ? "Couldn’t reach Ask. Check your connection and try again."
                : "You’re offline. Ask needs a connection.",
        );
    }
    if (!response.ok || !response.body) {
        let body: Record<string, unknown> | null = null;
        try {
            body = await response.json();
        } catch {
            // not JSON
        }
        const closed = closedFrom(body);
        const detail = body?.detail;
        if (closed)
            throw new AskClosedError(
                closed,
                typeof detail === "string" ? detail : "",
            );
        throw new Error(
            typeof detail === "string" && detail
                ? detail
                : "Ask couldn’t answer right now. Try again later.",
        );
    }

    let segments: AskSegment[] = [];
    const current = (): AskSegment => {
        if (!segments.length) segments = [{ text: "", cites: [] }];
        return segments[segments.length - 1];
    };
    let finished = false;

    const handle = (event: string, data: Record<string, unknown>) => {
        switch (event) {
            case "meta":
                handlers.onQuota({
                    hourLeft: Number(data.hour_left),
                    dayLeft: Number(data.day_left),
                });
                break;
            case "search":
                handlers.onSearch(String(data.query ?? ""));
                break;
            case "block":
                segments = [...segments, { text: "", cites: [] }];
                break;
            case "cite": {
                const n = Number(data.n);
                if (data.passage)
                    handlers.onCitation(n, data.passage as Result);
                const seg = current();
                if (!seg.cites.includes(n)) {
                    segments = [
                        ...segments.slice(0, -1),
                        { ...seg, cites: [...seg.cites, n] },
                    ];
                    handlers.onAnswer(segments);
                }
                break;
            }
            case "text": {
                const seg = current();
                segments = [
                    ...segments.slice(0, -1),
                    { ...seg, text: seg.text + String(data.text ?? "") },
                ];
                handlers.onAnswer(segments);
                break;
            }
            case "reset":
                segments = [];
                handlers.onAnswer(segments);
                handlers.onReset();
                break;
            case "done":
                finished = true;
                break;
            case "error":
                throw new Error(String(data.message ?? "Ask hit a problem."));
        }
    };

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            let event = "message";
            let data = "";
            for (const line of frame.split("\n")) {
                if (line.startsWith("event: ")) event = line.slice(7);
                else if (line.startsWith("data: ")) data += line.slice(6);
            }
            handle(event, data ? JSON.parse(data) : {});
        }
    }
    if (!finished)
        throw new Error("The answer was cut off. Try asking again.");
}
