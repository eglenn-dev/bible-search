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
}

export const MAX_QUESTION_CHARS = 500;

/**
 * Ask one question and stream the answer into `handlers`. Resolves when the
 * answer is complete; rejects with a readable message otherwise (including
 * quota and budget refusals, which arrive as plain JSON errors).
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
        let detail = "";
        try {
            detail = (await response.json())?.detail ?? "";
        } catch {
            // not JSON
        }
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
