import { cn } from "@/lib/utils";
import type { SortKey } from "@/lib/types";

const OPTIONS: { key: SortKey; label: string }[] = [
    { key: "relevance", label: "Relevance" },
    { key: "date", label: "Newest" },
];

interface SortControlProps {
    sortBy: SortKey;
    onChange: (next: SortKey) => void;
    count: number;
}

export default function SortControl({
    sortBy,
    onChange,
    count,
}: SortControlProps) {
    return (
        <div className="mb-4 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
                {count} result{count === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-1.5">
                <span className="hidden text-xs text-muted-foreground sm:inline">
                    Sort
                </span>
                <div className="inline-flex rounded-full border border-border bg-card p-0.5 shadow-sm">
                    {OPTIONS.map(({ key, label }) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => onChange(key)}
                            className={cn(
                                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                                sortBy === key
                                    ? "bg-primary text-primary-foreground shadow-sm"
                                    : "text-muted-foreground hover:text-foreground",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}
