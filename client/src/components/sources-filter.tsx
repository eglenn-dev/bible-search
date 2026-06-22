import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { Source } from "@/lib/types";
import { Check, ChevronDown } from "lucide-react";

const OPTIONS: { key: Source; label: string }[] = [
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
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click or Escape.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("mousedown", onPointerDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onPointerDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const isAll = selected.length === 0;
    const summary = isAll
        ? "All sources"
        : selected.length === 1
          ? (OPTIONS.find((o) => o.key === selected[0])?.label ?? "1 source")
          : `${selected.length} sources`;

    const toggle = (key: Source) => {
        if (selected.includes(key)) {
            onChange(selected.filter((s) => s !== key));
        } else {
            onChange([...selected, key]);
        }
    };

    const rowClass = (active: boolean) =>
        cn(
            "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
            active
                ? "bg-primary/10 text-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
        );

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "inline-flex items-center gap-2 rounded-full border bg-card px-4 py-2.5 text-sm font-medium shadow-sm transition-colors select-none",
                    isAll
                        ? "border-border text-muted-foreground hover:text-foreground"
                        : "border-primary text-foreground",
                )}
            >
                <span>{summary}</span>
                <ChevronDown
                    className={cn(
                        "h-4 w-4 transition-transform",
                        open && "rotate-180",
                    )}
                />
            </button>

            {open && (
                <div
                    role="listbox"
                    aria-multiselectable="true"
                    className="absolute right-0 z-20 mt-2 w-56 rounded-xl border border-border bg-card p-1.5 shadow-lg"
                >
                    <button
                        type="button"
                        role="option"
                        aria-selected={isAll}
                        onClick={() => onChange([])}
                        className={rowClass(isAll)}
                    >
                        <span>All sources</span>
                        {isAll && <Check className="h-4 w-4 text-primary" />}
                    </button>
                    <div className="my-1 h-px bg-border" />
                    {OPTIONS.map(({ key, label }) => {
                        const active = selected.includes(key);
                        return (
                            <button
                                key={key}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => toggle(key)}
                                className={rowClass(active)}
                            >
                                <span>{label}</span>
                                {active && (
                                    <Check className="h-4 w-4 text-primary" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
