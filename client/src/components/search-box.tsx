import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Result } from "@/lib/types";
import { useRef, useEffect } from "react";

interface SearchBoxProps {
    setResults: (results: Result[]) => void;
}

export default function SearchBox({ setResults }: SearchBoxProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

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
        const response = await fetch(
            `${import.meta.env.VITE_API_DOMAIN}/similar/?query_verse=${query}`
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
    };

    const setQueryHandler = (event: React.ChangeEvent<HTMLInputElement>) => {
        setQuery(encodeURIComponent(event.target.value));
    };

    return (
        <>
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
                        onChange={setQueryHandler}
                        placeholder="Enter your search query..."
                        className="pl-12 pr-4 py-6 text-lg border-slate-200 focus:border-slate-400 focus:ring-slate-400 rounded-xl"
                    />
                </div>
                <Button
                    type="submit"
                    size="lg"
                    className="w-full py-6 text-lg font-semibold rounded-xl bg-slate-900 hover:bg-slate-800 transition-colors"
                    disabled={loading}
                >
                    {loading ? "Searching..." : "Search"}
                </Button>
            </form>
        </>
    );
}
