import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Result } from "@/lib/types";
import { useRef, useEffect } from "react";

interface SearchBoxProps {
    parentQuery: string;
    setParams: (content: string) => void;
    setResults: (results: Result[]) => void;
}

export default function SearchBox({
    parentQuery,
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
            const response = await fetch(
                `${
                    import.meta.env.VITE_API_DOMAIN
                }/similar/?query_verse=${encodeURIComponent(query)}&k=10`
            );
            if (!response.ok) {
                setError("Failed to fetch results.");
                setLoading(false);
                return;
            }
            const data = await response.json();
            const similarVerses =
                data.similar_verses.sort(
                    (a: Result, b: Result) => a.distance - b.distance
                ) || [];
            setResults(similarVerses);
            setLoading(false);
        } catch (error) {
            console.error("Error fetching results:", error);
            setError("Failed to fetch results.");
        }
    };

    const setQueryHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
        const newQuery = event.target.value;
        setQuery(newQuery);
        setParams(newQuery);
    };

    const exampleQuery = (query: string) => {
        setQuery(query);
        setParams(query);
        inputRef.current?.focus();
    };

    return (
        <>
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold">Natural Language Search</h2>
                <p className="text-slate-600">
                    Search using key words or phrases
                </p>
            </div>
            {error && (
                <div className="text-red-500 text-center mb-4">{error}</div>
            )}
            <form className="space-y-6" onSubmit={handleSubmit}>
                <div className="relative">
                    <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 text-slate-400 h-5 w-5" />
                    <Input
                        type="text"
                        name="search-query"
                        autoFocus
                        ref={inputRef}
                        value={query}
                        onChange={setQueryHandler}
                        placeholder="Enter words or phrases to search"
                        className="pl-12 pr-4 py-6 text-lg border-slate-200 focus:border-slate-400 focus:ring-slate-400 rounded-xl"
                    />
                </div>
                <Button
                    type="submit"
                    size="lg"
                    className="w-full py-6 text-lg font-semibold rounded-xl bg-zinc-900 hover:bg-zinc-700 transition-colors"
                    disabled={loading}
                >
                    {loading ? "Searching..." : "Search"}
                </Button>
            </form>
            <div className="flex flex-col items-center justify-center mt-4">
                <h3 className="text-md mb-2 font-semibold">Example Queries</h3>
                <div className="flex flex-wrap gap-2 text-sm text-zinc-500">
                    <span
                        className="font-semibold bg-zinc-200 cursor-pointer hover:bg-zinc-300 select-none rounded-lg px-2 py-1 text-black"
                        onClick={() => exampleQuery("God is love")}
                    >
                        God is love
                    </span>
                    <span
                        className="font-semibold bg-zinc-200 cursor-pointer hover:bg-zinc-300 select-none rounded-lg px-2 py-1 text-black"
                        onClick={() => exampleQuery("The Lord is my shepherd")}
                    >
                        The Lord is my shepherd
                    </span>
                    <span
                        className="font-semibold bg-zinc-200 cursor-pointer hover:bg-zinc-300 select-none rounded-lg px-2 py-1 text-black"
                        onClick={() =>
                            exampleQuery(
                                "Faith is the substance of things hoped for"
                            )
                        }
                    >
                        Faith is the substance of things hoped for
                    </span>
                </div>
            </div>
        </>
    );
}
