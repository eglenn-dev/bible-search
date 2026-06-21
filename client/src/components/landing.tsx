import { useState, useEffect } from "react";
import { Button } from "./ui/button";
import { BookOpen } from "lucide-react";

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
                    "API domain is not set. Please check your environment variables."
                );
                return;
            }
            try {
                const response = await fetch(
                    `${import.meta.env.VITE_API_DOMAIN}/`
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
                    "Failed to connect to the backend. Please wait a few minutes and try again."
                );
            }
        };
        checkBackendStatus();
    }, [setBackendRunning]);

    return (
        <div className="flex flex-col min-h-screen">
            <div className="flex-grow w-full flex items-center justify-center p-4">
                <div className="w-full max-w-2xl space-y-8">
                    <div className="text-center space-y-4">
                        <div className="flex items-center justify-center gap-3 text-primary">
                            <span className="h-px w-10 bg-border" />
                            <BookOpen className="h-6 w-6" strokeWidth={1.5} />
                            <span className="h-px w-10 bg-border" />
                        </div>
                        <h1 className="font-display text-4xl md:text-5xl font-bold text-foreground tracking-tight">
                            Gospel Library Search
                        </h1>
                        <p className="text-muted-foreground text-lg max-w-xl mx-auto">
                            Search the Bible, General Conference, and the General
                            Handbook by meaning — not just words.
                        </p>
                        <p className="text-muted-foreground/80 text-sm">
                            Developed by{" "}
                            <a
                                href="https://ethanglenn.dev"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline font-semibold"
                            >
                                Ethan Glenn
                            </a>
                            .{" "}
                            <a
                                target="_blank"
                                href="https://ethanglenn.dev/blog/bible-search"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline font-semibold"
                            >
                                How it works
                            </a>
                            .
                        </p>
                    </div>
                    {error ? (
                        <div className="flex flex-col items-center">
                            <div className="text-destructive text-center mb-2">
                                {error}
                            </div>
                            <Button
                                onClick={() => window.location.reload()}
                                className="mt-2 w-fit mx-auto"
                            >
                                Try Again
                            </Button>
                        </div>
                    ) : (
                        <div className="flex flex-col justify-center">
                            <div className="text-muted-foreground text-sm mx-auto mb-4">
                                Connecting to the search service. This may take a
                                minute on first load.
                            </div>
                            <div className="flex items-center justify-center">
                                <span className="inline-block w-6 h-6 border-4 border-border border-t-primary rounded-full animate-spin"></span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
