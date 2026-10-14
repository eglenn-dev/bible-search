import { Check } from "lucide-react";
import type { ResultCount, SearchFilters, SortKey, Source } from "@/lib/types";
import { RESULT_COUNTS, SOURCES } from "@/lib/types";
import { SOURCE_LABELS } from "@/lib/result-display";
import { cn } from "@/lib/utils";
import { SpeakerPicker, YearRange } from "../speaker-year-filter";
import Segmented from "./segmented";
import Sheet from "./sheet";

interface FilterSheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    // Empty array means "all sources".
    sources: Source[];
    onSourcesChange: (next: Source[]) => void;
    sortBy: SortKey;
    onSortChange: (next: SortKey) => void;
    resultCount: ResultCount;
    onResultCountChange: (next: ResultCount) => void;
    // Per-source hit counts from the current result set.
    counts: Partial<Record<Source, number>>;
    // Speaker + year range (conference / BYU Speeches only).
    filters: SearchFilters;
    onFiltersChange: (next: SearchFilters) => void;
}

const SORT_OPTIONS = [
    { value: "relevance", label: "Relevance" },
    { value: "date", label: "Newest first" },
] as const;

const COUNT_OPTIONS = RESULT_COUNTS.map((n) => ({
    value: n,
    label: String(n),
}));

function Group({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <section>
            <h3 className="mb-2.5 font-sans text-[13px] font-semibold text-muted-foreground">
                {label}
            </h3>
            {children}
        </section>
    );
}

function Chip({
    active,
    count,
    onClick,
    children,
}: {
    active: boolean;
    count?: number;
    onClick: () => void;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={onClick}
            className={cn(
                "inline-flex h-10 items-center gap-1.5 rounded-full px-4 text-[15px] transition-[transform,background-color,color] active:scale-95",
                active
                    ? "bg-primary font-semibold text-primary-foreground"
                    : "bg-foreground/[0.07] text-foreground",
            )}
        >
            {active && <Check className="-ml-1 h-4 w-4" strokeWidth={3} />}
            {children}
            {count !== undefined && count > 0 && (
                <span
                    className={cn(
                        "text-[13px] tabular-nums",
                        active
                            ? "text-primary-foreground/80"
                            : "text-muted-foreground",
                    )}
                >
                    {count}
                </span>
            )}
        </button>
    );
}

/**
 * Source, speaker, year, sort and result-count controls — the desktop
 * sidebar as a sheet.
 */
export default function FilterSheet({
    open,
    onOpenChange,
    sources,
    onSourcesChange,
    sortBy,
    onSortChange,
    resultCount,
    onResultCountChange,
    counts,
    filters,
    onFiltersChange,
}: FilterSheetProps) {
    const isAll = sources.length === 0;

    const toggleSource = (key: Source) => {
        onSourcesChange(
            sources.includes(key)
                ? sources.filter((s) => s !== key)
                : [...sources, key],
        );
    };

    return (
        <Sheet open={open} onOpenChange={onOpenChange} title="Filters">
            <div className="flex flex-col gap-6 pt-1">
                <Group label="Sources">
                    <div className="flex flex-wrap gap-2">
                        <Chip active={isAll} onClick={() => onSourcesChange([])}>
                            All
                        </Chip>
                        {SOURCES.map((key) => (
                            <Chip
                                key={key}
                                active={sources.includes(key)}
                                count={counts[key]}
                                onClick={() => toggleSource(key)}
                            >
                                {SOURCE_LABELS[key]}
                            </Chip>
                        ))}
                    </div>
                </Group>
                <Group label="Speaker">
                    <SpeakerPicker
                        variant="sheet"
                        value={filters.speaker}
                        onChange={(speaker) =>
                            onFiltersChange({ ...filters, speaker })
                        }
                    />
                </Group>
                <Group label="Years">
                    <YearRange
                        variant="sheet"
                        from={filters.yearFrom}
                        to={filters.yearTo}
                        onChange={(years) =>
                            onFiltersChange({ ...filters, ...years })
                        }
                    />
                    <p className="mt-2 text-[13px] leading-snug text-muted-foreground">
                        Speaker and year filters only match Conference and
                        BYU Speeches.
                    </p>
                </Group>
                <Group label="Sort by">
                    <Segmented
                        inset
                        label="Sort by"
                        value={sortBy}
                        onChange={onSortChange}
                        options={SORT_OPTIONS}
                    />
                </Group>
                <Group label="Results per search">
                    <Segmented
                        inset
                        label="Results per search"
                        value={resultCount}
                        onChange={onResultCountChange}
                        options={COUNT_OPTIONS}
                    />
                </Group>
            </div>
        </Sheet>
    );
}
