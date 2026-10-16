// Saved passages live only on this device (localStorage, plus the service
// worker's caches for offline reading). Browsers may evict "best-effort"
// storage under pressure; asking for persistent storage opts out of that.
// Chromium decides silently (installed apps are granted); Safari and Firefox
// may decline. Asked at most once per visit.

let asked = false;

export async function requestPersistentStorage(): Promise<void> {
    if (asked) return;
    asked = true;
    try {
        if (!navigator.storage?.persist) return;
        if (await navigator.storage.persisted()) return;
        await navigator.storage.persist();
    } catch {
        // Not supported, or refused: storage stays best-effort.
    }
}
