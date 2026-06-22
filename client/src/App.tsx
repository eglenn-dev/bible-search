import { useState, useEffect } from "react";
import type { Result, Source } from "./lib/types";
import { SOURCES } from "./lib/types";
import SearchBox from "./components/search-box";
import ScriptureBox from "./components/scripture-box";
import RenderResults from "./components/render-results";
import SourcesFilter from "./components/sources-filter";
import McpDialog from "./components/mcp-dialog";
import Footer from "./components/footer";
import Landing from "./components/landing";
import { cn } from "./lib/utils";
import { BookOpen } from "lucide-react";
import { useSearchParams } from "react-router-dom";

const parseSources = (raw: string | null): Source[] => {
    if (!raw) return [];
    const valid = new Set<string>(SOURCES);
    return raw
        .split(",")
        .map((s) => s.trim())
        .filter((s) => valid.has(s)) as Source[];
};

const parseQueryType = (raw: string | null): "natural" | "scripture" =>
    raw === "scripture" ? "scripture" : "natural";

export default function App() {
    const [results, setResults] = useState<Result[]>([]);
    const [hasSearched, setHasSearched] = useState<boolean>(false);
    const [backendRunning, setBackendRunning] = useState<boolean>(false);
    const [searchParams, setSearchParams] = useSearchParams();
    const [query, setQuery] = useState<string>("");
    // Source filter + search mode are URL-backed so a selection survives a
    // refresh and is shareable — initialized from the URL, written back on
    // every change (like the ?q text param).
    const [sources, setSourcesState] = useState<Source[]>(() =>
        parseSources(searchParams.get("sources")),
    );
    const [queryType, setQueryTypeState] = useState<"natural" | "scripture">(
        () => parseQueryType(searchParams.get("type")),
    );
    const [scriptureRef, setScriptureRef] = useState<string>("");

    const setSources = (next: Source[]) => {
        setSourcesState(next);
        setSearchParams(
            (prev) => {
                const newParams = new URLSearchParams(prev);
                if (next.length) newParams.set("sources", next.join(","));
                else newParams.delete("sources");
                return newParams;
            },
            { replace: true },
        );
    };

    const setQueryType = (type: "natural" | "scripture") => {
        setQueryTypeState(type);
        setSearchParams(
            (prev) => {
                const newParams = new URLSearchParams(prev);
                if (type === "scripture") {
                    newParams.set("type", "scripture");
                    newParams.delete("q"); // scripture mode doesn't use ?q
                } else {
                    newParams.delete("type"); // natural is the default
                }
                return newParams;
            },
            { replace: true },
        );
    };

    // Mirror ?q into the input when in natural mode; scripture mode keeps its
    // own reference input and ignores ?q.
    useEffect(() => {
        setQuery(queryType === "natural" ? searchParams.get("q") || "" : "");
    }, [searchParams, queryType]);

    // Switching search mode clears the old results but stays in whichever
    // layout we're in (the compact view persists once you've searched).
    useEffect(() => {
        setResults([]);
    }, [queryType]);

    // Wraps setResults so any completed search (even one with no hits) flips
    // the page into the compact results layout.
    const handleResults = (next: Result[]) => {
        setResults(next);
        setHasSearched(true);
    };

    // Clicking the title acts like Google's logo: back to the centered hero.
    const goHome = () => {
        setResults([]);
        setHasSearched(false);
    };

    const setQueryParam = (content: string) => {
        setSearchParams((prev) => {
            const newParams = new URLSearchParams(prev);
            newParams.set("q", content);
            return newParams;
        });
    };

    if (!backendRunning)
        return <Landing setBackendRunning={setBackendRunning} />;

    // The mode toggle + sources filter; centered in the hero, left-aligned in
    // the compact header.
    const controls = (
        <div
            className={cn(
                "flex flex-wrap items-center gap-3",
                hasSearched ? "justify-start" : "justify-center",
            )}
        >
            <div className="inline-flex rounded-full border border-border bg-card p-1 shadow-sm">
                {(
                    [
                        ["natural", "Natural Language"],
                        ["scripture", "Scripture Reference"],
                    ] as const
                ).map(([type, label]) => (
                    <button
                        key={type}
                        onClick={() => setQueryType(type)}
                        className={cn(
                            "rounded-full px-5 py-2 text-sm font-medium transition-colors",
                            queryType === type
                                ? "bg-primary text-primary-foreground shadow-sm"
                                : "text-muted-foreground hover:text-foreground",
                        )}
                    >
                        {label}
                    </button>
                ))}
            </div>
            <SourcesFilter selected={sources} onChange={setSources} />
        </div>
    );

    const searchInput =
        queryType === "natural" ? (
            <SearchBox
                parentQuery={query}
                sources={sources}
                setParams={setQueryParam}
                setResults={handleResults}
                compact={hasSearched}
            />
        ) : (
            <ScriptureBox
                parentRef={scriptureRef}
                setParentRef={setScriptureRef}
                sources={sources}
                setResults={handleResults}
                compact={hasSearched}
            />
        );

    if (hasSearched) {
        return (
            <div className="flex flex-col min-h-screen">
                <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur">
                    <div className="mx-auto w-full max-w-2xl space-y-3 px-4 py-3">
                        <button
                            type="button"
                            onClick={goHome}
                            className="flex items-center gap-2 text-primary transition-opacity hover:opacity-80"
                        >
                            <BookOpen className="h-5 w-5" strokeWidth={1.5} />
                            <span className="font-display text-lg font-semibold text-foreground tracking-tight">
                                Gospel Library Search
                            </span>
                        </button>
                        {searchInput}
                        {controls}
                    </div>
                </header>
                <main className="flex-grow w-full">
                    <div className="mx-auto w-full max-w-2xl px-4 py-6">
                        {results.length === 0 ? (
                            <p className="text-center text-muted-foreground text-sm">
                                Enter a query above to search across the
                                collections.
                            </p>
                        ) : (
                            <RenderResults results={results} />
                        )}
                    </div>
                </main>
                <Footer />
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen">
            <main className="flex-grow w-full flex items-center justify-center p-4 py-12">
                <div className="w-full max-w-2xl space-y-8">
                    <header className="text-center space-y-4">
                        <div className="flex items-center justify-center gap-3 text-primary">
                            <span className="h-px w-10 bg-border" />
                            <BookOpen className="h-6 w-6" strokeWidth={1.5} />
                            <span className="h-px w-10 bg-border" />
                        </div>
                        <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tight">
                            Gospel Library Search
                        </h1>
                        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                            Search the Bible, General Conference, BYU Speeches,
                            and the General Handbook by meaning — not just
                            words.
                        </p>
                        <p className="text-muted-foreground/80 text-sm">
                            Developed by{" "}
                            <a
                                href="https://ethanglenn.dev"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline font-semibold"
                            >
                                Ethan Glenn
                            </a>
                            .
                        </p>
                        <div className="flex justify-center pt-1">
                            <McpDialog />
                        </div>
                    </header>

                    {controls}

                    <div className="bg-card rounded-2xl shadow-lg border border-border p-6 md:p-8">
                        {searchInput}
                    </div>
                </div>
            </main>
            <Footer />
        </div>
    );
}
