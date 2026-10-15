import { useSyncExternalStore } from "react";

// Below Tailwind's `md` breakpoint the app renders the mobile shell instead of
// the desktop layout. Expressed in rem so it flips at exactly the same width
// as the `md:` classes do, whatever the browser's default font size.
const MOBILE_QUERY = "(width < 48rem)";

// Installed (Home Screen, Dock, Chrome/Edge "Install app"): the app shell at
// every size. iPadOS/macOS report "standalone"; Chromium may also run the app
// in a window-controls-overlay or fullscreen display.
const STANDALONE_QUERY =
    "(display-mode: standalone), (display-mode: fullscreen), (display-mode: window-controls-overlay)";

// The app shell's wide layouts, reached only when installed (a browser tab
// this wide gets the desktop layout). Sidebar in place of the tab bar: iPad
// portrait and up.
export const SIDEBAR_QUERY = "(width >= 48rem)";
// Results and the open passage side by side: iPad landscape and up.
export const SPLIT_QUERY = "(width >= 64rem)";

export function useMediaQuery(query: string): boolean {
    return useSyncExternalStore(
        (onChange) => {
            const mql = window.matchMedia(query);
            mql.addEventListener("change", onChange);
            return () => mql.removeEventListener("change", onChange);
        },
        () => window.matchMedia(query).matches,
    );
}

export function useIsMobile(): boolean {
    return useMediaQuery(MOBILE_QUERY);
}

/** True when launched from the Home Screen rather than in a browser tab. */
export function isStandalone(): boolean {
    return (
        window.matchMedia(STANDALONE_QUERY).matches ||
        // iOS Safari's pre-manifest flag.
        (navigator as Navigator & { standalone?: boolean }).standalone === true
    );
}

/**
 * Whether to render the app shell (components/mobile): on phones, and
 * whenever the site runs as an installed app, whatever the screen size. An
 * iPad or laptop in a browser tab keeps the desktop layout.
 */
export function useAppShell(): boolean {
    const mobile = useIsMobile();
    const standalone = useMediaQuery(STANDALONE_QUERY);
    return mobile || standalone || isStandalone();
}
