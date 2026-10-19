import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Result, Source, ResultCount, SearchFilters } from "@/lib/types";
import { runSearch } from "@/lib/search";
import { Search as SearchIcon } from "lucide-react";
import SearchField from "./mobile/search-field";

interface SearchBoxProps {
    parentQuery: string;
    sources: Source[];
    filters: SearchFilters;
    resultCount: ResultCount;
    setParams: (content: string) => void;
    setResults: (results: Result[]) => void;
    // Compact mode renders a smaller pill for the post-search header.
    compact?: boolean;
    // Inside the mobile shell: render the glass search field instead.
    mobile?: boolean;
    // The backend can't be reached; App shows why in a toast.
    disabled?: boolean;
}

export default function SearchBox({
    parentQuery,
    sources,
    filters,
    resultCount,
    setParams,
    setResults,
    compact = false,
    mobile = false,
    disabled = false,
}: SearchBoxProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setQuery(parentQuery);
    }, [parentQuery]);

    // Type-anywhere-to-search is a desktop nicety; on a phone it would pull
    // focus (and the keyboard) away from sheets.
    useEffect(() => {
        if (mobile) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            // Leave other fields (the speaker picker, year selects) alone.
            const target = e.target as HTMLElement | null;
            if (
                target?.isContentEditable ||
                target?.closest("input, textarea, select")
            )
                return;
            inputRef.current?.focus();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [mobile]);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (disabled) return;
        if (!query) {
            setError("Please enter a search query.");
            return;
        }
        if (loading) return;
        setLoading(true);
        setError("");
        try {
            const results = await runSearch({
                queryType: "natural",
                query,
                resultCount,
                sources,
                filters,
            });
            setResults(results);
            setLoading(false);
        } catch (error) {
            console.error("Error fetching results:", error);
            setError(
                error instanceof Error
                    ? error.message
                    : "Failed to fetch results.",
            );
            setLoading(false);
        }
    };

    const setQueryHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = event.target.value;
        setQuery(newQuery);
        setParams(newQuery);
    };

    if (mobile) {
        return (
            <div>
                <SearchField
                    value={query}
                    onChange={(value) => {
                        setQuery(value);
                        setParams(value);
                    }}
                    onSubmit={handleSubmit}
                    placeholder="seek, and ye shall find…"
                    loading={loading}
                    disabled={disabled}
                />
                {error && (
                    <div className="mt-2 px-4 text-sm text-destructive">
                        {error}
                    </div>
                )}
            </div>
        );
    }

    const searchBar = (
        <form
            onSubmit={handleSubmit}
            className={cn(
                "flex w-full overflow-hidden rounded-[2px] border border-input bg-card transition-colors focus-within:border-primary focus-within:ring-1 focus-within:ring-primary",
            )}
        >
            <input
                type="text"
                name="search-query"
                autoFocus={!compact}
                ref={inputRef}
                value={query}
                onChange={setQueryHandler}
                placeholder="seek, and ye shall find…"
                className={cn(
                    "min-w-0 flex-1 border-none bg-transparent text-foreground outline-none",
                    compact ? "px-3 py-1.5 text-base" : "px-4 py-3 text-lg",
                )}
            />
            <button
                type="submit"
                disabled={loading || disabled}
                className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-[2px] bg-primary text-primary-foreground transition-colors hover:bg-primary-strong disabled:opacity-70",
                    compact
                        ? "m-[3px] px-3 text-sm"
                        : "m-1 px-4 text-base",
                )}
            >
                <SearchIcon
                    className={compact ? "h-4 w-4" : "h-5 w-5"}
                    aria-hidden="true"
                />
                {loading ? "Searching…" : "Search"}
            </button>
        </form>
    );

    if (compact) {
        return (
            <div>
                {searchBar}
                {error && (
                    <div className="mb-2 text-sm text-destructive">{error}</div>
                )}
            </div>
        );
    }

    return (
        <>
            {searchBar}
            {error && (
                <div className="mb-3 text-center text-destructive">{error}</div>
            )}
        </>
    );
}
