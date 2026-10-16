import type { BackendStatus } from "@/lib/backend";
import { useOnline } from "@/lib/use-online";
import { SIDEBAR_QUERY, useMediaQuery } from "@/lib/use-is-mobile";
import { cn } from "@/lib/utils";

interface BackendToastProps {
    backend: BackendStatus;
    // The app shell gets its glass capsule, floating just above the tab bar
    // (it can stay up a while, so not over the title like a "Saved" toast).
    appShell?: boolean;
}

/**
 * Only speaks up when something is off: the first health check is slow (a
 * cold start), or the backend can't be reached. A healthy load shows nothing.
 */
export default function BackendToast({ backend, appShell }: BackendToastProps) {
    const { status, error, checking, slow, retry } = backend;
    const online = useOnline();
    // The installed app's wide layout has a sidebar instead of a tab bar.
    const sidebar = useMediaQuery(SIDEBAR_QUERY);
    const waking = status === "unknown" && slow;
    // Offline, the app shell shows its own notice in the page.
    const down = status === "down" && !(appShell && !online);

    return (
        <div
            aria-live="polite"
            className={cn(
                "pointer-events-none fixed inset-x-0 z-[55] flex justify-center px-4",
                appShell && !sidebar
                    ? "bottom-[calc(env(safe-area-inset-bottom)+5.5rem)]"
                    : "bottom-6",
            )}
        >
            {(waking || down) && (
                <div
                    role={down ? "alert" : "status"}
                    className={cn(
                        "pointer-events-auto flex items-center gap-3 text-foreground duration-300 animate-in fade-in-0",
                        appShell
                            ? "glass-thick min-h-11 rounded-full py-2 pl-5 pr-3 text-[15px] font-semibold slide-in-from-bottom-4"
                            : "max-w-md rounded-md border border-border bg-card py-2.5 pl-4 pr-2.5 text-sm shadow-lg slide-in-from-bottom-4",
                    )}
                >
                    {waking ? (
                        <>
                            <span className="h-4 w-4 flex-none animate-spin rounded-full border-2 border-border border-t-primary" />
                            <span className="pr-2">
                                Waking up the search service. This can take a
                                minute.
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="text-destructive">{error}</span>
                            <button
                                type="button"
                                onClick={retry}
                                disabled={checking}
                                className="flex-none whitespace-nowrap rounded-full px-2 py-1 font-semibold text-primary transition-colors hover:text-primary-strong disabled:opacity-60"
                            >
                                {checking ? "Retrying…" : "Try again"}
                            </button>
                        </>
                    )}
                </div>
            )}
        </div>
    );
}
