import { cn } from "@/lib/utils";
import type { Source, SortKey, ResultCount } from "@/lib/types";
import { RESULT_COUNTS } from "@/lib/types";
import { Check } from "lucide-react";

const SOURCE_OPTIONS: { key: Source; label: string }[] = [
    { key: "bible", label: "Bible" },
    { key: "book-of-mormon", label: "Book of Mormon" },
    { key: "doctrine-and-covenants", label: "D&C" },
    { key: "pearl-of-great-price", label: "Pearl of Great Price" },
    { key: "conference", label: "Conference" },
    { key: "byu-speeches", label: "BYU Speeches" },
    { key: "handbook", label: "Handbook" },
];

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
    { key: "relevance", label: "Relevance" },
    { key: "date", label: "Newest first" },
];

interface FilterSidebarProps {
    // Empty array means "all sources".
    sources: Source[];
    onSourcesChange: (next: Source[]) => void;
    sortBy: SortKey;
    onSortChange: (next: SortKey) => void;
    // Per-source hit counts from the current result set.
    counts: Partial<Record<Source, number>>;
    total: number;
    // When provided, renders a "Show" group with the results-per-search
    // options (used by the collapsed mobile filter panel, where the header's
    // results-count drop-down is hidden).
    resultCount?: ResultCount;
    onResultCountChange?: (next: ResultCount) => void;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="mb-0.5 text-[13px] uppercase tracking-[0.2em] text-muted-foreground">
            {children}
        </div>
    );
}

function FilterLink({
    active,
    label,
    count,
    onClick,
}: {
    active: boolean;
    label: string;
    count?: number;
    onClick: () => void;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={active}
            onClick={onClick}
            className={cn(
                "group flex items-center gap-2.5 text-left text-base transition-colors",
                active ? "text-primary" : "text-foreground/90 hover:text-primary",
            )}
        >
            <span
                aria-hidden="true"
                className={cn(
                    "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[4px] border-[1.5px] transition-colors",
                    active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card text-transparent group-hover:border-primary/50",
                )}
            >
                <Check className="h-3 w-3" strokeWidth={3.5} />
            </span>
            <span>
                {label}
                {count !== undefined && count > 0 && (
                    <span className="ml-2 text-sm text-muted-foreground">
                        {count}
                    </span>
                )}
            </span>
        </button>
    );
}

export default function FilterSidebar({
    sources,
    onSourcesChange,
    sortBy,
    onSortChange,
    counts,
    total,
    resultCount,
    onResultCountChange,
}: FilterSidebarProps) {
    const isAll = sources.length === 0;

    const toggleSource = (key: Source) => {
        if (sources.includes(key)) {
            onSourcesChange(sources.filter((s) => s !== key));
        } else {
            onSourcesChange([...sources, key]);
        }
    };

    return (
        <div className="flex flex-row flex-wrap gap-x-12 gap-y-8 md:flex-col md:flex-nowrap md:gap-9">
            <div className="flex flex-col gap-2.5">
                <GroupLabel>Source</GroupLabel>
                <FilterLink
                    active={isAll}
                    label="All"
                    count={isAll ? total : undefined}
                    onClick={() => onSourcesChange([])}
                />
                {SOURCE_OPTIONS.map(({ key, label }) => (
                    <FilterLink
                        key={key}
                        active={sources.includes(key)}
                        label={label}
                        count={counts[key]}
                        onClick={() => toggleSource(key)}
                    />
                ))}
            </div>
            <div className="flex flex-col gap-2.5">
                <GroupLabel>Sort</GroupLabel>
                {SORT_OPTIONS.map(({ key, label }) => (
                    <FilterLink
                        key={key}
                        active={sortBy === key}
                        label={label}
                        onClick={() => onSortChange(key)}
                    />
                ))}
            </div>
            {resultCount !== undefined && onResultCountChange && (
                <div className="flex flex-col gap-2.5">
                    <GroupLabel>Show</GroupLabel>
                    {RESULT_COUNTS.map((n) => (
                        <FilterLink
                            key={n}
                            active={resultCount === n}
                            label={`${n} results`}
                            onClick={() => onResultCountChange(n)}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
