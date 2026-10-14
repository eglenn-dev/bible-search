import { cn } from "@/lib/utils";
import type { Source, SortKey, SearchFilters } from "@/lib/types";
import { Check } from "lucide-react";
import { SpeakerPicker, YearRange } from "./speaker-year-filter";

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
    // Speaker + year range (conference / BYU Speeches only).
    filters: SearchFilters;
    onFiltersChange: (next: SearchFilters) => void;
}

function GroupLabel({ children }: { children: React.ReactNode }) {
    return (
        <div className="mb-0.5 text-sm font-bold text-foreground">
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
                "group flex items-center gap-2.5 text-left text-[15px] text-foreground transition-colors",
                !active && "hover:text-primary",
            )}
        >
            <span
                aria-hidden="true"
                className={cn(
                    "flex h-[18px] w-[18px] flex-none items-center justify-center rounded-[2px] border transition-colors",
                    active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-input bg-card text-transparent group-hover:border-primary",
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
    filters,
    onFiltersChange,
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
        <div className="flex flex-row flex-wrap gap-x-12 gap-y-8 md:flex-col md:flex-nowrap md:gap-7">
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
                <GroupLabel>Speaker</GroupLabel>
                <SpeakerPicker
                    value={filters.speaker}
                    onChange={(speaker) =>
                        onFiltersChange({ ...filters, speaker })
                    }
                />
            </div>
            <div className="flex flex-col gap-2.5">
                <GroupLabel>Years</GroupLabel>
                <YearRange
                    from={filters.yearFrom}
                    to={filters.yearTo}
                    onChange={(years) =>
                        onFiltersChange({ ...filters, ...years })
                    }
                />
                <p className="text-xs leading-snug text-muted-foreground">
                    Speaker and year filters only match Conference and BYU
                    Speeches.
                </p>
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
        </div>
    );
}
