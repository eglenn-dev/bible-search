import { useState, useRef, useEffect } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Result, Source } from "@/lib/types";

interface SearchBoxProps {
    parentQuery: string;
    sources: Source[];
    setParams: (content: string) => void;
    setResults: (results: Result[]) => void;
}

const EXAMPLE_QUERIES = [
    "God is love",
    "enduring to the end",
    "comfort in times of trial",
    "ministering to others",
];

export default function SearchBox({
    parentQuery,
    sources,
    setParams,
    setResults,
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
            const sourcesParam = sources.length
                ? `&sources=${sources.join(",")}`
                : "";
            const response = await fetch(
                `${import.meta.env.VITE_API_DOMAIN}/search?query=${encodeURIComponent(
                    query,
                )}&k=12${sourcesParam}`,
            );
            if (!response.ok) {
                setError("Failed to fetch results.");
                setLoading(false);
                return;
            }
            const data = await response.json();
            setResults(data.results || []);
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

    const exampleQuery = (q: string) => {
        setQuery(q);
        setParams(q);
        inputRef.current?.focus();
    };

    return (
        <>
            <div className="text-center mb-6">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                    Natural Language Search
                </h2>
                <p className="text-muted-foreground">
                    Search by topic, theme, words, or phrases
                </p>
            </div>
            {error && (
                <div className="text-destructive text-center mb-4">{error}</div>
            )}
            <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground h-5 w-5" />
                    <Input
                        type="text"
                        name="search-query"
                        autoFocus
                        ref={inputRef}
                        value={query}
                        onChange={setQueryHandler}
                        placeholder="Try “charity never faileth”, “forgiveness”, or something longer"
                        className="pl-12 pr-4 py-6 text-lg rounded-xl"
                    />
                </div>
                <Button
                    type="submit"
                    size="lg"
                    className="w-full py-6 text-lg font-semibold rounded-xl"
                    disabled={loading}
                >
                    {loading ? "Searching..." : "Search"}
                </Button>
            </form>
            <div className="flex flex-col items-center justify-center mt-6">
                <h3 className="text-sm mb-2 font-semibold text-muted-foreground uppercase tracking-wide">
                    Try an example
                </h3>
                <div className="flex flex-wrap justify-center gap-2 text-sm">
                    {EXAMPLE_QUERIES.map((q) => (
                        <span
                            key={q}
                            className="font-medium bg-secondary text-secondary-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground select-none rounded-full px-3 py-1 transition-colors"
                            onClick={() => exampleQuery(q)}
                        >
                            {q}
                        </span>
                    ))}
                </div>
            </div>
        </>
    );
}
