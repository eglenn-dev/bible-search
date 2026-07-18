import { useState, useEffect } from "react";
import type { Result, Source, SortKey } from "./lib/types";
import { SOURCES, RESULT_COUNTS, DEFAULT_RESULT_COUNT } from "./lib/types";
import { sortResults } from "./lib/result-date";
import { runSearch } from "./lib/search";
import SearchBox from "./components/search-box";
import ScriptureBox from "./components/scripture-box";
import RenderResults from "./components/render-results";
import FilterSidebar from "./components/filter-sidebar";
import ResultsCount from "./components/results-count";
import SourcesFilter from "./components/sources-filter";
import McpDialog from "./components/mcp-dialog";
import Footer from "./components/footer";
import Landing from "./components/landing";
import { cn } from "./lib/utils";
import { ChevronDown, SlidersHorizontal } from "lucide-react";
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
    // Mobile-only: whether the collapsed filter panel (source/sort/count) is
    // expanded. Desktop always shows the sidebar and ignores this.
    const [filtersOpen, setFiltersOpen] = useState<boolean>(false);

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
    // the page into the results layout.
    const handleResults = (next: Result[]) => {
        setResults(next);
        setHasSearched(true);
    };

    // Clicking the title acts like Google's logo: back to the centered hero.
    const goHome = () => {
        setResults([]);
        setHasSearched(false);
    };

    const activeQuery = queryType === "scripture" ? scriptureRef : query;

    // Toggling a source in the sidebar re-runs the current search so the
    // result list reflects the new filter immediately.
    const handleSidebarSources = async (next: Source[]) => {
        setSources(next);
        if (!activeQuery) return;
        try {
            handleResults(
                await runSearch({
                    queryType,
                    query: activeQuery,
                    resultCount,
                    sources: next,
                }),
            );
        } catch (e) {
            console.error("Error re-running search:", e);
        }
    };

    const sortedResults = sortResults(results, sortBy);

    // Per-source hit counts for the sidebar, from the current result set.
    const sourceCounts: Partial<Record<Source, number>> = {};
    for (const r of results) {
        sourceCounts[r.source] = (sourceCounts[r.source] ?? 0) + 1;
    }

    // "Load more results" bumps the results-count drop-down one step and
    // re-runs the same query. Hidden at the 50 cap and when the backend already
    // returned fewer than requested (the query is exhausted).
    const nextCount = RESULT_COUNTS[RESULT_COUNTS.indexOf(resultCount) + 1] as
        | (typeof RESULT_COUNTS)[number]
        | undefined;
    const canLoadMore = !!nextCount && results.length >= resultCount;

    const handleLoadMore = async () => {
        if (!nextCount || loadingMore) return;
        if (!activeQuery) return;
        setLoadingMore(true);
        try {
            setResultCount(nextCount);
            handleResults(
                await runSearch({
                    queryType,
                    query: activeQuery,
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

    const modeToggle = (compact: boolean) => (
        <div className="inline-flex rounded-full border-[1.5px] border-input bg-card p-1">
            {(
                [
                    ["natural", "Natural language", "Natural"],
                    ["scripture", "Scripture reference", "Reference"],
                ] as const
            ).map(([type, label, short]) => (
                <button
                    key={type}
                    onClick={() => setQueryType(type)}
                    className={cn(
                        "whitespace-nowrap rounded-full transition-colors",
                        compact
                            ? "px-3.5 py-1 text-sm"
                            : "px-5 py-1.5 text-[15px]",
                        queryType === type
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground",
                    )}
                >
                    {compact ? short : label}
                </button>
            ))}
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
        const countLabel =
            sortedResults.length === 1
                ? "1 result"
                : `${sortedResults.length} results` +
                  (queryType === "scripture" ? " — reference lookup" : "");
        return (
            <div className="gs-fade flex min-h-screen flex-col">
                <header className="sticky top-0 z-30 border-b border-border bg-background/95 shadow-[0_2px_8px_rgba(27,30,36,.06)] backdrop-blur">
                    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                        <button
                            type="button"
                            onClick={goHome}
                            className="whitespace-nowrap font-display text-2xl font-medium italic text-foreground transition-colors hover:text-primary"
                        >
                            Gospel Help
                        </button>
                        <div className="min-w-[240px] max-w-xl flex-1">
                            {searchInput}
                        </div>
                        <div className="flex w-full flex-row items-center justify-between md:w-auto md:justify-start md:gap-3">
                            {modeToggle(true)}
                            <button
                                type="button"
                                aria-expanded={filtersOpen}
                                onClick={() => setFiltersOpen((v) => !v)}
                                className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-input bg-card px-3.5 py-1 text-sm text-foreground/90 md:hidden"
                            >
                                <SlidersHorizontal className="h-4 w-4" />
                                Filters
                                {sources.length > 0 && (
                                    <span className="text-sm text-primary">
                                        · {sources.length}
                                    </span>
                                )}
                                <ChevronDown
                                    className={cn(
                                        "h-4 w-4 transition-transform",
                                        filtersOpen && "rotate-180",
                                    )}
                                />
                            </button>
                            <div className="hidden md:block">
                                <ResultsCount
                                    value={resultCount}
                                    onChange={setResultCount}
                                    compact
                                />
                            </div>
                        </div>
                    </div>
                </header>
                <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col md:flex-row md:items-stretch">
                    {filtersOpen && (
                        <div className="gs-fade border-b border-border px-5 pb-6 pt-5 md:hidden">
                            <FilterSidebar
                                sources={sources}
                                onSourcesChange={handleSidebarSources}
                                sortBy={sortBy}
                                onSortChange={setSortBy}
                                counts={sourceCounts}
                                total={results.length}
                                resultCount={resultCount}
                                onResultCountChange={setResultCount}
                            />
                        </div>
                    )}
                    <aside className="hidden w-full flex-none px-5 py-8 md:block md:w-60 md:py-10 md:pl-5 md:pr-8">
                        <FilterSidebar
                            sources={sources}
                            onSourcesChange={handleSidebarSources}
                            sortBy={sortBy}
                            onSortChange={setSortBy}
                            counts={sourceCounts}
                            total={results.length}
                        />
                    </aside>
                    <main className="flex max-w-3xl flex-1 flex-col gap-8 border-border px-5 pb-24 pt-8 md:border-l md:px-12 md:pt-10">
                        <div className="text-[15px] italic text-muted-foreground">
                            {countLabel}
                        </div>
                        {results.length === 0 ? (
                            <p className="text-lg text-foreground/80">
                                No results
                                {activeQuery
                                    ? ` for “${activeQuery}”`
                                    : ""}.{" "}
                                <span className="italic text-muted-foreground">
                                    Try fewer or different words, or switch
                                    search mode.
                                </span>
                            </p>
                        ) : (
                            <>
                                <RenderResults results={sortedResults} />
                                {canLoadMore && (
                                    <button
                                        type="button"
                                        onClick={handleLoadMore}
                                        disabled={loadingMore}
                                        className="mt-2 self-center text-base text-primary underline underline-offset-[3px] transition-colors hover:text-primary/80 disabled:opacity-60"
                                    >
                                        {loadingMore
                                            ? "Loading…"
                                            : "Load more results"}
                                    </button>
                                )}
                            </>
                        )}
                    </main>
                </div>
                <Footer />
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col">
            <main className="gs-fade flex w-full flex-grow flex-col items-center justify-center px-6 py-12">
                <div className="w-64 border-t-2 border-foreground sm:w-72" />
                <h1 className="mb-4 mt-5 text-center font-display text-4xl sm:text-5xl font-medium italic tracking-wide text-foreground md:text-6xl">
                    Gospel Help
                </h1>
                <p className="mb-5 text-center text-sm sm:text-base uppercase tracking-[0.28em] text-muted-foreground">
                    A Gospel Library concordance of 135,000+ indexed items
                </p>
                <div className="mb-10 w-64 border-b-2 border-foreground sm:w-72" />

                <div className="w-full max-w-xl">{searchInput}</div>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {modeToggle(false)}
                    <SourcesFilter selected={sources} onChange={setSources} />
                    <ResultsCount
                        value={resultCount}
                        onChange={setResultCount}
                    />
                </div>

                <div className="mt-8 flex justify-center">
                    <McpDialog />
                </div>
            </main>
            <Footer />
        </div>
    );
}
