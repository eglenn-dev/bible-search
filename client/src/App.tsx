import { useState, useEffect } from "react";
import type { Result, Source, SortKey } from "./lib/types";
import { SOURCES, RESULT_COUNTS, DEFAULT_RESULT_COUNT } from "./lib/types";
import { sortResults } from "./lib/result-date";
import { runSearch } from "./lib/search";
import { Button } from "@/components/ui/button";
import SearchBox from "./components/search-box";
import ScriptureBox from "./components/scripture-box";
import RenderResults from "./components/render-results";
import SortControl from "./components/sort-control";
import SourcesFilter from "./components/sources-filter";
import ResultsCount from "./components/results-count";
import McpDialog from "./components/mcp-dialog";
import Footer from "./components/footer";
import Landing from "./components/landing";
import { cn } from "./lib/utils";
import { BookOpen } from "lucide-react";
import {
    useQueryState,
    parseAsString,
    parseAsStringEnum,
    parseAsArrayOf,
    parseAsNumberLiteral,
} from "nuqs";

export default function App() {
    const [results, setResults] = useState<Result[]>([]);
    const [hasSearched, setHasSearched] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    const [backendRunning, setBackendRunning] = useState<boolean>(false);
    const [scriptureRef, setScriptureRef] = useState<string>("");

    // Every shareable/refresh-safe setting lives in the URL via nuqs: each
    // hook returns a [value, setValue] pair backed directly by the query
    // string, so there's no shadow state or hand-rolled URLSearchParams
    // plumbing. A value equal to its default is omitted from the URL, and the
    // enum/literal parsers drop invalid values (replacing the old parse* and
    // validation helpers). Writes default to history: "replace".
    const [query, setQuery] = useQueryState("q", parseAsString.withDefault(""));
    const [sources, setSources] = useQueryState(
        "sources",
        parseAsArrayOf(parseAsStringEnum<Source>([...SOURCES])).withDefault([]),
    );
    const [queryType, setQueryTypeState] = useQueryState(
        "type",
        parseAsStringEnum<"natural" | "scripture">([
            "natural",
            "scripture",
        ]).withDefault("natural"),
    );
    const [sortBy, setSortBy] = useQueryState(
        "sort",
        parseAsStringEnum<SortKey>(["relevance", "date"]).withDefault(
            "relevance",
        ),
    );
    const [resultCount, setResultCount] = useQueryState(
        "k",
        parseAsNumberLiteral(RESULT_COUNTS).withDefault(DEFAULT_RESULT_COUNT),
    );

    // Switching to scripture mode drops the ?q text (scripture mode uses its
    // own reference input and ignores ?q).
    const setQueryType = (type: "natural" | "scripture") => {
        setQueryTypeState(type);
        if (type === "scripture") setQuery(null);
    };

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

    const sortedResults = sortResults(results, sortBy);

    // "Load more results" bumps the results-count drop-down one step and
    // re-runs the same query. Hidden at the 50 cap and when the backend already
    // returned fewer than requested (the query is exhausted).
    const nextCount = RESULT_COUNTS[RESULT_COUNTS.indexOf(resultCount) + 1] as
        | (typeof RESULT_COUNTS)[number]
        | undefined;
    const canLoadMore = !!nextCount && results.length >= resultCount;

    const handleLoadMore = async () => {
        if (!nextCount || loadingMore) return;
        const text = queryType === "scripture" ? scriptureRef : query;
        if (!text) return;
        setLoadingMore(true);
        try {
            setResultCount(nextCount);
            handleResults(
                await runSearch({
                    queryType,
                    query: text,
                    resultCount: nextCount,
                    sources,
                }),
            );
        } catch (e) {
            console.error("Error loading more results:", e);
        } finally {
            setLoadingMore(false);
        }
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
            <ResultsCount value={resultCount} onChange={setResultCount} />
        </div>
    );

    const searchInput =
        queryType === "natural" ? (
            <SearchBox
                parentQuery={query}
                sources={sources}
                resultCount={resultCount}
                setParams={setQuery}
                setResults={handleResults}
                compact={hasSearched}
            />
        ) : (
            <ScriptureBox
                parentRef={scriptureRef}
                setParentRef={setScriptureRef}
                sources={sources}
                resultCount={resultCount}
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
                            <>
                                <SortControl
                                    sortBy={sortBy}
                                    onChange={setSortBy}
                                    count={results.length}
                                />
                                <RenderResults results={sortedResults} />
                                {canLoadMore && (
                                    <div className="flex justify-center pt-6">
                                        <Button
                                            variant="outline"
                                            onClick={handleLoadMore}
                                            disabled={loadingMore}
                                            className="rounded-xl px-6 font-semibold"
                                        >
                                            {loadingMore
                                                ? "Loading…"
                                                : "Load more results"}
                                        </Button>
                                    </div>
                                )}
                            </>
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
