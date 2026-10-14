import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search as SearchIcon, X } from "lucide-react";
import type { SearchFilters } from "@/lib/types";
import { FIRST_YEAR } from "@/lib/types";
import {
    hasFilters,
    matchSpeakers,
    useSpeakers,
    yearRangeLabel,
    yearSpan,
} from "@/lib/speakers";
import { cn } from "@/lib/utils";

// Speaker picker, year range and active-filter chips, shared by the desktop
// filter sidebar ("sidebar") and the mobile filter sheet ("sheet"). The
// variants differ only in dress: the sheet uses larger, rounder touch targets
// and 17px text (anything under 16px makes iOS zoom the page on focus).
type Variant = "sidebar" | "sheet";

const YEARS: number[] = [];
for (let y = new Date().getFullYear(); y >= FIRST_YEAR; y--) YEARS.push(y);

const fieldClass = (variant: Variant) =>
    variant === "sheet"
        ? "h-11 rounded-[14px] bg-foreground/[0.07] text-[17px]"
        : "h-9 rounded-[2px] border border-input bg-card text-[15px] focus-within:border-primary";

interface SpeakerPickerProps {
    value: string | null;
    onChange: (speaker: string | null) => void;
    variant?: Variant;
}

/**
 * Searchable speaker combobox fed by GET /speakers. Typing filters by every
 * word (accent-insensitive); ↑/↓ and Enter pick, Escape closes. Once a
 * speaker is chosen it shows as a removable chip in place of the input.
 */
export function SpeakerPicker({
    value,
    onChange,
    variant = "sidebar",
}: SpeakerPickerProps) {
    const { speakers, error } = useSpeakers();
    const [text, setText] = useState("");
    const [open, setOpen] = useState(false);
    const [active, setActive] = useState(0);
    const ref = useRef<HTMLDivElement>(null);
    const listRef = useRef<HTMLUListElement>(null);
    const listId = useId();

    const matches = useMemo(
        () => (speakers ? matchSpeakers(speakers, text) : []),
        [speakers, text],
    );

    // Close on an outside click.
    useEffect(() => {
        if (!open) return;
        const onPointerDown = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", onPointerDown);
        return () => document.removeEventListener("mousedown", onPointerDown);
    }, [open]);

    // Keep the keyboard-highlighted option in view.
    useEffect(() => {
        listRef.current
            ?.querySelector<HTMLElement>(`[data-index="${active}"]`)
            ?.scrollIntoView({ block: "nearest" });
    }, [active]);

    const choose = (name: string) => {
        onChange(name);
        setText("");
        setOpen(false);
    };

    const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((i) => Math.max(0, Math.min(i + 1, matches.length - 1)));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter") {
            if (open && matches[active]) {
                e.preventDefault();
                choose(matches[active].name);
            }
        } else if (e.key === "Escape") {
            setOpen(false);
        }
    };

    if (value) {
        return (
            <div
                className={cn(
                    "flex items-center gap-2 pl-3 pr-1",
                    fieldClass(variant),
                    variant === "sidebar" && "border-primary",
                )}
            >
                <span className="min-w-0 flex-1 truncate font-semibold text-foreground">
                    {value}
                </span>
                <button
                    type="button"
                    onClick={() => onChange(null)}
                    aria-label={`Clear speaker ${value}`}
                    className={cn(
                        "flex flex-none items-center justify-center rounded-full text-muted-foreground transition-colors hover:text-foreground",
                        variant === "sheet" ? "h-9 w-9" : "h-7 w-7",
                    )}
                >
                    <X className="h-4 w-4" />
                </button>
            </div>
        );
    }

    const showList = open && speakers !== null;
    const list = (
        <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Speakers"
            className={cn(
                "overflow-y-auto overscroll-contain",
                variant === "sheet"
                    ? "mt-2 max-h-64 rounded-[14px] bg-foreground/[0.05] p-1"
                    : "absolute left-0 right-0 z-20 mt-1 max-h-72 rounded-md border border-border bg-card p-1 shadow-[var(--shadow-popover)]",
            )}
        >
            {matches.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">
                    No speakers match “{text}”.
                </li>
            ) : (
                matches.map((s, i) => (
                    <li
                        key={s.name}
                        id={`${listId}-${i}`}
                        data-index={i}
                        role="option"
                        aria-selected={i === active}
                        // Keep focus in the input so the list doesn't close
                        // before the click lands.
                        onMouseDown={(e) => e.preventDefault()}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => choose(s.name)}
                        className={cn(
                            "flex cursor-pointer flex-col rounded-sm px-3 py-1.5",
                            i === active
                                ? "bg-accent text-foreground"
                                : "text-foreground",
                        )}
                    >
                        <span
                            className={cn(
                                variant === "sheet" ? "text-[16px]" : "text-sm",
                            )}
                        >
                            {s.name}
                        </span>
                        <span className="text-xs text-muted-foreground">
                            {[
                                yearSpan(s),
                                `${s.talks} ${s.talks === 1 ? "talk" : "talks"}`,
                            ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                    </li>
                ))
            )}
        </ul>
    );

    return (
        <div ref={ref} className="relative">
            <div className={cn("flex items-center gap-2 px-3", fieldClass(variant))}>
                <SearchIcon
                    className="h-4 w-4 flex-none text-muted-foreground"
                    aria-hidden="true"
                />
                <input
                    type="text"
                    role="combobox"
                    aria-expanded={showList}
                    aria-controls={listId}
                    aria-autocomplete="list"
                    aria-activedescendant={
                        showList && matches[active]
                            ? `${listId}-${active}`
                            : undefined
                    }
                    aria-label="Filter by speaker"
                    disabled={error}
                    value={text}
                    onChange={(e) => {
                        setText(e.target.value);
                        setActive(0);
                        setOpen(true);
                    }}
                    onFocus={() => setOpen(true)}
                    onKeyDown={onKeyDown}
                    placeholder={
                        error
                            ? "Speakers unavailable"
                            : speakers === null
                              ? "Loading speakers…"
                              : "Any speaker"
                    }
                    className="min-w-0 flex-1 bg-transparent text-foreground outline-none placeholder:text-muted-foreground"
                />
            </div>
            {showList && list}
        </div>
    );
}

interface YearRangeProps {
    from: number | null;
    to: number | null;
    onChange: (next: { yearFrom: number | null; yearTo: number | null }) => void;
    variant?: Variant;
}

/** Inclusive from/to year pickers; "Any" leaves that end open. */
export function YearRange({
    from,
    to,
    onChange,
    variant = "sidebar",
}: YearRangeProps) {
    const select = (
        label: string,
        value: number | null,
        set: (v: number | null) => void,
        disabled: (y: number) => boolean,
    ) => (
        <label className="relative min-w-0 flex-1">
            <span className="sr-only">{label}</span>
            <select
                value={value ?? ""}
                onChange={(e) =>
                    set(e.target.value ? Number(e.target.value) : null)
                }
                className={cn(
                    "w-full appearance-none pl-3 pr-7 text-foreground outline-none",
                    fieldClass(variant),
                    value !== null && variant === "sidebar" && "border-primary",
                )}
            >
                <option value="">Any</option>
                {YEARS.map((y) => (
                    <option key={y} value={y} disabled={disabled(y)}>
                        {y}
                    </option>
                ))}
            </select>
            <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
        </label>
    );

    return (
        <div className="flex items-center gap-2">
            {select(
                "From year",
                from,
                (v) => onChange({ yearFrom: v, yearTo: to }),
                (y) => to !== null && y > to,
            )}
            <span className="text-sm text-muted-foreground">to</span>
            {select(
                "To year",
                to,
                (v) => onChange({ yearFrom: from, yearTo: v }),
                (y) => from !== null && y < from,
            )}
        </div>
    );
}

interface ActiveFiltersProps {
    filters: SearchFilters;
    onChange: (next: SearchFilters) => void;
    variant?: Variant;
    className?: string;
}

/** Removable chips for the active speaker / year filters (nothing if none). */
export function ActiveFilters({
    filters,
    onChange,
    variant = "sidebar",
    className,
}: ActiveFiltersProps) {
    if (!hasFilters(filters)) return null;
    const years = yearRangeLabel(filters);
    const chip = (label: React.ReactNode, ariaLabel: string, clear: () => void) => (
        <span
            className={cn(
                "inline-flex items-center gap-1 rounded-full bg-accent pl-3 pr-1 text-foreground",
                variant === "sheet" ? "h-9 text-[15px]" : "h-8 text-sm",
            )}
        >
            {label}
            <button
                type="button"
                onClick={clear}
                aria-label={ariaLabel}
                className="flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground"
            >
                <X className="h-3.5 w-3.5" />
            </button>
        </span>
    );

    return (
        <div className={cn("flex flex-wrap items-center gap-2", className)}>
            {filters.speaker &&
                chip(
                    <>
                        <span className="text-muted-foreground">Speaker:</span>
                        <span className="font-semibold">{filters.speaker}</span>
                    </>,
                    `Remove speaker filter ${filters.speaker}`,
                    () => onChange({ ...filters, speaker: null }),
                )}
            {years &&
                chip(
                    <>
                        <span className="text-muted-foreground">Years:</span>
                        <span className="font-semibold">{years}</span>
                    </>,
                    "Remove year filter",
                    () => onChange({ ...filters, yearFrom: null, yearTo: null }),
                )}
            {filters.speaker && years && (
                <button
                    type="button"
                    onClick={() =>
                        onChange({ speaker: null, yearFrom: null, yearTo: null })
                    }
                    className="px-1 text-sm text-primary hover:underline"
                >
                    Clear filters
                </button>
            )}
        </div>
    );
}
