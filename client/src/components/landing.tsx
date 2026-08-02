import { useState, useEffect } from "react";
import ThemeToggle from "./theme-toggle";

interface LandingProps {
    setBackendRunning: (running: boolean) => void;
}

export default function Landing({ setBackendRunning }: LandingProps) {
    const [error, setError] = useState<string>("");

    useEffect(() => {
        const checkBackendStatus = async () => {
            setError("");
            if (!import.meta.env.VITE_API_DOMAIN) {
                setError(
                    "API domain is not set. Please check your environment variables.",
                );
                return;
            }
            try {
                const response = await fetch(
                    `${import.meta.env.VITE_API_DOMAIN}/`,
                );
                if (response.ok) {
                    setBackendRunning(true);
                } else {
                    setError("Backend is not running or unreachable.");
                    setBackendRunning(false);
                }
            } catch (error) {
                console.error("Error checking backend status:", error);
                setBackendRunning(false);
                setError(
                    "Failed to connect to the backend. Please wait a few minutes and try again.",
                );
            }
        };
        checkBackendStatus();
    }, [setBackendRunning]);

    return (
        <div className="gs-fade flex min-h-screen flex-col">
            {/* The connect screen can sit here for a minute on a cold start, so
                the theme control has to be reachable from it too. */}
            <div className="flex justify-end px-5 pt-4">
                <ThemeToggle compact />
            </div>
            <div className="flex w-full flex-grow flex-col items-center justify-center px-6 pb-12 pt-4">
                <div className="w-64 border-t-2 border-foreground sm:w-72" />
                <h1 className="mb-2 mt-5 text-center font-display text-5xl font-medium italic tracking-wide text-foreground md:text-6xl">
                    Gospel Help
                </h1>
                <p className="mb-5 text-center text-sm uppercase tracking-[0.28em] text-muted-foreground">
                    A Gospel Library concordance of 135,000+ indexed items
                </p>
                <div className="mb-10 w-64 border-b-2 border-foreground sm:w-72" />
                {error ? (
                    <div className="flex flex-col items-center gap-4">
                        <div className="max-w-md text-center text-destructive">
                            {error}
                        </div>
                        <button
                            type="button"
                            onClick={() => window.location.reload()}
                            className="rounded-full bg-primary px-6 py-2 text-sm uppercase tracking-[0.12em] text-primary-foreground transition-colors hover:bg-primary/90"
                        >
                            Try again
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col items-center gap-5">
                        <div className="max-w-md text-center italic text-muted-foreground">
                            Connecting to the search service. This may take a
                            minute on first load.
                        </div>
                        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                    </div>
                )}
            </div>
            <div className="pb-8 text-center text-sm tracking-wide text-muted-foreground">
                Scriptures &nbsp;·&nbsp; General Conference &nbsp;·&nbsp; BYU
                Speeches &nbsp;·&nbsp; General Handbook
            </div>
        </div>
    );
}
