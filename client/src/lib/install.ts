import { useSyncExternalStore } from "react";

// Chromium browsers fire `beforeinstallprompt` once the page is installable,
// often before React has mounted, so it's captured here at module load and
// replayed through useInstallPrompt. Safari and Firefox never fire it.

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

export type InstallState =
    // Chromium has an install prompt ready to show.
    | { kind: "prompt"; install: () => Promise<void> }
    // No prompt to show; the user installs from the browser's own UI.
    | { kind: "safari" | "chromium" }
    // Just installed, or the browser can't install web apps.
    | { kind: "none" };

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e) => {
        // Keep the browser's mini-infobar quiet; the Settings sheet offers it.
        e.preventDefault();
        deferred = e as BeforeInstallPromptEvent;
        notify();
    });
    window.addEventListener("appinstalled", () => {
        deferred = null;
        installed = true;
        notify();
    });
}

async function install() {
    if (!deferred) return;
    const event = deferred;
    // A prompt can only be shown once.
    deferred = null;
    notify();
    await event.prompt();
}

const isChromium = () =>
    typeof window !== "undefined" && "onbeforeinstallprompt" in window;

const isSafari = () =>
    /Safari/.test(navigator.userAgent) &&
    !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS/.test(navigator.userAgent);

// Snapshots must be stable between changes, so the states are built once.
const PROMPT: InstallState = { kind: "prompt", install };
const SAFARI: InstallState = { kind: "safari" };
const CHROMIUM: InstallState = { kind: "chromium" };
const NONE: InstallState = { kind: "none" };

function snapshot(): InstallState {
    if (installed) return NONE;
    if (deferred) return PROMPT;
    if (isChromium()) return CHROMIUM;
    if (isSafari()) return SAFARI;
    return NONE;
}

function subscribe(onChange: () => void) {
    listeners.add(onChange);
    return () => listeners.delete(onChange);
}

/** How (or whether) this browser can install Gospel Help as an app. */
export function useInstallPrompt(): InstallState {
    return useSyncExternalStore(subscribe, snapshot);
}
