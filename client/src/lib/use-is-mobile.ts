import { useSyncExternalStore } from "react";

// Below Tailwind's `md` breakpoint the app renders the mobile shell instead of
// the desktop layout. Expressed in rem so it flips at exactly the same width
// as the `md:` classes do, whatever the browser's default font size.
const MOBILE_QUERY = "(width < 48rem)";

function subscribe(onChange: () => void) {
    const mql = window.matchMedia(MOBILE_QUERY);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
}

export function useIsMobile(): boolean {
    return useSyncExternalStore(
        subscribe,
        () => window.matchMedia(MOBILE_QUERY).matches,
    );
}

/** True when launched from the Home Screen rather than in a browser tab. */
export function isStandalone(): boolean {
    return (
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari's pre-manifest flag.
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}
