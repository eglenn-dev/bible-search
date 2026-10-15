import { useEffect } from "react";
import { X } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";

// How often an open app checks for a new deploy. Installed apps can stay
// open for days, so waiting for the next navigation isn't enough.
const UPDATE_CHECK_MS = 60 * 60 * 1000;

/**
 * Registers the service worker and says when a new version is waiting
 * ("Reload" swaps it in) and, once, when the app is ready to work offline.
 * Mounted above the router so it shows on every page and in both layouts.
 */
export default function UpdateToast() {
    const {
        needRefresh: [needRefresh, setNeedRefresh],
        offlineReady: [offlineReady, setOfflineReady],
        updateServiceWorker,
    } = useRegisterSW({
        onRegisteredSW(_url, registration) {
            if (!registration) return;
            setInterval(() => {
                if (navigator.onLine) void registration.update();
            }, UPDATE_CHECK_MS);
        },
    });

    useEffect(() => {
        if (!offlineReady) return;
        const timer = setTimeout(() => setOfflineReady(false), 3500);
        return () => clearTimeout(timer);
    }, [offlineReady, setOfflineReady]);

    if (!needRefresh && !offlineReady) return null;

    return (
        <div
            aria-live="polite"
            // Above the app shell's own toasts (z-60) and its sheets (z-50).
            className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.625rem)] z-[70] flex justify-center px-4"
        >
            <div className="glass-thick pointer-events-auto flex h-12 items-center gap-2 rounded-full pl-5 pr-1.5 text-[15px] font-semibold text-foreground duration-300 animate-in fade-in-0 slide-in-from-top-4">
                {needRefresh ? (
                    <>
                        <span className="pr-1">A new version is ready</span>
                        <button
                            type="button"
                            onClick={() => void updateServiceWorker(true)}
                            className="h-9 rounded-full bg-primary px-4 text-primary-foreground transition-transform active:scale-95"
                        >
                            Reload
                        </button>
                        <button
                            type="button"
                            onClick={() => setNeedRefresh(false)}
                            aria-label="Later"
                            className="flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-transform active:scale-90"
                        >
                            <X className="h-[18px] w-[18px]" />
                        </button>
                    </>
                ) : (
                    <span className="pr-3.5">Ready to work offline</span>
                )}
            </div>
        </div>
    );
}
