import type { Result, BibleVerse, Source } from "@/lib/types";
import { useRef, useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search } from "lucide-react";
import BibleVersesData from "@/lib/bible-verses.json";
const BibleVerses = BibleVersesData as BibleVerse[];

interface ScriptureBoxProps {
    sources: Source[];
    setResults: (results: Result[]) => void;
}

const EXAMPLE_REFERENCES = ["Genesis 1:1", "John 3:16", "Matthew 28:19"];

export default function ScriptureBox({ sources, setResults }: ScriptureBoxProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [inputVerse, setInputVerse] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setQuery("");
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
                `${
                    import.meta.env.VITE_API_DOMAIN
                }/search/by-reference?reference=${encodeURIComponent(
                    query
                )}&k=12${sourcesParam}`
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
            console.error("Error fetching similar verses:", error);
            setError("Failed to fetch similar verses.");
            setLoading(false);
        }
    };

    useEffect(() => {
        try {
            const verse = BibleVerses.find((v) => v.reference === query);
            setInputVerse(verse ? verse.text : "");
        } catch (error) {
            console.error("Error finding verse:", error);
            setInputVerse("");
        }
    }, [query]);

    return (
        <>
            <div className="text-center mb-6">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                    Scripture Reference
                </h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                    Enter a verse like “Genesis 1:1” or “John 3:16” to find
                    related scripture and teachings.
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
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Genesis 1:1, John 3:16, etc."
                        className="pl-12 pr-4 py-6 text-lg rounded-xl"
                    />
                </div>
                <Button
                    type="submit"
                    size="lg"
                    className="w-full py-6 text-lg font-semibold rounded-xl"
                    disabled={loading || !inputVerse}
                >
                    {loading
                        ? "Searching..."
                        : inputVerse
                        ? "Search"
                        : "Enter a valid verse"}
                </Button>
            </form>
            {inputVerse && (
                <div className="mt-4 rounded-lg border border-border bg-secondary/50 p-4 text-center">
                    <p className="text-foreground italic">“{inputVerse}”</p>
                </div>
            )}
            <div className="flex flex-col items-center justify-center mt-6">
                <h3 className="text-sm mb-2 font-semibold text-muted-foreground uppercase tracking-wide">
                    Try an example
                </h3>
                <div className="flex flex-wrap justify-center gap-2 text-sm">
                    {EXAMPLE_REFERENCES.map((ref) => (
                        <span
                            key={ref}
                            className="font-medium bg-secondary text-secondary-foreground cursor-pointer hover:bg-accent hover:text-accent-foreground select-none rounded-full px-3 py-1 transition-colors"
                            onClick={() => setQuery(ref)}
                        >
                            {ref}
                        </span>
                    ))}
                </div>
            </div>
        </>
    );
}
