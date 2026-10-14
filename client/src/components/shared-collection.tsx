import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookmarkCheck, BookmarkPlus } from "lucide-react";
import {
    bookmarkId,
    importBookmarks,
    toggleBookmark,
    useBookmarks,
} from "@/lib/bookmarks";
import { ShareError, decodeCollection, type DecodedCollection } from "@/lib/share";
import { Button } from "@/components/ui/button";
import ExportBar from "./export-bar";
import PassageItem, { BookmarkToggle } from "./passage-item";
import ThemeToggle from "./theme-toggle";

interface SharedCollectionProps {
    /** The `v1.…` token from `#saved=`. */
    token: string;
    /** Leave the shared view; `toSaved` opens your own Saved list next. */
    onClose: (toSaved: boolean) => void;
}

type State =
    | { status: "loading" }
    | { status: "error"; message: string }
    | ({ status: "ready" } & DecodedCollection);

/**
 * What someone sees when they open a shared-collection link: the passages,
 * read-only, with "Save all to my bookmarks". Shown in place of the app for
 * both layouts and before the search service is reached, so a link opens
 * instantly even while the API is cold.
 */
export default function SharedCollection({ token, onClose }: SharedCollectionProps) {
    const [state, setState] = useState<State>({ status: "loading" });
    const [imported, setImported] = useState<number | null>(null);
    const bookmarks = useBookmarks();
    const savedIds = useMemo(
        () => new Set(bookmarks.map((b) => b.id)),
        [bookmarks],
    );

    useEffect(() => {
        let cancelled = false;
        setState({ status: "loading" });
        setImported(null);
        decodeCollection(token).then(
            (decoded) => {
                if (!cancelled) setState({ status: "ready", ...decoded });
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

    const results = useMemo(
        () => (state.status === "ready" ? state.bookmarks.map((b) => b.result) : []),
        [state],
    );
    const unsaved = results.filter((r) => !savedIds.has(bookmarkId(r))).length;

    useEffect(() => {
        const previous = document.title;
        document.title = "Shared collection · Gospel Help";
        return () => {
            document.title = previous;
        };
    }, []);

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

                <h1 className="font-display text-4xl text-foreground">
                    Shared collection
                </h1>

                {state.status === "loading" && (
                    <p className="mt-3 text-muted-foreground">Opening…</p>
                )}

                {state.status === "error" && (
                    <div className="mt-4 max-w-xl">
                        <p className="text-foreground">{state.message}</p>
                        <p className="mt-2 text-sm text-muted-foreground">
                            Ask whoever sent it to copy the link again, making
                            sure all of it comes through.
                        </p>
                    </div>
                )}

                {state.status === "ready" && (
                    <>
                        <p className="mt-2 text-muted-foreground">
                            {results.length}{" "}
                            {results.length === 1 ? "passage" : "passages"}{" "}
                            someone shared with you. Read-only: nothing changes
                            in your bookmarks unless you save.
                            {state.skipped > 0 &&
                                ` ${state.skipped} ${
                                    state.skipped === 1
                                        ? "entry couldn’t be read and was"
                                        : "entries couldn’t be read and were"
                                } left out.`}
                        </p>

                        <div className="mt-5 flex flex-wrap items-center gap-3">
                            {unsaved > 0 ? (
                                <Button
                                    onClick={() =>
                                        setImported(importBookmarks(results))
                                    }
                                >
                                    <BookmarkPlus />
                                    {unsaved === results.length
                                        ? "Save all to my bookmarks"
                                        : `Save ${unsaved} new to my bookmarks`}
                                </Button>
                            ) : (
                                <Button onClick={() => onClose(true)}>
                                    <BookmarkCheck />
                                    View my Saved
                                </Button>
                            )}
                            <span
                                aria-live="polite"
                                className="text-sm text-muted-foreground"
                            >
                                {imported !== null
                                    ? imported === 0
                                        ? "You already had all of these."
                                        : `Added ${imported} to your Saved.`
                                    : unsaved === 0
                                      ? "All of these are in your Saved."
                                      : ""}
                            </span>
                        </div>

                        <ExportBar
                            className="mt-3"
                            results={results}
                            title="Shared collection"
                        />

                        <div className="mt-10 flex flex-col gap-8">
                            {results.map((result) => {
                                const id = bookmarkId(result);
                                return (
                                    <PassageItem
                                        key={id}
                                        result={result}
                                        action={
                                            <BookmarkToggle
                                                saved={savedIds.has(id)}
                                                onToggle={() =>
                                                    toggleBookmark(result)
                                                }
                                            />
                                        }
                                    />
                                );
                            })}
                        </div>
                    </>
                )}
            </main>
        </div>
    );
}
