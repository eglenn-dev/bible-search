import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Monitor, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTheme, type Theme } from "@/lib/theme";

const OPTIONS: { key: Theme; label: string; Icon: typeof Sun }[] = [
    { key: "light", label: "Light", Icon: Sun },
    { key: "dark", label: "Dark", Icon: Moon },
    { key: "system", label: "System", Icon: Monitor },
];

interface ThemeToggleProps {
    // Icon-only trigger for the crowded result/stats headers; the default
    // labelled pill matches the hero controls (SourcesFilter, ResultsCount).
    compact?: boolean;
}

export default function ThemeToggle({ compact = false }: ThemeToggleProps) {
    const { theme, setTheme } = useTheme();
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    // Close on outside click or Escape (mirrors ResultsCount / SourcesFilter).
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

    const current = OPTIONS.find((o) => o.key === theme) ?? OPTIONS[2];
    const CurrentIcon = current.Icon;

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={`Theme: ${current.label}`}
                title={`Theme: ${current.label}`}
                onClick={() => setOpen((v) => !v)}
                className={cn(
                    "inline-flex select-none items-center gap-2 rounded-full border-[1.5px] border-input bg-card text-muted-foreground transition-colors hover:text-foreground",
                    compact
                        ? "px-2.5 py-2"
                        : "px-4 py-2.5 text-sm font-medium shadow-sm",
                )}
            >
                <CurrentIcon className="h-4 w-4" />
                {!compact && (
                    <>
                        <span>{current.label}</span>
                        <ChevronDown
                            className={cn(
                                "h-4 w-4 transition-transform",
                                open && "rotate-180",
                            )}
                        />
                    </>
                )}
            </button>

            {open && (
                <div
                    role="listbox"
                    aria-label="Theme"
                    className="absolute right-0 z-20 mt-2 w-40 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-popover p-1.5 shadow-lg"
                >
                    {OPTIONS.map(({ key, label, Icon }) => {
                        const active = key === theme;
                        return (
                            <button
                                key={key}
                                type="button"
                                role="option"
                                aria-selected={active}
                                onClick={() => {
                                    setTheme(key);
                                    setOpen(false);
                                }}
                                className={cn(
                                    "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
                                    active
                                        ? "bg-primary/10 text-foreground"
                                        : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                                )}
                            >
                                <Icon className="h-4 w-4 flex-none" />
                                <span>{label}</span>
                                {active && (
                                    <Check className="ml-auto h-4 w-4 flex-none text-primary" />
                                )}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
