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

// The app shell's wide layouts, reached when installed or when a desktop
// browser tab has switched to the app layout. Sidebar in place of the tab
// bar: iPad portrait and up.
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

// A wide browser tab's choice between the classic page (the default) and the
// app shell. Phones and the installed app always get the app shell, so the
// choice only shows in, and only applies to, a wide browser tab.
export type Layout = "classic" | "app";

const LAYOUT_STORAGE_KEY = "gs-layout";

const layoutListeners = new Set<() => void>();
// Kept here too, so a switch still applies when storage is unavailable.
let layout: Layout | null = null;

function readLayout(): Layout {
    if (layout) return layout;
    try {
        layout =
            localStorage.getItem(LAYOUT_STORAGE_KEY) === "app"
                ? "app"
                : "classic";
    } catch {
        // Private mode / disabled storage: the default.
        layout = "classic";
    }
    return layout;
}

/** Switches a wide browser tab's layout and remembers it on this device. */
export function setLayout(next: Layout): void {
    layout = next;
    try {
        localStorage.setItem(LAYOUT_STORAGE_KEY, next);
    } catch {
        // Non-fatal: the switch still applies until the page reloads.
    }
    window.scrollTo(0, 0);
    layoutListeners.forEach((onChange) => onChange());
}

export function useLayout(): Layout {
    return useSyncExternalStore((onChange) => {
        layoutListeners.add(onChange);
        // A switch in another tab of this site applies here too.
        const onStorage = (e: StorageEvent) => {
            if (e.key !== LAYOUT_STORAGE_KEY) return;
            layout = null;
            onChange();
        };
        window.addEventListener("storage", onStorage);
        return () => {
            layoutListeners.delete(onChange);
            window.removeEventListener("storage", onStorage);
        };
    }, readLayout);
}

/**
 * Whether the layout is the user's choice here: a browser tab at least
 * tablet-wide. Phones and the installed app always get the app shell.
 */
export function useCanChooseLayout(): boolean {
    const mobile = useIsMobile();
    const standalone = useMediaQuery(STANDALONE_QUERY);
    return !mobile && !standalone && !isStandalone();
}

/**
 * Whether to render the app shell (components/mobile): on phones, whenever
 * the site runs as an installed app, whatever the screen size, and in a wide
 * browser tab that has switched to it. Otherwise an iPad or laptop in a
 * browser tab keeps the classic desktop layout.
 */
export function useAppShell(): boolean {
    const choosable = useCanChooseLayout();
    const layout = useLayout();
    return !choosable || layout === "app";
}
