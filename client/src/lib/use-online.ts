import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
    window.addEventListener("online", onChange);
    window.addEventListener("offline", onChange);
    return () => {
        window.removeEventListener("online", onChange);
        window.removeEventListener("offline", onChange);
    };
}

/**
 * The browser's idea of connectivity. `false` is reliable (no network at
 * all); `true` only means some network is up, so callers still handle a
 * failed request.
 */
export function useOnline(): boolean {
    return useSyncExternalStore(subscribe, () => navigator.onLine);
}
