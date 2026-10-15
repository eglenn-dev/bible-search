import { useMemo } from "react";
import { BookOpen, History } from "lucide-react";
import {
    clearRecentSearches,
    recentKey,
    useCachedUrls,
    useRecentSearches,
    type RecentSearch,
} from "@/lib/recent-searches";
import { searchUrl } from "@/lib/search";
import { SOURCE_LABELS } from "@/lib/result-display";
import { cn } from "@/lib/utils";

interface RecentSearchesProps {
    onRun: (search: RecentSearch) => void;
    /** Offline: grey out the searches with no cached answer. */
    online: boolean;
}

const SHOWN = 5;

/** What narrowed the search, for the row's second line. */
function detailFor(r: RecentSearch): string | null {
    const parts: string[] = [];
    if (r.sources.length === 1) parts.push(SOURCE_LABELS[r.sources[0]]);
    else if (r.sources.length > 1) parts.push(`${r.sources.length} sources`);
    if (r.filters.speaker) parts.push(r.filters.speaker);
    if (r.filters.yearFrom !== null || r.filters.yearTo !== null)
        parts.push(
            `${r.filters.yearFrom ?? "…"}–${r.filters.yearTo ?? "…"}`,
        );
    return parts.length ? parts.join(" · ") : null;
}

/** The start screen's "Recent searches": tap one to run it again. */
export default function RecentSearches({ onRun, online }: RecentSearchesProps) {
    const recent = useRecentSearches().slice(0, SHOWN);
    const urls = useMemo(() => recent.map((r) => searchUrl(r)), [recent]);
    const cached = useCachedUrls(urls, !online);

    if (recent.length === 0) return null;

    return (
        <section className="mt-2">
            <div className="mb-2.5 flex items-baseline justify-between px-1">
                <h2 className="font-sans text-[20px] font-semibold text-foreground">
                    Recent searches
                </h2>
                <button
                    type="button"
                    onClick={clearRecentSearches}
                    className="text-[15px] text-primary"
                >
                    Clear
                </button>
            </div>
            <div className="overflow-hidden rounded-[22px] border border-border/70 bg-[var(--app-card)]">
                {recent.map((r, i) => {
                    const available = online || cached.has(urls[i]);
                    const detail = detailFor(r);
                    const Icon = r.queryType === "scripture" ? BookOpen : History;
                    return (
                        <div key={recentKey(r)}>
                            {i > 0 && <div className="ml-12 h-px bg-border" />}
                            <button
                                type="button"
                                onClick={() => onRun(r)}
                                disabled={!available}
                                className={cn(
                                    "flex min-h-[52px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-foreground/[0.06]",
                                    !available && "opacity-45",
                                )}
                            >
                                <Icon className="h-5 w-5 flex-none text-muted-foreground" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[16px] text-foreground">
                                        {r.query}
                                    </span>
                                    {(detail || !available) && (
                                        <span className="block truncate text-[13px] text-muted-foreground">
                                            {!available
                                                ? "Not saved for offline"
                                                : detail}
                                        </span>
                                    )}
                                </span>
                            </button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
