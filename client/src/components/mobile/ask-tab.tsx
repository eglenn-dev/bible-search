import { useEffect, useRef, useState } from "react";
import {
    ArrowUp,
    Clock,
    MessageCircleQuestionMark,
    RotateCcw,
    Search as SearchIcon,
    Square,
    WifiOff,
} from "lucide-react";
import type { Result } from "@/lib/types";
import {
    AskClosedError,
    MAX_QUESTION_CHARS,
    closedMessage,
    fetchAskStatus,
    streamAsk,
    type AskClosed,
    type AskQuota,
    type AskSegment,
} from "@/lib/ask";
import { isSaved } from "@/lib/bookmarks";
import { headingFor } from "@/lib/result-display";
import { cn } from "@/lib/utils";
import ResultCard from "./result-card";

interface AskTabProps {
    /** The Ask tab is the one showing (it stays mounted when it isn't). */
    active: boolean;
    online: boolean;
    savedIds: Set<string>;
    /** Whether a passage is the one showing in the split view's pane. */
    isOpen: (result: Result) => boolean;
    onOpen: (result: Result) => void;
    onToggleSaved: (result: Result) => void;
    /** Switch to the Search tab, offered while Ask is closed. */
    onSearchInstead: () => void;
}

type Status = "idle" | "running" | "done" | "error";

const EXAMPLES = [
    "How can I keep my faith when I have doubts?",
    "What do the scriptures teach about grace?",
    "What has President Nelson taught about the gathering of Israel?",
    "Why do we partake of the sacrament each week?",
];

/**
 * Ask: one question, one answer drawn from the corpora with numbered
 * citations. Each number opens its passage the way a search result does.
 * Not a chat; a new question replaces the last answer.
 */
export default function AskTab({
    active,
    online,
    savedIds,
    isOpen,
    onOpen,
    onToggleSaved,
    onSearchInstead,
}: AskTabProps) {
    const [draft, setDraft] = useState("");
    const [asked, setAsked] = useState<string | null>(null);
    const [status, setStatus] = useState<Status>("idle");
    const [searches, setSearches] = useState<string[]>([]);
    const [segments, setSegments] = useState<AskSegment[]>([]);
    const [citations, setCitations] = useState<Record<number, Result>>({});
    const [error, setError] = useState<string | null>(null);
    const [quota, setQuota] = useState<AskQuota | null>(null);
    // A limit (the day's budget, or this user's quota) that keeps the box
    // closed until it lifts.
    const [closed, setClosed] = useState<AskClosed | null>(null);
    const [statusCheck, setStatusCheck] = useState(0);
    const abortRef = useRef<AbortController | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    // Stop a running answer if the app goes away.
    useEffect(() => () => abortRef.current?.abort(), []);

    // Each time the tab opens, check the limits before anyone types.
    useEffect(() => {
        if (!active || !online) return;
        const controller = new AbortController();
        void fetchAskStatus(controller.signal).then((result) => {
            if (!result || controller.signal.aborted) return;
            setClosed(result.closed);
            setQuota(result.quota);
        });
        return () => controller.abort();
    }, [active, online, statusCheck]);

    // Reopen when the limit lifts, then confirm with a fresh check.
    useEffect(() => {
        if (!closed?.resetAt) return;
        const timer = setTimeout(
            () => {
                setClosed(null);
                setStatusCheck((n) => n + 1);
            },
            Math.max(0, closed.resetAt.getTime() - Date.now()) + 2000,
        );
        return () => clearTimeout(timer);
    }, [closed]);

    const running = status === "running";
    const question = draft.trim();
    const canAsk = online && !closed && !running && question.length >= 3;
    const notice = closed && closedMessage(closed);

    const ask = async (text: string) => {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        inputRef.current?.blur();
        window.scrollTo({ top: 0, behavior: "smooth" });
        // The question moves from the field to the answer's heading.
        setDraft("");
        setAsked(text);
        setStatus("running");
        setSearches([]);
        setSegments([]);
        setCitations({});
        setError(null);
        try {
            await streamAsk(
                text,
                {
                    onQuota: setQuota,
                    onSearch: (q) => setSearches((prev) => [...prev, q]),
                    onAnswer: setSegments,
                    onCitation: (n, passage) =>
                        setCitations((prev) => ({ ...prev, [n]: passage })),
                },
                controller.signal,
            );
            if (!controller.signal.aborted) setStatus("done");
        } catch (err) {
            if (controller.signal.aborted) return;
            if (err instanceof AskClosedError) {
                // Not an error: close the box, and keep the question for
                // when Ask opens again.
                setClosed(err.closed);
                setAsked(null);
                setStatus("idle");
                setDraft(text);
                return;
            }
            setError(
                err instanceof Error ? err.message : "Ask hit a problem.",
            );
            setStatus("error");
        }
    };

    const stop = () => {
        abortRef.current?.abort();
        setStatus(segments.length ? "done" : "idle");
        if (!segments.length) {
            // Nothing to keep: put the question back to edit or re-ask.
            setDraft(asked ?? "");
            setAsked(null);
        }
    };

    const reset = () => {
        abortRef.current?.abort();
        setAsked(null);
        setStatus("idle");
        setSearches([]);
        setSegments([]);
        setCitations({});
        setError(null);
        setDraft("");
        inputRef.current?.focus();
    };

    const submit = (event?: React.FormEvent) => {
        event?.preventDefault();
        if (canAsk) void ask(question);
    };

    const sources = Object.entries(citations)
        .map(([n, passage]) => ({ n: Number(n), passage }))
        .sort((a, b) => a.n - b.n);
    const hasAnswer = segments.some((s) => s.text.trim());

    return (
        <div className="px-4 pt-[env(safe-area-inset-top)]">
            <div className="gs-fade pt-5">
                <h1 className="font-display text-[34px] font-semibold leading-tight text-foreground">
                    Ask
                </h1>
                <p className="mt-1 text-[15px] text-muted-foreground">
                    Answers from scripture, conference and more, with every
                    source cited
                </p>
            </div>

            <form
                onSubmit={submit}
                className="glass mt-4 flex items-end gap-2 rounded-[26px] py-1.5 pl-4 pr-1.5 transition-shadow focus-within:ring-2 focus-within:ring-primary/45"
            >
                {/* 17px: iOS zooms the page when a focused input is under 16px. */}
                <textarea
                    ref={inputRef}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            submit();
                        }
                    }}
                    rows={2}
                    disabled={!!closed}
                    maxLength={MAX_QUESTION_CHARS}
                    enterKeyHint="send"
                    placeholder="Ask a gospel question…"
                    aria-label="Your question"
                    className="max-h-40 min-h-[44px] min-w-0 flex-1 resize-none border-none bg-transparent py-2 text-[17px] leading-snug text-foreground outline-none [field-sizing:content] disabled:opacity-50"
                />
                {running ? (
                    <button
                        type="button"
                        onClick={stop}
                        aria-label="Stop"
                        className="mb-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-full bg-foreground/[0.12] text-foreground transition-transform active:scale-90"
                    >
                        <Square className="h-4 w-4" fill="currentColor" />
                    </button>
                ) : (
                    <button
                        type="submit"
                        aria-label="Ask"
                        disabled={!canAsk}
                        className="mb-0.5 flex h-10 w-10 flex-none items-center justify-center rounded-full bg-primary text-primary-foreground transition-transform active:scale-90 disabled:opacity-50"
                    >
                        <ArrowUp className="h-5 w-5" strokeWidth={2.5} />
                    </button>
                )}
            </form>
            <div className="flex justify-between px-2 pt-1.5 text-[13px] text-muted-foreground">
                <span>
                    {quota &&
                        !closed &&
                        (quota.dayLeft === 1
                            ? "1 question left today"
                            : `${quota.dayLeft} questions left today`)}
                </span>
                {draft.length > MAX_QUESTION_CHARS - 80 && (
                    <span className="tabular-nums">
                        {draft.length}/{MAX_QUESTION_CHARS}
                    </span>
                )}
            </div>

            {!online && (
                <div
                    role="status"
                    className="gs-fade mt-3 flex items-start gap-3 rounded-[22px] border border-border/70 bg-[var(--app-card)] px-4 py-3.5"
                >
                    <WifiOff className="mt-0.5 h-5 w-5 flex-none text-primary" />
                    <p className="text-[15px] leading-snug text-muted-foreground">
                        <span className="font-semibold text-foreground">
                            You’re offline.
                        </span>{" "}
                        Ask needs a connection to read and answer.
                    </p>
                </div>
            )}

            {online && notice && (
                <div
                    role="status"
                    className="gs-fade mt-3 rounded-[22px] border border-border/70 bg-[var(--app-card)] px-4 py-3.5"
                >
                    <div className="flex items-start gap-3">
                        <Clock className="mt-0.5 h-5 w-5 flex-none text-primary" />
                        <p className="text-[15px] leading-snug text-muted-foreground">
                            <span className="font-semibold text-foreground">
                                {notice.title}
                            </span>{" "}
                            {notice.body}
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onSearchInstead}
                        className="ml-8 mt-2.5 flex h-10 items-center gap-1.5 rounded-full bg-foreground/[0.08] px-4 text-[15px] font-semibold text-primary transition-transform active:scale-95"
                    >
                        <SearchIcon className="h-4 w-4" />
                        Search instead
                    </button>
                </div>
            )}

            {asked === null ? (
                <section className="gs-fade mt-4">
                    <h2 className="mb-2.5 px-1 font-sans text-[20px] font-semibold text-foreground">
                        Try asking
                    </h2>
                    <div className="overflow-hidden rounded-[22px] border border-border/70 bg-[var(--app-card)]">
                        {EXAMPLES.map((example, i) => (
                            <button
                                key={example}
                                type="button"
                                disabled={!online || !!closed}
                                onClick={() => void ask(example)}
                                className={cn(
                                    "flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left text-[16px] text-foreground transition-colors active:bg-foreground/[0.06] disabled:opacity-50",
                                    i > 0 && "border-t border-border/60",
                                )}
                            >
                                <MessageCircleQuestionMark className="h-5 w-5 flex-none text-primary" />
                                {example}
                            </button>
                        ))}
                    </div>
                    <p className="mt-3 px-1 text-[13px] leading-snug text-muted-foreground">
                        Ask searches the library a few times, then answers
                        only from what it found. Tap a number in the answer to
                        read the passage it came from.
                    </p>
                </section>
            ) : (
                <section className="mt-4" aria-live="polite" aria-busy={running}>
                    <p className="px-1 font-display text-[22px] font-semibold leading-snug text-foreground">
                        {asked}
                    </p>

                    {searches.length > 0 && (
                        <ul className="mt-3 flex flex-wrap gap-1.5 px-1">
                            {searches.map((q, i) => (
                                <li
                                    key={`${q}-${i}`}
                                    className="gs-fade flex max-w-full items-center gap-1.5 rounded-full bg-foreground/[0.07] px-3 py-1 text-[13px] text-muted-foreground"
                                >
                                    <SearchIcon className="h-3.5 w-3.5 flex-none" />
                                    <span className="truncate">{q}</span>
                                </li>
                            ))}
                        </ul>
                    )}

                    {running && !hasAnswer && (
                        <div className="mt-4 flex items-center gap-2.5 px-1 text-[15px] text-muted-foreground">
                            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/30 border-t-primary" />
                            {searches.length ? "Reading the passages…" : "Searching…"}
                        </div>
                    )}

                    {hasAnswer && (
                        <div className="gs-fade mt-4 rounded-[22px] border border-border/70 bg-[var(--app-card)] p-4">
                            <p className="select-text whitespace-pre-line font-display text-[18px] leading-relaxed text-foreground">
                                {segments.map((segment, i) => (
                                    <span key={i}>
                                        {i === 0
                                            ? segment.text.trimStart()
                                            : segment.text}
                                        {segment.cites.map((n) => {
                                            const passage = citations[n];
                                            return (
                                                <button
                                                    key={n}
                                                    type="button"
                                                    disabled={!passage}
                                                    onClick={() =>
                                                        passage && onOpen(passage)
                                                    }
                                                    aria-label={
                                                        passage
                                                            ? `Source ${n}: ${headingFor(passage)}`
                                                            : `Source ${n}`
                                                    }
                                                    className={cn(
                                                        "mx-0.5 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 align-[3px] font-sans text-[12px] font-semibold leading-none transition-transform active:scale-90",
                                                        passage && isOpen(passage)
                                                            ? "bg-primary text-primary-foreground"
                                                            : "bg-primary/[0.14] text-primary",
                                                    )}
                                                >
                                                    {n}
                                                </button>
                                            );
                                        })}
                                    </span>
                                ))}
                                {running && (
                                    <span
                                        aria-hidden="true"
                                        className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-primary align-[-2px]"
                                    />
                                )}
                            </p>
                        </div>
                    )}

                    {error && (
                        <div
                            role="alert"
                            className="mt-4 rounded-[22px] border border-border/70 bg-[var(--app-card)] px-4 py-3.5"
                        >
                            <p className="text-[15px] leading-snug text-destructive">
                                {error}
                            </p>
                            {online && (
                                <button
                                    type="button"
                                    onClick={() => void ask(asked)}
                                    className="mt-2 flex items-center gap-1.5 text-[15px] font-semibold text-primary"
                                >
                                    <RotateCcw className="h-4 w-4" />
                                    Try again
                                </button>
                            )}
                        </div>
                    )}

                    {hasAnswer && !running && (
                        <p className="mt-2.5 px-1 text-[13px] leading-snug text-muted-foreground">
                            Written by AI from the passages below. It can get
                            things wrong, so read the sources.
                        </p>
                    )}

                    {sources.length > 0 && (
                        <section className="mt-5">
                            <h2 className="mb-2.5 px-1 font-sans text-[20px] font-semibold text-foreground">
                                Sources
                            </h2>
                            <div className="flex flex-col gap-3">
                                {sources.map(({ n, passage }) => (
                                    <ResultCard
                                        key={n}
                                        marker={n}
                                        result={passage}
                                        saved={isSaved(savedIds, passage)}
                                        selected={isOpen(passage)}
                                        onOpen={() => onOpen(passage)}
                                        onToggleSaved={() =>
                                            onToggleSaved(passage)
                                        }
                                    />
                                ))}
                            </div>
                        </section>
                    )}

                    {!running && (
                        <div className="mt-5 flex justify-center">
                            <button
                                type="button"
                                onClick={reset}
                                className="glass h-12 rounded-full px-6 text-[15px] font-semibold text-primary transition-transform active:scale-95"
                            >
                                Ask another question
                            </button>
                        </div>
                    )}
                </section>
            )}
        </div>
    );
}
