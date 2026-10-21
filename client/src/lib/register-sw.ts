// Registers the service worker that vite.config.ts generates at build time
// (sw.js) and reports when a new version is waiting. The same shape as
// vite-plugin-pwa's `useRegisterSW` (what UpdateToast was written against),
// on the workbox-window it wraps.

import { useEffect, useRef, useState } from "react";
import { Workbox } from "workbox-window";

const SW_URL = "/sw.js";

interface Options {
    onRegisteredSW?: (
        url: string,
        registration: ServiceWorkerRegistration | undefined,
    ) => void;
}

export function useRegisterSW({ onRegisteredSW }: Options = {}) {
    const [needRefresh, setNeedRefresh] = useState(false);
    const workbox = useRef<Workbox | null>(null);
    // Registration happens once; keep the latest callback without
    // re-registering when it changes.
    const onRegistered = useRef(onRegisteredSW);
    onRegistered.current = onRegisteredSW;

    useEffect(() => {
        // Production only: dev has no sw.js, and a worker from a previous
        // build would serve stale assets over the dev server.
        if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
        const wb = new Workbox(SW_URL, { scope: "/" });
        workbox.current = wb;
        // A new worker installed and is waiting for the page to let it in
        // (also fired when another tab installed it).
        wb.addEventListener("waiting", () => setNeedRefresh(true));
        // Waits for the window's load event, so it never competes with the
        // first render for bandwidth.
        wb.register().then(
            (registration) => onRegistered.current?.(SW_URL, registration),
            (e) => console.error("Service worker registration failed:", e),
        );
    }, []);

    /** Lets the waiting worker take over, then reloads into the new build. */
    const updateServiceWorker = async (reload = true) => {
        const wb = workbox.current;
        if (!wb) return;
        if (reload) {
            wb.addEventListener("controlling", () => window.location.reload());
        }
        wb.messageSkipWaiting();
    };

    return {
        needRefresh: [needRefresh, setNeedRefresh] as const,
        updateServiceWorker,
    };
}
