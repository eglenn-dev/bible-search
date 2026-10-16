import { useState, useEffect, useMemo, useRef } from "react";
import type {
    Result,
    ResultCount,
    Source,
    SortKey,
    SearchFilters,
} from "./lib/types";
import { SOURCES, RESULT_COUNTS, DEFAULT_RESULT_COUNT } from "./lib/types";
import { sortResults } from "./lib/result-date";
import { runSearch } from "./lib/search";
import type { RecentSearch } from "./lib/recent-searches";
import { runSimilar } from "./lib/passages";
import { headingFor } from "./lib/result-display";
import { hasFilters } from "./lib/speakers";
import { ActiveFilters } from "./components/speaker-year-filter";
import SearchBox from "./components/search-box";
import ScriptureBox from "./components/scripture-box";
import RenderResults from "./components/render-results";
import FilterSidebar from "./components/filter-sidebar";
import ResultsCount from "./components/results-count";
import SourcesFilter from "./components/sources-filter";
import McpDialog from "./components/mcp-dialog";
import Footer from "./components/footer";
import BackendToast from "./components/backend-toast";
import ConferenceBanner from "./components/conference-banner";
import ThemeToggle from "./components/theme-toggle";
import InstallButton from "./components/install-button";
import MobileApp from "./components/mobile/mobile-app";
import SavedDrawer, { SavedButton } from "./components/saved-drawer";
import SharedCollection from "./components/shared-collection";
import { useBookmarks } from "./lib/bookmarks";
import { useBackendStatus } from "./lib/backend";
import { useOnline } from "./lib/use-online";
import { shareTokenFromHash } from "./lib/share";
import { useAppShell } from "./lib/use-is-mobile";
import { cn } from "./lib/utils";
import { Sparkles, X } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import {
    useQueryState,
    parseAsString,
    parseAsStringEnum,
    parseAsArrayOf,
    parseAsNumberLiteral,
    parseAsInteger,
} from "nuqs";

export default function App() {
    const [results, setResults] = useState<Result[]>([]);
    const [hasSearched, setHasSearched] = useState<boolean>(false);
    const [loadingMore, setLoadingMore] = useState<boolean>(false);
    // Checked in the background: the UI renders right away, and a backend
    // that can't be reached disables searching (with a toast). Offline is
    // different: saved passages and cached recent searches need no network,
    // and the service worker may still answer a search, so it simply tries.
    const backend = useBackendStatus();
    const online = useOnline();
    const searchDisabled = backend.status === "down" && online;
    // When `?similar=` may load: once the backend is up, or right away
    // offline (its cached copy may answer).
    const ready =
        backend.status === "up" || (backend.status === "down" && !online);
    const [scriptureRef, setScriptureRef] = useState<string>("");
    // Why the last filter-driven re-run failed (e.g. the API's "filters not
    // available yet" 503), shown above the now-stale results.
    const [searchError, setSearchError] = useState<string | null>(null);
    // Phones, and the installed app at any size, get the app-style shell
    // (components/mobile) in place of the layouts below; the search state in
    // this component drives both. A browser tab on an iPad or laptop keeps the
    // desktop layout.
    const appShell = useAppShell();
    // The desktop Saved panel (phones have their own Saved tab).
    const [savedOpen, setSavedOpen] = useState<boolean>(false);
    const savedCount = useBookmarks().length;

    // A shared collection arrives as `#saved=…` in the hash, which never
    // reaches the server. While it's there, it's shown instead of the app.
    const location = useLocation();
    const navigate = useNavigate();
    const shareToken = shareTokenFromHash(location.hash);

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
    // "More like this": the id of the passage the results were found from.
    // While set it replaces the query as what's on screen, so a shared or
    // reloaded link shows the same results; clearing it (the banner's close
    // button, or Back) returns to the query's own results.
    const [similar, setSimilar] = useQueryState("similar", parseAsString);
    const [similarSeed, setSimilarSeed] = useState<Result | null>(null);
    // The `similar` id currently on screen, so the effect below can tell a
    // URL change it must act on (a click, Back/Forward, a reload) from one it
    // made itself.
    const shownSimilar = useRef<string | null>(null);
    // Only the latest similar request may land (fast clicks race).
    const similarRequest = useRef(0);
    // Speaker (a normalized name from /speakers) and an inclusive year range.
    const [speaker, setSpeaker] = useQueryState("speaker", parseAsString);
    const [yearFrom, setYearFrom] = useQueryState("from", parseAsInteger);
    const [yearTo, setYearTo] = useQueryState("to", parseAsInteger);
    const filters = useMemo<SearchFilters>(
        () => ({ speaker, yearFrom, yearTo }),
        [speaker, yearFrom, yearTo],
    );

    // Switching to scripture mode drops the ?q text (scripture mode uses its
    // own reference input and ignores ?q).
    const setQueryType = (type: "natural" | "scripture") => {
        setQueryTypeState(type);
        if (type === "scripture") setQuery(null);
        leaveSimilar();
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
        setSearchError(null);
    };

    // Drops "more like this" without touching the results (the caller is
    // about to replace them).
    function leaveSimilar() {
        shownSimilar.current = null;
        similarRequest.current++;
        setSimilarSeed(null);
        setSimilar(null);
    }

    // A search from either input box ends any "more like this" view.
    const handleSearchResults = (next: Result[]) => {
        leaveSimilar();
        handleResults(next);
    };

    // Clicking the title acts like Google's logo: back to the centered hero.
    const goHome = () => {
        leaveSimilar();
        setResults([]);
        setHasSearched(false);
    };

    const activeQuery = queryType === "scripture" ? scriptureRef : query;

    // Fetches and shows the passages similar to `id`; throws on failure. A
    // response overtaken by a newer request is dropped.
    const loadSimilar = async (
        id: string,
        count: ResultCount,
        nextSources: Source[],
        nextFilters: SearchFilters,
    ) => {
        const request = ++similarRequest.current;
        const { seed, results: next } = await runSimilar({
            id,
            resultCount: count,
            sources: nextSources,
            filters: nextFilters,
        });
        if (request !== similarRequest.current) return;
        setSimilarSeed(seed);
        handleResults(next);
    };

    // Re-runs whatever is on screen with new settings: the similar search
    // while one is showing, otherwise the query.
    const rerun = async (
        count: ResultCount,
        nextSources: Source[],
        nextFilters: SearchFilters = filters,
    ) => {
        if (similar) return loadSimilar(similar, count, nextSources, nextFilters);
        handleResults(
            await runSearch({
                queryType,
                query: activeQuery,
                resultCount: count,
                sources: nextSources,
                filters: nextFilters,
            }),
        );
    };

    // Follows `?similar=` wherever it changes: "More like this" (which only
    // sets the param), Back/Forward, and a reload or shared link once the
    // backend is up (or the app has opened offline).
    useEffect(() => {
        if (!ready || similar === shownSimilar.current) return;
        const previous = shownSimilar.current;
        shownSimilar.current = similar;
        if (similar) {
            loadSimilar(similar, resultCount, sources, filters).catch((e) => {
                console.error("Error fetching similar passages:", e);
                // An unknown or stale id (say, an old shared link): drop it
                // and leave the page as it was.
                if (shownSimilar.current === similar) leaveSimilar();
            });
        } else if (previous) {
            // Left via Back or the banner: return to the query's own results.
            similarRequest.current++;
            setSimilarSeed(null);
            if (activeQuery) {
                rerun(resultCount, sources).catch((e) =>
                    console.error("Error re-running search:", e),
                );
            } else {
                goHome();
            }
        }
        // Only when the param (or backend readiness) changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [similar, ready]);

    // Pushed (not replaced) so Back returns to the results it came from.
    const showSimilar = (result: Result) => {
        if (!result.id) return;
        void setSimilar(result.id, { history: "push" });
        window.scrollTo({ top: 0 });
    };

    // Changing a source, speaker or year filter re-runs whatever is on screen
    // (the query, or "more like this") so the list reflects it immediately.
    const rerunSearch = async (
        nextSources: Source[],
        nextFilters: SearchFilters,
    ) => {
        if (!activeQuery && !similar) return;
        try {
            await rerun(resultCount, nextSources, nextFilters);
        } catch (e) {
            console.error("Error re-running search:", e);
            setSearchError(
                e instanceof Error ? e.message : "Failed to fetch results.",
            );
        }
    };

    const handleSidebarSources = async (next: Source[]) => {
        setSources(next);
        await rerunSearch(next, filters);
    };

    const setFilters = (next: SearchFilters) => {
        setSpeaker(next.speaker);
        setYearFrom(next.yearFrom);
        setYearTo(next.yearTo);
    };

    const handleFiltersChange = async (next: SearchFilters) => {
        setFilters(next);
        await rerunSearch(sources, next);
    };

    const sortedResults = useMemo(
        () => sortResults(results, sortBy),
        [results, sortBy],
    );

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
        if (!activeQuery && !similar) return;
        setLoadingMore(true);
        try {
            setResultCount(nextCount);
            await rerun(nextCount, sources);
        } catch (e) {
            console.error("Error loading more results:", e);
            setSearchError(
                e instanceof Error ? e.message : "Failed to fetch results.",
            );
        } finally {
            setLoadingMore(false);
        }
    };

    // A tap in "Recent searches": put its settings back (so the URL, inputs
    // and filters match) and run it with exactly those parameters. Offline,
    // the service worker answers from its cache.
    const runRecent = async (recent: RecentSearch) => {
        setQueryTypeState(recent.queryType);
        if (recent.queryType === "scripture") {
            setScriptureRef(recent.query);
            setQuery(null);
        } else {
            setQuery(recent.query);
        }
        setSources(recent.sources);
        setFilters(recent.filters);
        setResultCount(recent.resultCount);
        try {
            handleSearchResults(await runSearch(recent));
        } catch (e) {
            console.error("Error re-running recent search:", e);
            setSearchError(
                e instanceof Error ? e.message : "Failed to fetch results.",
            );
        }
    };

    // Leaving a shared collection drops the hash; after "Save all" it can go
    // straight to your own Saved list (the tab on phones, the panel here).
    const closeShared = (toSaved: boolean) => {
        const params = new URLSearchParams(location.search);
        if (toSaved && appShell) params.set("tab", "saved");
        const search = params.toString();
        navigate({
            pathname: location.pathname,
            search: search ? `?${search}` : "",
            hash: "",
        });
        if (toSaved && !appShell) setSavedOpen(true);
    };

    // A shared collection carries its own passages, so it opens even while
    // the API is still waking up.
    if (shareToken)
        return <SharedCollection token={shareToken} onClose={closeShared} />;

    const savedDrawer = !appShell && (
        <SavedDrawer open={savedOpen} onOpenChange={setSavedOpen} />
    );
    const backendToast = <BackendToast backend={backend} appShell={appShell} />;

    const modeToggle = (compact: boolean) => (
        <div className="inline-flex rounded-md border border-input bg-card p-0.5">
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
                        "whitespace-nowrap rounded-sm transition-colors",
                        compact
                            ? "px-3 py-1 text-sm"
                            : "px-4 py-1.5 text-sm",
                        queryType === type
                            ? "bg-primary font-semibold text-primary-foreground"
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
                filters={filters}
                resultCount={resultCount}
                setParams={setQuery}
                setResults={handleSearchResults}
                compact={hasSearched}
                mobile={appShell}
                disabled={searchDisabled}
            />
        ) : (
            <ScriptureBox
                parentRef={scriptureRef}
                setParentRef={setScriptureRef}
                sources={sources}
                filters={filters}
                resultCount={resultCount}
                setResults={handleSearchResults}
                compact={hasSearched}
                mobile={appShell}
                disabled={searchDisabled}
            />
        );

    if (appShell) {
        return (
            <>
                <MobileApp
                    hasSearched={hasSearched}
                    results={sortedResults}
                    activeQuery={activeQuery}
                    queryType={queryType}
                    onQueryTypeChange={setQueryType}
                    searchInput={searchInput}
                    sources={sources}
                    // Before the first search a filter change is only a setting;
                    // after it, it re-runs the query like the desktop sidebar.
                    onSourcesChange={hasSearched ? handleSidebarSources : setSources}
                    sortBy={sortBy}
                    onSortChange={setSortBy}
                    resultCount={resultCount}
                    onResultCountChange={setResultCount}
                    sourceCounts={sourceCounts}
                    filters={filters}
                    onFiltersChange={hasSearched ? handleFiltersChange : setFilters}
                    searchError={searchError}
                    canLoadMore={canLoadMore}
                    loadingMore={loadingMore}
                    onLoadMore={handleLoadMore}
                    onGoHome={goHome}
                    similarSeed={similarSeed}
                    onMoreLike={showSimilar}
                    onLeaveSimilar={() => setSimilar(null)}
                    onRunRecent={runRecent}
                />
                {backendToast}
            </>
        );
    }

    if (hasSearched) {
        const countLabel =
            (sortedResults.length === 1
                ? "1 result"
                : `${sortedResults.length} results`) +
            (similarSeed
                ? " — more like this"
                : queryType === "scripture"
                  ? " — reference lookup"
                  : "");
        return (
            <div className="gs-fade flex min-h-screen flex-col">
                <header className="sticky top-0 z-30 border-b border-border bg-background">
                    <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
                        <button
                            type="button"
                            onClick={goHome}
                            className="whitespace-nowrap font-display text-[26px] text-foreground transition-colors hover:text-primary"
                        >
                            Gospel Help
                        </button>
                        <div className="min-w-[240px] max-w-xl flex-1">
                            {searchInput}
                        </div>
                        <div className="flex w-full flex-row items-center justify-between gap-1.5 md:w-auto md:justify-start md:gap-3">
                            {modeToggle(true)}
                            <div className="hidden md:block">
                                <ResultsCount
                                    value={resultCount}
                                    onChange={setResultCount}
                                    compact
                                />
                            </div>
                            <SavedButton
                                compact
                                count={savedCount}
                                onClick={() => setSavedOpen(true)}
                            />
                            <ThemeToggle compact />
                        </div>
                    </div>
                </header>
                <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col md:flex-row md:items-stretch">
                    {/* Boxed like the Church's "Filter Results" panel. */}
                    <aside className="hidden w-full flex-none px-5 py-8 md:block md:w-64 md:py-10 md:pl-5 md:pr-0">
                        <div className="border border-border bg-muted p-4">
                            <h2 className="mb-4 font-sans text-lg font-semibold">
                                Filter results
                            </h2>
                            <FilterSidebar
                                sources={sources}
                                onSourcesChange={handleSidebarSources}
                                sortBy={sortBy}
                                onSortChange={setSortBy}
                                counts={sourceCounts}
                                total={results.length}
                                filters={filters}
                                onFiltersChange={handleFiltersChange}
                            />
                        </div>
                    </aside>
                    <main className="flex max-w-3xl flex-1 flex-col gap-7 px-5 pb-24 pt-8 md:px-10 md:pt-10">
                        {similarSeed && (
                            <div className="flex items-start gap-3 border border-border bg-muted px-4 py-3">
                                <Sparkles
                                    className="mt-0.5 h-5 w-5 flex-none text-primary"
                                    aria-hidden="true"
                                />
                                <div className="min-w-0 flex-1">
                                    <div className="text-[13px] text-muted-foreground">
                                        More like
                                    </div>
                                    <div className="font-semibold text-foreground">
                                        {headingFor(similarSeed)}
                                    </div>
                                </div>
                                {/* Clearing the param brings back the
                                    query's results (see the effect above). */}
                                <button
                                    type="button"
                                    onClick={() => setSimilar(null)}
                                    className="inline-flex flex-none items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-primary-strong"
                                >
                                    <X className="h-4 w-4" aria-hidden="true" />
                                    {activeQuery ? "Back to results" : "Clear"}
                                </button>
                            </div>
                        )}
                        <div className="flex flex-col gap-3">
                            <div className="text-sm text-muted-foreground">
                                {countLabel}
                            </div>
                            <ActiveFilters
                                filters={filters}
                                onChange={handleFiltersChange}
                            />
                            {searchError && (
                                <p
                                    role="alert"
                                    className="text-sm text-destructive"
                                >
                                    {searchError}
                                </p>
                            )}
                        </div>
                        {results.length === 0 ? (
                            <p className="text-lg text-foreground/80">
                                No results
                                {similarSeed
                                    ? ` like “${headingFor(similarSeed)}”`
                                    : activeQuery
                                      ? ` for “${activeQuery}”`
                                      : ""}.{" "}
                                <span className="text-muted-foreground">
                                    {hasFilters(filters)
                                        ? "Speaker and year filters only match Conference and BYU Speeches; try loosening them."
                                        : "Try fewer or different words, or switch search mode."}
                                </span>
                            </p>
                        ) : (
                            <>
                                <RenderResults
                                    results={sortedResults}
                                    onMoreLike={showSimilar}
                                />
                                {canLoadMore && (
                                    <button
                                        type="button"
                                        onClick={handleLoadMore}
                                        disabled={loadingMore}
                                        className="mt-2 self-center rounded-md border border-primary px-5 py-2 text-sm font-semibold text-primary transition-colors hover:bg-accent disabled:opacity-60"
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
                {savedDrawer}
                {backendToast}
            </div>
        );
    }

    return (
        <div className="flex min-h-screen flex-col">
            <main className="gs-fade flex w-full flex-grow flex-col items-center justify-center px-6 py-12">
                <ConferenceBanner onSelect={() => setSources(["conference"])} />
                <h1 className="mb-3 text-center font-display text-4xl text-foreground sm:text-5xl md:text-[56px]">
                    Gospel Help
                </h1>
                <p className="mb-10 text-center text-base text-muted-foreground sm:text-lg">
                    A Gospel Library concordance of 135,000+ indexed items
                </p>

                <div className="w-full max-w-xl">{searchInput}</div>

                <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
                    {modeToggle(false)}
                    <SourcesFilter selected={sources} onChange={setSources} />
                    <ResultsCount
                        value={resultCount}
                        onChange={setResultCount}
                    />
                    <SavedButton
                        count={savedCount}
                        onClick={() => setSavedOpen(true)}
                    />
                    <InstallButton />
                    <ThemeToggle />
                </div>

                {/* Speaker/year filters are set from the results sidebar; if
                    the URL carries some, show them so they're not a surprise. */}
                <ActiveFilters
                    filters={filters}
                    onChange={setFilters}
                    className="mt-4 justify-center"
                />

                <div className="mt-8 flex justify-center">
                    <McpDialog />
                </div>
            </main>
            <Footer />
            {savedDrawer}
            {backendToast}
        </div>
    );
}
