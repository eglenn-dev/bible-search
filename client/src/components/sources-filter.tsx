import { cn } from "@/lib/utils";
import type { Source } from "@/lib/types";

const OPTIONS: { key: Source | "all"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "bible", label: "Bible" },
    { key: "book-of-mormon", label: "Book of Mormon" },
    { key: "doctrine-and-covenants", label: "D&C" },
    { key: "pearl-of-great-price", label: "Pearl of Great Price" },
    { key: "conference", label: "Conference" },
    { key: "byu-speeches", label: "BYU Speeches" },
    { key: "handbook", label: "Handbook" },
];

interface SourcesFilterProps {
    // Empty array means "all sources".
    selected: Source[];
    onChange: (next: Source[]) => void;
}

export default function SourcesFilter({
    selected,
    onChange,
}: SourcesFilterProps) {
    const isAll = selected.length === 0;

    const toggle = (key: Source | "all") => {
        if (key === "all") {
            onChange([]);
            return;
        }
        if (selected.includes(key)) {
            onChange(selected.filter((s) => s !== key));
        } else {
            onChange([...selected, key]);
        }
    };

    return (
        <div className="flex flex-wrap items-center justify-center gap-2">
            {OPTIONS.map(({ key, label }) => {
                const active = key === "all" ? isAll : selected.includes(key);
                return (
                    <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggle(key)}
                        className={cn(
                            "rounded-full border px-4 py-1.5 text-sm font-medium transition-colors select-none",
                            active
                                ? "border-primary bg-primary text-primary-foreground shadow-sm"
                                : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                        )}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
