import type { Result, Source } from "@/lib/types";
import { useRef, useState, useEffect } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Search } from "lucide-react";

interface ScriptureBoxProps {
    sources: Source[];
    setResults: (results: Result[]) => void;
}

const EXAMPLE_REFERENCES = ["John 3:16", "Alma 32:21", "D&C 4:2", "Moses 1:39"];

const SOURCE_LABELS: Record<string, string> = {
    bible: "Bible",
    "book-of-mormon": "Book of Mormon",
    "doctrine-and-covenants": "Doctrine & Covenants",
    "pearl-of-great-price": "Pearl of Great Price",
};

export default function ScriptureBox({ sources, setResults }: ScriptureBoxProps) {
    const [query, setQuery] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [inputVerse, setInputVerse] = useState("");
    const [verseSource, setVerseSource] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setQuery("");
    }, []);

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
                        ref
                    )}`
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
            const sourcesParam = sources.length
                ? `&sources=${sources.join(",")}`
                : "";
            const response = await fetch(
                `${
                    import.meta.env.VITE_API_DOMAIN
                }/search/by-reference?reference=${encodeURIComponent(
                    query.trim()
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

    return (
        <>
            <div className="text-center mb-6">
                <h2 className="font-display text-2xl font-semibold text-foreground">
                    Scripture Reference
                </h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                    Enter a reference from any Standard Work — like “Alma 32:21”,
                    “John 3:16”, or “D&C 4:2” — to find related scripture and
                    teachings.
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
                        placeholder="Alma 32:21, John 3:16, D&C 4:2, Moses 1:39…"
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
                        : "Enter a valid reference"}
                </Button>
            </form>
            {inputVerse && (
                <div className="mt-4 rounded-lg border border-border bg-secondary/50 p-4 text-center">
                    {verseSource && (
                        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                            {SOURCE_LABELS[verseSource] || verseSource}
                        </p>
                    )}
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
