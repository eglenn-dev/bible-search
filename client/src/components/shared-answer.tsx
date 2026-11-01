import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageCircleQuestionMark } from "lucide-react";
import { decodeAnswer, sourcesOf, type DecodedAnswer as Answer } from "@/lib/ask-share";
import {
    isSaved,
    savedKeySet,
    toggleBookmark,
    useBookmarks,
} from "@/lib/bookmarks";
import { ShareError } from "@/lib/share";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import AnswerText from "./answer-text";
import PassageItem, { BookmarkToggle } from "./passage-item";
import ThemeToggle from "./theme-toggle";

interface SharedAnswerProps {
    /** The `v1.…` token from `#ask=`. */
    token: string;
    /** Leave the shared view; `toAsk` opens Ask next, to ask your own. */
    onClose: (toAsk: boolean) => void;
}

type State =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; answer: Answer };

const sourceId = (n: number) => `source-${n}`;

/**
 * What someone sees when they open a shared Ask answer: the question, the
 * answer with its numbered citations, and the passages cited. Shown in place
 * of the app for both layouts and before the API is reached, like a shared
 * collection. The link could have been edited, so the page says it was
 * shared rather than presenting it as Gospel Help's own answer.
 */
export default function SharedAnswer({ token, onClose }: SharedAnswerProps) {
    const [state, setState] = useState<State>({ status: "loading" });
    // The source a number was just tapped for, highlighted briefly.
    const [flashed, setFlashed] = useState<number | null>(null);
    const bookmarks = useBookmarks();
    // Every key a saved copy could be under, so a passage saved before ids
    // existed shows as saved (and its toggle removes it, not a second copy).
    const savedKeys = useMemo(() => savedKeySet(bookmarks), [bookmarks]);

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });
        decodeAnswer(token).then(
            (answer) => {
                if (!cancelled) setState({ status: "ready", answer });
            },
            (e: unknown) => {
                if (cancelled) return;
                setState({
                    status: "error",
                    message:
                        e instanceof ShareError
                            ? e.message
                            : "This link couldn't be opened.",
                });
            },
        );
        return () => {
            cancelled = true;
        };
    }, [token]);

    useEffect(() => {
        const previous = document.title;
        document.title = "Shared answer · Gospel Help";
        return () => {
            document.title = previous;
        };
    }, []);

    useEffect(() => {
        if (flashed === null) return;
        const timer = setTimeout(() => setFlashed(null), 1600);
        return () => clearTimeout(timer);
    }, [flashed]);

    // Scrolls rather than linking to `#source-n`, which would replace the
    // `#ask=` hash the page is drawn from.
    const showSource = (n: number) => {
        document
            .getElementById(sourceId(n))
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        setFlashed(n);
    };

    const sources = state.status === "ready" ? sourcesOf(state.answer.citations) : [];

    return (
        <div className="gs-fade flex min-h-screen flex-col">
            <header className="border-b border-border bg-background">
                <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-5 py-4">
                    <button
                        type="button"
                        onClick={() => onClose(false)}
                        className="whitespace-nowrap font-display text-[26px] text-foreground transition-colors hover:text-primary"
                    >
                        Gospel Help
                    </button>
                    <div className="ml-auto">
                        <ThemeToggle compact />
                    </div>
                </div>
            </header>

            <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-5 pb-24 pt-8 md:pt-10">
                <button
                    type="button"
                    onClick={() => onClose(false)}
                    className="mb-5 inline-flex items-center gap-1.5 self-start text-sm text-primary hover:underline"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Go to search
                </button>

                <p className="text-sm font-medium text-muted-foreground">
                    Shared answer from Ask
                </p>

                {state.status === "loading" && (
                    <p className="mt-3 text-muted-foreground">Opening…</p>
                )}

                {state.status === "error" && (
                    <div className="mt-2 max-w-xl">
                        <p className="text-foreground">{state.message}</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Ask whoever sent it to copy the link again, making
                            sure all of it comes through.
                        </p>
                    </div>
                )}

                {state.status === "ready" && (
                    <>
                        <h1 className="mt-1 font-display text-3xl leading-snug text-foreground md:text-4xl">
                            {state.answer.question}
                        </h1>

                        <div className="mt-6 rounded-xl border border-border bg-card p-5">
                            <AnswerText
                                segments={state.answer.segments}
                                citations={state.answer.citations}
                                onCite={showSource}
                                className="text-[18px]"
                            />
                        </div>
                        <p className="mt-3 text-sm leading-snug text-muted-foreground">
                            Someone shared this with you. It was written by AI
                            from the passages below and can get things wrong,
                            so read the sources.
                        </p>

                        <div className="mt-5">
                            <Button onClick={() => onClose(true)}>
                                <MessageCircleQuestionMark />
                                Ask your own question
                            </Button>
                        </div>

                        {sources.length > 0 && (
                            <section className="mt-10">
                                <h2 className="font-display text-2xl text-foreground">
                                    Sources
                                </h2>
                                <div className="mt-5 flex flex-col gap-8">
                                    {sources.map(({ n, passage }) => {
                                        // Cut short to fit the link: saving
                                        // it would keep the cut text, so it
                                        // links to the full passage instead.
                                        const excerpt =
                                            state.answer.excerpts.has(n);
                                        return (
                                            <div
                                                key={n}
                                                id={sourceId(n)}
                                                className={cn(
                                                    "-mx-3 flex scroll-mt-6 gap-3 rounded-lg px-3 py-2 transition-colors duration-700",
                                                    flashed === n && "bg-primary/10",
                                                )}
                                            >
                                                <span className="mt-0.5 flex h-[22px] min-w-[22px] flex-none items-center justify-center rounded-full bg-primary/[0.14] px-1.5 text-[12px] font-semibold text-primary">
                                                    {n}
                                                </span>
                                                <div className="min-w-0 flex-1">
                                                    <PassageItem
                                                        result={passage}
                                                        action={
                                                            !excerpt && (
                                                                <BookmarkToggle
                                                                    saved={isSaved(
                                                                        savedKeys,
                                                                        passage,
                                                                    )}
                                                                    onToggle={() =>
                                                                        toggleBookmark(
                                                                            passage,
                                                                        )
                                                                    }
                                                                />
                                                            )
                                                        }
                                                        footnote={
                                                            excerpt &&
                                                            "Shortened to fit in the link. Open the title to read the whole passage."
                                                        }
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}
                    </>
                )}
            </main>
        </div>
    );
}
