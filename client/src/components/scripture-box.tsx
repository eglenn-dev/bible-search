import type { Result, Source, ResultCount } from "@/lib/types";
import { runSearch } from "@/lib/search";
import { useRef, useState, useEffect } from "react";
import { cn } from "@/lib/utils";

interface ScriptureBoxProps {
    // Reference is lifted to App so it survives the hero <-> compact layout
    // swap, which remounts this component.
    parentRef: string;
    setParentRef: (ref: string) => void;
    sources: Source[];
    resultCount: ResultCount;
    setResults: (results: Result[]) => void;
    // Compact mode renders a smaller pill for the post-search header.
    compact?: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
    bible: "Bible",
    "book-of-mormon": "Book of Mormon",
    "doctrine-and-covenants": "Doctrine & Covenants",
    "pearl-of-great-price": "Pearl of Great Price",
};

export default function ScriptureBox({
    parentRef,
    setParentRef,
    sources,
    resultCount,
    setResults,
    compact = false,
}: ScriptureBoxProps) {
    const [query, setQuery] = useState(parentRef);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [inputVerse, setInputVerse] = useState("");
    const [verseSource, setVerseSource] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Mirror the lifted reference into the local input (e.g. after a remount).
    useEffect(() => {
        setQuery(parentRef);
    }, [parentRef]);

    const setQueryHandler = (value: string) => {
        setQuery(value);
        setParentRef(value);
    };

    // Validate + preview the reference against the backend (any Standard Work),
    // debounced so we don't fire a request on every keystroke.
    useEffect(() => {
        const ref = query.trim();
        if (!ref) {
            setInputVerse("");
            setVerseSource(null);
            return;
        }
        let cancelled = false;
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(
                    `${import.meta.env.VITE_API_DOMAIN}/verse?reference=${encodeURIComponent(
                        ref,
                    )}`,
                );
                if (cancelled) return;
                if (res.ok) {
                    const data = await res.json();
                    setInputVerse(data.text);
                    setVerseSource(data.source);
                } else {
                    setInputVerse("");
                    setVerseSource(null);
                }
            } catch {
                if (!cancelled) {
                    setInputVerse("");
                    setVerseSource(null);
                }
            }
        }, 350);
        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [query]);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (!inputVerse) {
            setError("Please enter a valid reference.");
            return;
        }
        if (loading) return;
        setLoading(true);
        setError("");
        try {
            const results = await runSearch({
                queryType: "scripture",
                query,
                resultCount,
                sources,
            });
            setResults(results);
            setLoading(false);
        } catch (error) {
            console.error("Error fetching similar verses:", error);
            setError("Failed to fetch similar verses.");
            setLoading(false);
        }
    };

    const searchBar = (
        <form
            onSubmit={handleSubmit}
            className={cn(
                "flex w-full overflow-hidden rounded-full border-[1.5px] border-foreground/60 bg-card",
                !compact && "shadow-[var(--shadow-hero)]",
            )}
        >
            <input
                type="text"
                name="search-query"
                autoFocus={!compact}
                ref={inputRef}
                value={query}
                onChange={(e) => setQueryHandler(e.target.value)}
                placeholder="e.g.  Alma 32:21  or  D&C 4:2"
                className={cn(
                    "min-w-0 flex-1 border-none bg-transparent text-foreground outline-none",
                    compact ? "px-4 py-1.5 text-base" : "px-6 py-3 text-lg",
                )}
            />
            <button
                type="submit"
                disabled={loading || !inputVerse}
                className={cn(
                    "shrink-0 whitespace-nowrap rounded-full bg-primary uppercase text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-70",
                    compact
                        ? "m-[3px] px-4 text-[13px] tracking-[0.12em]"
                        : "m-1 px-7 text-base tracking-[0.1em]",
                )}
            >
                {loading ? "Searching…" : "Search"}
            </button>
        </form>
    );

    const versePreview = inputVerse && (
        <div
            className={cn(
                "border-l-2 border-primary/40 pl-3 text-left",
                compact ? "mt-2 text-sm" : "mt-4",
            )}
        >
            {verseSource && (
                <span className="mr-2 text-[13px] uppercase tracking-[0.16em] text-muted-foreground">
                    {SOURCE_LABELS[verseSource] || verseSource}
                </span>
            )}
            <span className="italic text-foreground/85">“{inputVerse}”</span>
        </div>
    );

    if (compact) {
        return (
            <div>
                {error && (
                    <div className="mb-2 text-sm text-destructive">{error}</div>
                )}
                {searchBar}
                {versePreview}
            </div>
        );
    }

    return (
        <>
            {error && (
                <div className="mb-3 text-center text-destructive">{error}</div>
            )}
            {searchBar}
            {versePreview}
        </>
    );
}
