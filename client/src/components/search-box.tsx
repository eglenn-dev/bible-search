import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import type { Result, Source, ResultCount } from "@/lib/types";
import { runSearch } from "@/lib/search";
import { Search as SearchIcon } from "lucide-react";

interface SearchBoxProps {
    parentQuery: string;
    sources: Source[];
    resultCount: ResultCount;
    setParams: (content: string) => void;
    setResults: (results: Result[]) => void;
    // Compact mode renders a smaller pill for the post-search header.
    compact?: boolean;
}

export default function SearchBox({
    parentQuery,
    sources,
    resultCount,
    setParams,
    setResults,
    compact = false,
}: SearchBoxProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setQuery(parentQuery);
    }, [parentQuery]);

    useEffect(() => {
        const handleKeyDown = () => {
            inputRef.current?.focus();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, []);

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
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
            });
            setResults(results);
            setLoading(false);
        } catch (error) {
            console.error("Error fetching results:", error);
            setError("Failed to fetch results.");
            setLoading(false);
        }
    };

    const setQueryHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = event.target.value;
        setQuery(newQuery);
        setParams(newQuery);
    };

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
                disabled={loading}
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
