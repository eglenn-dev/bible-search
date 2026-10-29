import {
    Bookmark,
    MessageCircleQuestionMark,
    Search,
    Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type Tab = "search" | "ask" | "saved" | "settings";

// eslint-disable-next-line react-refresh/only-export-components
export const TABS: { key: Tab; label: string; Icon: typeof Search }[] = [
    { key: "search", label: "Search", Icon: Search },
    { key: "ask", label: "Ask", Icon: MessageCircleQuestionMark },
    { key: "saved", label: "Saved", Icon: Bookmark },
    { key: "settings", label: "Settings", Icon: Settings },
];

interface TabBarProps {
    tab: Tab;
    onSelect: (tab: Tab) => void;
    /** Shown as a badge on the Saved tab. */
    savedCount: number;
}

/** Floating glass capsule pinned above the home indicator, as in iOS 26. */
export default function TabBar({ tab, onSelect, savedCount }: TabBarProps) {
    const index = TABS.findIndex((t) => t.key === tab);

    return (
        <nav
            aria-label="Primary"
            className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-6 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]"
        >
            <div
                role="tablist"
                className="glass pointer-events-auto relative grid h-[62px] w-full max-w-[24rem] grid-cols-4 rounded-full p-1"
            >
                <span
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-y-1 left-1 w-[calc((100%-0.5rem)/4)] rounded-full bg-[var(--glass-thumb)] transition-transform duration-[350ms] ease-[cubic-bezier(0.3,1.3,0.5,1)]"
                    style={{ transform: `translateX(${index * 100}%)` }}
                />
                {TABS.map(({ key, label, Icon }) => {
                    const active = key === tab;
                    return (
                        <button
                            key={key}
                            type="button"
                            role="tab"
                            aria-selected={active}
                            onClick={() => onSelect(key)}
                            className={cn(
                                "relative z-10 flex flex-col items-center justify-center gap-0.5 rounded-full transition-[color,transform] active:scale-90",
                                active
                                    ? "text-primary"
                                    : "text-muted-foreground",
                            )}
                        >
                            <span className="relative">
                                <Icon
                                    className="h-[22px] w-[22px]"
                                    strokeWidth={active ? 2.4 : 2}
                                    fill={
                                        active && key === "saved"
                                            ? "currentColor"
                                            : "none"
                                    }
                                />
                                {key === "saved" && savedCount > 0 && !active && (
                                    <span className="absolute -right-3 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
                                        {savedCount > 99 ? "99+" : savedCount}
                                    </span>
                                )}
                            </span>
                            <span
                                className={cn(
                                    "text-[11px] leading-none",
                                    active && "font-semibold",
                                )}
                            >
                                {label}
                            </span>
                        </button>
                    );
                })}
            </div>
        </nav>
    );
}
