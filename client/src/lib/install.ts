// "Install app". Chromium browsers fire `beforeinstallprompt` once the site
// qualifies (manifest + service worker); holding on to that event lets our
// own button open the native install dialog later. Safari never fires it, so
// there the button explains the browser's own menu instead.
//
// Imported for its side effect from main.tsx: the event can fire before React
// mounts, and a listener added later would miss it.

import { useSyncExternalStore } from "react";
import { isStandalone } from "./use-is-mobile";

interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

if (typeof window !== "undefined") {
    window.addEventListener("beforeinstallprompt", (e) => {
        // Keep Chrome's own mini-infobar from appearing; ours replaces it.
        e.preventDefault();
        deferred = e as BeforeInstallPromptEvent;
        emit();
    });
    window.addEventListener("appinstalled", () => {
        deferred = null;
        installed = true;
        emit();
    });
}

/** Browsers where installing is a menu item we can only describe. */
export type ManualInstall = "ios" | "mac-safari";

function manualInstall(): ManualInstall | null {
    const ua = navigator.userAgent;
    // iPadOS reports itself as a Mac; touch support gives it away.
    const ios =
        /iPhone|iPad|iPod/.test(ua) ||
        (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (ios) return "ios";
    const safari =
        /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Firefox|FxiOS/.test(ua);
    if (/Macintosh/.test(ua) && safari) return "mac-safari";
    return null;
}

export interface InstallState {
    /** Already running as the installed app (or just installed). */
    installed: boolean;
    /** The native install dialog is available: call `install()`. */
    canPrompt: boolean;
    /** Otherwise, a browser whose menu we can point to; null if neither. */
    manual: ManualInstall | null;
}

function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

// useSyncExternalStore needs a stable snapshot between changes.
let snapshot: InstallState | null = null;
let snapshotFor: [BeforeInstallPromptEvent | null, boolean] | null = null;

function getSnapshot(): InstallState {
    if (!snapshot || snapshotFor?.[0] !== deferred || snapshotFor?.[1] !== installed) {
        snapshotFor = [deferred, installed];
        snapshot = {
            installed: installed || isStandalone(),
            canPrompt: deferred !== null,
            manual: deferred ? null : manualInstall(),
        };
    }
    return snapshot;
}

export function useInstall(): InstallState {
    return useSyncExternalStore(subscribe, getSnapshot);
}

/** Opens the native install dialog. Resolves true if the user accepted. */
export async function promptInstall(): Promise<boolean> {
    const event = deferred;
    if (!event) return false;
    // The event is single-use.
    deferred = null;
    emit();
    await event.prompt();
    const { outcome } = await event.userChoice;
    return outcome === "accepted";
}
