import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { RESULT_COUNTS, type ResultCount } from "@/lib/types";
import { Check, ChevronDown } from "lucide-react";

interface ResultsCountProps {
    value: ResultCount;
    onChange: (next: ResultCount) => void;
    // Compact matches the header's mode-toggle pill height; default matches
    // the larger hero controls.
    compact?: boolean;
}

export default function ResultsCount({
    value,
    onChange,
    compact = false,
}: ResultsCountProps) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click or Escape (mirrors SourcesFilter).
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

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "inline-flex select-none items-center gap-2 rounded-full border-[1.5px] border-input bg-card text-muted-foreground transition-colors hover:text-foreground",
                    compact
                        ? "px-3.5 py-2 text-sm"
                        : "px-4 py-2.5 text-sm font-medium shadow-sm",
                )}
            >
                <span>{value} results</span>
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
                    className="absolute left-0 z-20 mt-2 w-40 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-card p-1.5 shadow-lg sm:left-auto sm:right-0"
                >
                    {RESULT_COUNTS.map((n) => {
                        const active = n === value;
                        return (
                            <button
                                key={n}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                    onChange(n);
                                    setOpen(false);
                                }}
                                className={cn(
                                    "flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors",
                                    active
                                        ? "bg-primary/10 text-foreground"
                                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                                )}
                            >
                                <span>{n} results</span>
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
