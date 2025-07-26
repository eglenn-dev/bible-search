import type { Result, BibleVerse } from "@/lib/types";
import { useRef, useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search } from "lucide-react";
import BibleVersesData from "@/lib/bible-verses.json";
const BibleVerses = BibleVersesData as BibleVerse[];

interface ScriptureBoxProps {
    setResults: (results: Result[]) => void;
}

export default function ScriptureBox({ setResults }: ScriptureBoxProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [inputVerse, setInputVerse] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

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
            `${
                import.meta.env.VITE_API_DOMAIN
            }/similar/?query_verse=${inputVerse}&k=10`
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

    useEffect(() => {
        try {
            const verse = BibleVerses.find((v) => v.reference === query);
            if (verse) {
                setInputVerse(encodeURIComponent(verse.text));
            } else {
                setInputVerse("");
            }
        } catch (error) {
            console.error("Error decoding query:", error);
            setInputVerse("");
        }
    }, [query]);

    return (
        <>
            <div className="text-center mb-6">
                <h2 className="text-2xl font-bold">Scripture Search</h2>
                <p className="text-slate-600 max-w-md mx-auto">
                    Search by using a specific verse reference like "Genesis
                    1:1" or "John 3:16", and find similar verses.
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
                        value={decodeURIComponent(query)}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Genesis 1:1, John 3:16, etc."
                        className="pl-12 pr-4 py-6 text-lg border-slate-200 focus:border-slate-400 focus:ring-slate-400 rounded-xl"
                    />
                </div>
                <Button
                    type="submit"
                    size="lg"
                    className="w-full py-6 text-lg font-semibold rounded-xl bg-zinc-900 hover:bg-zinc-800 transition-colors"
                    disabled={loading}
                >
                    {loading ? "Searching..." : "Search"}
                </Button>
            </form>
            {inputVerse && (
                <div className="mt-4 text-center">
                    <p className="text-slate-600">
                        <span className="font-semibold">
                            {decodeURIComponent(inputVerse)}
                        </span>
                    </p>
                </div>
            )}
            <div className="flex flex-col items-center justify-center mt-4">
                <h3 className="text-md mb-2 font-semibold">Example Queries</h3>
                <div className="flex flex-wrap gap-2 text-sm text-zinc-500">
                    <span
                        className="font-semibold bg-zinc-200 cursor-pointer hover:bg-zinc-300 select-none rounded-lg px-2 py-1 text-black"
                        onClick={() => setQuery("Genesis 1:1")}
                    >
                        Genesis 1:1
                    </span>
                    <span
                        className="font-semibold bg-zinc-200 cursor-pointer hover:bg-zinc-300 select-none rounded-lg px-2 py-1 text-black"
                        onClick={() => setQuery("John 3:16")}
                    >
                        John 3:16
                    </span>
                    <span
                        className="font-semibold bg-zinc-200 cursor-pointer hover:bg-zinc-300 select-none rounded-lg px-2 py-1 text-black"
                        onClick={() => setQuery("Matthew 28:19")}
                    >
                        Matthew 28:19
                    </span>
                </div>
            </div>
        </>
    );
}
