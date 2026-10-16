import { useCallback, useEffect, useState } from "react";

// How long the first check may hang (a cold start) before we say so, and how
// often an unreachable backend is re-checked in the background.
const SLOW_MS = 4000;
const RETRY_MS = 10_000;

export interface BackendStatus {
    /** "unknown" until the first check settles; the UI stays usable then. */
    status: "unknown" | "up" | "down";
    /** Why the last check failed, for the toast. */
    error: string;
    /** The last check got no response at all (offline, or no route to the API). */
    unreachable: boolean;
    /** A check is in flight. */
    checking: boolean;
    /** The first check is taking long enough to be worth mentioning. */
    slow: boolean;
    retry: () => void;
}

interface CheckFailure {
    error: string;
    unreachable: boolean;
}

async function check(): Promise<CheckFailure | null> {
    const base = import.meta.env.VITE_API_DOMAIN;
    if (!base)
        return {
            error: "API domain is not set. Check your environment variables.",
            unreachable: false,
        };
    if (!navigator.onLine)
        return { error: "You’re offline.", unreachable: true };
    try {
        const response = await fetch(`${base}/`);
        return response.ok
            ? null
            : { error: "The search service is unavailable.", unreachable: false };
    } catch (error) {
        console.error("Error checking backend status:", error);
        return { error: "Can’t reach the search service.", unreachable: true };
    }
}

/**
 * Pings the API's health check in the background so the app can render
 * immediately instead of behind a connecting screen. While it's down the
 * check repeats every few seconds, and right away when the network returns.
 */
export function useBackendStatus(): BackendStatus {
    const [status, setStatus] = useState<BackendStatus["status"]>("unknown");
    const [error, setError] = useState("");
    const [unreachable, setUnreachable] = useState(false);
    const [checking, setChecking] = useState(true);
    const [slow, setSlow] = useState(false);
    const [attempt, setAttempt] = useState(0);

    const retry = useCallback(() => {
        setChecking(true);
        setAttempt((n) => n + 1);
    }, []);

    useEffect(() => {
        let cancelled = false;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        const slowTimer = setTimeout(() => setSlow(true), SLOW_MS);
        check().then((failure) => {
            if (cancelled) return;
            clearTimeout(slowTimer);
            setSlow(false);
            setChecking(false);
            setError(failure?.error ?? "");
            setUnreachable(failure?.unreachable ?? false);
            setStatus(failure ? "down" : "up");
            if (failure) retryTimer = setTimeout(retry, RETRY_MS);
        });
        return () => {
            cancelled = true;
            clearTimeout(slowTimer);
            clearTimeout(retryTimer);
        };
    }, [attempt, retry]);

    useEffect(() => {
        window.addEventListener("online", retry);
        return () => window.removeEventListener("online", retry);
    }, [retry]);

    return { status, error, unreachable, checking, slow, retry };
}
