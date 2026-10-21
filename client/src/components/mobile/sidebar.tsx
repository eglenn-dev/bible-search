import { cn } from "@/lib/utils";
import { TABS, type Tab } from "./tab-bar";

interface SidebarProps {
    tab: Tab;
    onSelect: (tab: Tab) => void;
    /** Shown as a count beside Saved. */
    savedCount: number;
}

/**
 * The tab bar's wide-screen form, as in iPadOS 26: a floating glass sidebar
 * inset from the window edges. Only the installed app reaches this width in
 * the shell (a browser this wide gets the desktop layout).
 */
export default function Sidebar({ tab, onSelect, savedCount }: SidebarProps) {
    return (
        <nav
            aria-label="Primary"
            className="sticky top-0 flex h-dvh w-56 flex-none flex-col pl-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+0.75rem)] xl:w-64"
        >
            <div className="glass flex flex-1 flex-col rounded-[30px] p-2">
                <div className="flex items-center gap-2.5 px-3 pb-5 pt-3">
                    <img
                        src="/icon-192.png"
                        alt=""
                        className="h-8 w-8 rounded-[9px]"
                    />
                    <span className="font-display text-[20px] font-semibold leading-none text-foreground">
                        Gospel Help
                    </span>
                </div>
                <div
                    role="tablist"
                    aria-orientation="vertical"
                    className="flex flex-col gap-1"
                >
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
                                    "flex h-11 items-center gap-3 rounded-full px-3.5 text-[16px] transition-[background-color,color,transform] active:scale-[0.97]",
                                    active
                                        ? "bg-[var(--glass-thumb)] font-semibold text-primary"
                                        : "text-foreground hover:bg-foreground/[0.05]",
                                )}
                            >
                                <Icon
                                    className={cn(
                                        "h-[20px] w-[20px] flex-none",
                                        !active && "text-primary",
                                    )}
                                    strokeWidth={active ? 2.4 : 2}
                                    fill={
                                        active && key === "saved"
                                            ? "currentColor"
                                            : "none"
                                    }
                                />
                                <span className="flex-1 text-left">{label}</span>
                                {key === "saved" && savedCount > 0 && (
                                    <span className="text-[14px] font-normal tabular-nums text-muted-foreground">
                                        {savedCount > 999 ? "999+" : savedCount}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
