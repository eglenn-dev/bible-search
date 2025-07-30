import { useState, useEffect } from "react";
import { Button } from "./ui/button";

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
        <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            <div className="flex-grow w-[99vw] flex items-center justify-center p-4">
                <div className="w-full max-w-2xl space-y-8">
                    <div className="text-center space-y-4">
                        <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
                            Bible Search
                        </h1>
                        <p className="text-slate-600 text-lg">
                            Discover new verses and explore the Bible with ease.
                        </p>
                        <p className="text-slate-500 text-sm">
                            Developed by{" "}
                            <a
                                href="https://ethanglenn.dev"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-slate-700 hover:text-slate-900 font-semibold"
                            >
                                Ethan Glenn
                            </a>
                            .{" "}
                            <a
                                target="_blank"
                                href="https://ethanglenn.dev/blog/bible-search"
                                rel="noopener noreferrer"
                                className="text-slate-700 hover:text-slate-900 font-semibold"
                            >
                                How it works
                            </a>
                            .
                        </p>
                    </div>
                    {error ? (
                        <div className="flex flex-col items-center">
                            <div className="text-red-500 text-center mb-2">
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
                            <div className="text-slate-600 text-sm mx-auto mb-4">
                                Attempting to connect to backend. This may take
                                a minute.
                            </div>
                            <div className="flex items-center justify-center">
                                <span className="inline-block w-6 h-6 border-4 border-slate-400 border-t-slate-700 rounded-full animate-spin"></span>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
