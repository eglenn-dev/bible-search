import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
    Bookmark as BookmarkIcon,
    ChevronRight,
    BookOpen,
    SlidersHorizontal,
    Sparkles,
    WifiOff,
    X,
} from "lucide-react";
import { parseAsStringEnum, useQueryState } from "nuqs";
import type {
    Result,
    ResultCount,
    SearchFilters,
    SortKey,
    Source,
} from "@/lib/types";
import {
    bookmarkId,
    clearBookmarks,
    findBookmark,
    isSaved,
    restoreBookmarks,
    savedKeySet,
    toggleBookmark,
    useBookmarks,
} from "@/lib/bookmarks";
import type { RecentSearch } from "@/lib/recent-searches";
import { headingFor } from "@/lib/result-display";
import { hasFilters } from "@/lib/speakers";
import { requestPersistentStorage } from "@/lib/storage";
import { SIDEBAR_QUERY, SPLIT_QUERY, useMediaQuery } from "@/lib/use-is-mobile";
import { useOnline } from "@/lib/use-online";
import { cn } from "@/lib/utils";
import ConferenceBanner from "../conference-banner";
import { ActiveFilters } from "../speaker-year-filter";
import FilterSheet from "./filter-sheet";
import RecentSearches from "./recent-searches";
import ResultCard from "./result-card";
import ResultSheet from "./result-sheet";
import SavedTab from "./saved-tab";
import Segmented from "./segmented";
import SettingsTab from "./settings-tab";
import Sidebar from "./sidebar";
import TabBar, { TABS, type Tab } from "./tab-bar";

interface MobileAppProps {
    hasSearched: boolean;
    /** Already sorted for display. */
    results: Result[];
    activeQuery: string;
    queryType: "natural" | "scripture";
    onQueryTypeChange: (type: "natural" | "scripture") => void;
    /** The SearchBox / ScriptureBox for the current mode, in mobile dress. */
    searchInput: React.ReactNode;
    sources: Source[];
    onSourcesChange: (next: Source[]) => void;
    sortBy: SortKey;
    onSortChange: (next: SortKey) => void;
    resultCount: ResultCount;
    onResultCountChange: (next: ResultCount) => void;
    sourceCounts: Partial<Record<Source, number>>;
    filters: SearchFilters;
    onFiltersChange: (next: SearchFilters) => void;
    /** Why the last filter change couldn't re-run the search, if it failed. */
    searchError: string | null;
    canLoadMore: boolean;
    loadingMore: boolean;
    onLoadMore: () => void;
    onGoHome: () => void;
    /** The passage the results are "more like", while that view is up. */
    similarSeed: Result | null;
    onMoreLike: (result: Result) => void;
    onLeaveSimilar: () => void;
    /** Re-runs a search from the start screen's "Recent searches". */
    onRunRecent: (search: RecentSearch) => void;
}

const MODE_OPTIONS = [
    { value: "natural", label: "Natural" },
    { value: "scripture", label: "Reference" },
] as const;

interface Toast {
    id: number;
    message: string;
    undo?: () => void;
}

// Clears the floating tab bar (62px + its offset) at the end of every tab.
const TAB_PADDING = "pb-[calc(env(safe-area-inset-bottom)+6.5rem)]";
// With the sidebar there's no tab bar to clear.
const SIDEBAR_PADDING = "pb-[calc(env(safe-area-inset-bottom)+2.5rem)]";

/**
 * The app layout: three tabs, results as cards, and bookmarks. On a phone
 * the tabs sit under a floating glass tab bar and a result opens in a sheet.
 * Installed on an iPad or a computer, the tab bar becomes a sidebar and, from
 * iPad-landscape width, the open result gets its own pane beside the list.
 * App owns the search state and hands it in, so this and the desktop layout
 * are two views of one search.
 */
export default function MobileApp({
    hasSearched,
    results,
    activeQuery,
    queryType,
    onQueryTypeChange,
    searchInput,
    sources,
    onSourcesChange,
    sortBy,
    onSortChange,
    resultCount,
    onResultCountChange,
    sourceCounts,
    filters,
    onFiltersChange,
    searchError,
    canLoadMore,
    loadingMore,
    onLoadMore,
    onGoHome,
    similarSeed,
    onMoreLike,
    onLeaveSimilar,
    onRunRecent,
}: MobileAppProps) {
    // In the URL like the other settings, so a reload or coming back from
    // /stats returns to the tab you were on.
    const [tab, setTab] = useQueryState(
        "tab",
        parseAsStringEnum<Tab>(TABS.map((t) => t.key)).withDefault("search"),
    );
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [openResult, setOpenResult] = useState<Result | null>(null);
    const [toast, setToast] = useState<Toast | null>(null);

    const online = useOnline();
    // Only the installed app is this wide in the shell (see useAppShell).
    const sidebar = useMediaQuery(SIDEBAR_QUERY);
    const wide = useMediaQuery(SPLIT_QUERY);
    // Settings has nothing to show beside it, so it gets the full width.
    const split = wide && tab !== "settings";
    const tabPadding = sidebar ? SIDEBAR_PADDING : TAB_PADDING;

    const bookmarks = useBookmarks();

    // Someone with saved passages is worth protecting from storage eviction.
    const hasBookmarks = bookmarks.length > 0;
    useEffect(() => {
        if (hasBookmarks) void requestPersistentStorage();
    }, [hasBookmarks]);
    // Matches by API id and by the older url+text key, so passages saved
    // before results carried ids still show as saved.
    const savedIds = useMemo(() => savedKeySet(bookmarks), [bookmarks]);

    // The tabs share the document scroller, so each one's position is put
    // back by hand when you return to it.
    const scrollByTab = useRef<Record<Tab, number>>({
        search: 0,
        saved: 0,
        settings: 0,
    });

    const selectTab = (next: Tab) => {
        if (next !== tab) {
            scrollByTab.current[tab] = window.scrollY;
            setTab(next);
            return;
        }
        // Tapping the tab you're on: back to the top, then (on Search) back
        // to the start screen — the iOS "pop to root".
        if (window.scrollY > 0) {
            window.scrollTo({ top: 0, behavior: "smooth" });
        } else if (next === "search" && hasSearched) {
            onGoHome();
        }
    };

    useLayoutEffect(() => {
        window.scrollTo(0, scrollByTab.current[tab]);
    }, [tab]);

    // The search header only gets its blur-and-fade edge once content is
    // actually sliding under it, i.e. once `position: sticky` has pinned it
    // and it has parted from the marker that sits just above it in the flow.
    const headerRef = useRef<HTMLDivElement>(null);
    const markerRef = useRef<HTMLDivElement>(null);
    const [headerStuck, setHeaderStuck] = useState(false);

    useEffect(() => {
        const measure = () => {
            const header = headerRef.current;
            const marker = markerRef.current;
            if (!header || !marker) return;
            setHeaderStuck(
                header.getBoundingClientRect().top -
                    marker.getBoundingClientRect().bottom >
                    1,
            );
        };
        measure();
        window.addEventListener("scroll", measure, { passive: true });
        return () => window.removeEventListener("scroll", measure);
    }, [tab, hasSearched]);

    // A fresh result list starts at the top, not wherever the last one was.
    useEffect(() => {
        if (tab === "search") window.scrollTo(0, 0);
        else scrollByTab.current.search = 0;
        // Only when the results themselves change.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [results]);

    useEffect(() => {
        if (!toast) return;
        const timer = setTimeout(() => setToast(null), toast.undo ? 4500 : 2200);
        return () => clearTimeout(timer);
    }, [toast]);

    const notify = (message: string, undo?: () => void) =>
        setToast({ id: Date.now(), message, undo });

    const toggleSaved = (result: Result) => {
        const existing = findBookmark(bookmarks, result);
        if (toggleBookmark(result) === "added") {
            notify("Saved");
        } else {
            notify(
                "Removed from Saved",
                existing && (() => restoreBookmarks([existing])),
            );
        }
    };

    const clearSaved = () => {
        const removed = bookmarks;
        clearBookmarks();
        notify(
            `Removed ${removed.length} ${removed.length === 1 ? "passage" : "passages"}`,
            () => restoreBookmarks(removed),
        );
    };

    // Sources, speaker and year range each count as one active filter.
    const filterCount =
        sources.length +
        (filters.speaker ? 1 : 0) +
        (filters.yearFrom !== null || filters.yearTo !== null ? 1 : 0);

    const countLabel =
        (results.length === 1 ? "1 result" : `${results.length} results`) +
        (similarSeed
            ? " — more like this"
            : queryType === "scripture"
              ? " — reference lookup"
              : "");

    // From the sheet (possibly over the Saved tab): close it and show the
    // similar passages on the Search tab.
    const moreLike = (result: Result) => {
        setOpenResult(null);
        if (tab !== "search") selectTab("search");
        onMoreLike(result);
    };

    const offlineNotice = !online && (
        <div
            role="status"
            className="gs-fade mb-3 flex items-start gap-3 rounded-[22px] border border-border/70 bg-[var(--app-card)] px-4 py-3.5"
        >
            <WifiOff className="mt-0.5 h-5 w-5 flex-none text-primary" />
            <p className="text-[15px] leading-snug text-muted-foreground">
                <span className="font-semibold text-foreground">
                    You’re offline.
                </span>{" "}
                Saved passages and recent searches still open; new searches
                will work again once you’re connected.
            </p>
        </div>
    );

    const similarBanner = similarSeed && (
        <div className="gs-fade mb-3 flex items-center gap-3 rounded-[22px] border border-border/70 bg-[var(--app-card)] py-2.5 pl-4 pr-1.5">
            <Sparkles className="h-5 w-5 flex-none text-primary" />
            <div className="min-w-0 flex-1">
                <div className="text-[13px] text-muted-foreground">
                    More like
                </div>
                <div className="truncate text-[15px] font-semibold text-foreground">
                    {headingFor(similarSeed)}
                </div>
            </div>
            <button
                type="button"
                onClick={onLeaveSimilar}
                aria-label={activeQuery ? "Back to search results" : "Clear"}
                className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90"
            >
                <X className="h-5 w-5" />
            </button>
        </div>
    );

    const openKey = openResult ? bookmarkId(openResult) : null;
    const isOpen = (result: Result) =>
        split && openKey !== null && bookmarkId(result) === openKey;

    return (
        <div
            className={cn(
                "mobile-app relative isolate min-h-dvh",
                sidebar && "flex items-start",
            )}
        >
            <div aria-hidden="true" className="app-wash" />

            {sidebar && (
                <Sidebar
                    tab={tab}
                    onSelect={selectTab}
                    savedCount={bookmarks.length}
                />
            )}

            {/* The tabs' column. With the sidebar it's capped at a reading
                width; the document still does the scrolling. */}
            <div
                className={cn(
                    sidebar && "mx-auto w-full min-w-0 max-w-[44rem] flex-1 px-2",
                )}
            >
            {/* Search stays mounted (and merely hidden) on the other tabs so
                the query, results and any in-flight request survive. */}
            <div
                role="tabpanel"
                aria-label="Search"
                className={cn(
                    "pt-[env(safe-area-inset-top)]",
                    tabPadding,
                    tab !== "search" &&
                        "pointer-events-none invisible fixed inset-0 overflow-hidden",
                )}
            >
                {!hasSearched && (
                    <div className="gs-fade px-4 pt-5">
                        <h1 className="font-display text-[34px] font-semibold leading-tight text-foreground">
                            Gospel Help
                        </h1>
                        <p className="mt-1 text-[15px] text-muted-foreground">
                            A Gospel Library concordance of 135,000+ indexed
                            items
                        </p>
                    </div>
                )}

                <div ref={markerRef} aria-hidden="true" />
                <div
                    ref={headerRef}
                    data-stuck={headerStuck}
                    className="glass-edge-top sticky top-[env(safe-area-inset-top)] z-30 px-4 pb-3 pt-3"
                >
                    {searchInput}
                    <div className="mt-2.5 flex items-center gap-2.5">
                        <Segmented
                            className="flex-1"
                            label="Search mode"
                            value={queryType}
                            onChange={onQueryTypeChange}
                            options={MODE_OPTIONS}
                        />
                        <button
                            type="button"
                            onClick={() => setFiltersOpen(true)}
                            aria-label={
                                filterCount > 0
                                    ? `Filters, ${filterCount} active`
                                    : "Filters"
                            }
                            className="glass relative flex h-11 w-11 flex-none items-center justify-center rounded-full text-foreground transition-transform active:scale-90"
                        >
                            <SlidersHorizontal className="h-5 w-5" />
                            {filterCount > 0 && (
                                <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[11px] font-bold leading-none text-primary-foreground">
                                    {filterCount}
                                </span>
                            )}
                        </button>
                    </div>
                </div>

                <div className="px-4 pt-1">
                    {offlineNotice}
                    <ActiveFilters
                        variant="sheet"
                        filters={filters}
                        onChange={onFiltersChange}
                        className="px-1 pb-2"
                    />
                    {searchError && (
                        <p
                            role="alert"
                            className="px-1 pb-2 text-[15px] text-destructive"
                        >
                            {searchError}
                        </p>
                    )}
                    {!hasSearched ? (
                        <div className="gs-fade flex flex-col">
                            <div className="mt-3 flex justify-center">
                                <ConferenceBanner
                                    onSelect={() =>
                                        onSourcesChange(["conference"])
                                    }
                                />
                            </div>
                            <RecentSearches
                                onRun={onRunRecent}
                                online={online}
                            />
                            {bookmarks.length === 0 ? (
                                // First visit: say what the Saved tab is for.
                                <div className="mt-2 flex items-start gap-3 rounded-[22px] border border-border/70 bg-[var(--app-card)] px-4 py-3.5">
                                    <BookmarkIcon className="mt-0.5 h-5 w-5 flex-none text-primary" />
                                    <p className="text-[15px] leading-snug text-muted-foreground">
                                        <span className="font-semibold text-foreground">
                                            Keep what you find.
                                        </span>{" "}
                                        Tap the bookmark on any result and it
                                        will be waiting for you under Saved.
                                    </p>
                                </div>
                            ) : (
                                <section className="mt-2">
                                    <div className="mb-2.5 flex items-baseline justify-between px-1">
                                        <h2 className="font-sans text-[20px] font-semibold text-foreground">
                                            Recently saved
                                        </h2>
                                        <button
                                            type="button"
                                            onClick={() => selectTab("saved")}
                                            className="flex items-center text-[15px] text-primary"
                                        >
                                            See all
                                            <ChevronRight className="h-4 w-4" />
                                        </button>
                                    </div>
                                    <div className="flex flex-col gap-3">
                                        {bookmarks.slice(0, 3).map((b) => (
                                            <ResultCard
                                                key={b.id}
                                                result={b.result}
                                                saved
                                                selected={isOpen(b.result)}
                                                onOpen={() =>
                                                    setOpenResult(b.result)
                                                }
                                                onToggleSaved={() =>
                                                    toggleSaved(b.result)
                                                }
                                            />
                                        ))}
                                    </div>
                                </section>
                            )}
                        </div>
                    ) : results.length === 0 ? (
                        <>
                            {similarBanner}
                            <p className="gs-fade px-1 pt-6 text-[17px] text-foreground/80">
                                No results
                                {similarSeed
                                    ? ` like “${headingFor(similarSeed)}”`
                                    : activeQuery
                                      ? ` for “${activeQuery}”`
                                      : ""}
                                .{" "}
                                <span className="text-muted-foreground">
                                    {hasFilters(filters)
                                        ? "Speaker and year filters only match Conference and BYU Speeches; try loosening them."
                                        : "Try fewer or different words, or switch search mode."}
                                </span>
                            </p>
                        </>
                    ) : (
                        <>
                            {similarBanner}
                            <div className="px-1 pb-2.5 pt-1 text-[13px] text-muted-foreground">
                                {countLabel}
                            </div>
                            <div className="flex flex-col gap-3">
                                {results.map((result, index) => (
                                    <ResultCard
                                        key={`${bookmarkId(result)}-${index}`}
                                        result={result}
                                        saved={isSaved(savedIds, result)}
                                        selected={isOpen(result)}
                                        onOpen={() => setOpenResult(result)}
                                        onToggleSaved={() =>
                                            toggleSaved(result)
                                        }
                                        showScore
                                        style={{
                                            animation: `gsFade .4s ease ${Math.min(index, 8) * 45}ms both`,
                                        }}
                                    />
                                ))}
                            </div>
                            {canLoadMore && (
                                <div className="mt-5 flex justify-center">
                                    <button
                                        type="button"
                                        onClick={onLoadMore}
                                        disabled={loadingMore}
                                        className="glass h-12 rounded-full px-6 text-[15px] font-semibold text-primary transition-transform active:scale-95 disabled:opacity-60"
                                    >
                                        {loadingMore
                                            ? "Loading…"
                                            : "Load more results"}
                                    </button>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {tab === "saved" && (
                <div
                    role="tabpanel"
                    aria-label="Saved"
                    className={cn("gs-fade", tabPadding)}
                >
                    <SavedTab
                        bookmarks={bookmarks}
                        isOpen={isOpen}
                        onOpen={setOpenResult}
                        onToggleSaved={toggleSaved}
                        onNotify={notify}
                    />
                </div>
            )}

            {tab === "settings" && (
                <div
                    role="tabpanel"
                    aria-label="Settings"
                    className={cn("gs-fade", tabPadding)}
                >
                    <SettingsTab
                        savedCount={bookmarks.length}
                        onClearSaved={clearSaved}
                    />
                </div>
            )}

            </div>

            {split && (
                <aside className="sticky top-0 flex h-dvh w-[min(40vw,34rem)] flex-none flex-col pr-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                    {openResult ? (
                        <ResultSheet
                            // A fresh pane (scrolled to the top, context
                            // collapsed) for each passage.
                            key={openKey}
                            variant="pane"
                            result={openResult}
                            savedIds={savedIds}
                            onClose={() => setOpenResult(null)}
                            onToggleSaved={toggleSaved}
                            onNotify={notify}
                            onMoreLike={moreLike}
                        />
                    ) : (
                        <div className="flex h-full flex-col items-center justify-center gap-3 rounded-[30px] border border-dashed border-border px-8 text-center">
                            <BookOpen className="h-8 w-8 text-muted-foreground/70" />
                            <p className="text-[15px] text-muted-foreground">
                                Choose a passage to read it here.
                            </p>
                        </div>
                    )}
                </aside>
            )}

            {!sidebar && (
                <TabBar
                    tab={tab}
                    onSelect={selectTab}
                    savedCount={bookmarks.length}
                />
            )}

            <FilterSheet
                open={filtersOpen}
                onOpenChange={setFiltersOpen}
                sources={sources}
                onSourcesChange={onSourcesChange}
                sortBy={sortBy}
                onSortChange={onSortChange}
                resultCount={resultCount}
                onResultCountChange={onResultCountChange}
                counts={sourceCounts}
                filters={filters}
                onFiltersChange={onFiltersChange}
            />

            <ResultSheet
                // Wide screens read in the pane (hidden on Settings), never
                // in a modal.
                result={wide ? null : openResult}
                savedIds={savedIds}
                onClose={() => setOpenResult(null)}
                onToggleSaved={toggleSaved}
                onNotify={notify}
                onMoreLike={moreLike}
            />

            {/* Above sheets (z-50) so "Saved" confirms from inside one too. */}
            <div
                aria-live="polite"
                className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.625rem)] z-[60] flex justify-center px-4"
            >
                {toast && (
                    <div
                        key={toast.id}
                        className="glass-thick pointer-events-auto flex h-11 items-center gap-3 rounded-full pl-5 pr-5 text-[15px] font-semibold text-foreground duration-300 animate-in fade-in-0 slide-in-from-top-4"
                    >
                        {toast.message}
                        {toast.undo && (
                            <button
                                type="button"
                                onClick={() => {
                                    toast.undo?.();
                                    setToast(null);
                                }}
                                className="-mr-2 rounded-full px-2 py-1 text-primary"
                            >
                                Undo
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
