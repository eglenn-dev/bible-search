import { useState, useEffect } from "react";
import type { Result } from "./lib/types";
import SearchBox from "./components/search-box";
import ScriptureBox from "./components/scripture-box";
import RenderResults from "./components/render-results";
import { Button } from "./components/ui/button";
import Footer from "./components/footer";

export default function App() {
    const [results, setResults] = useState<Result[]>([]);
    const [queryType, setQueryType] = useState<"natural" | "scripture">(
        "natural"
    );

    useEffect(() => {
        setResults([]);
    }, [queryType]);

    return (
        <div className="flex flex-col min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
            <main className="flex-grow w-[99vw] flex items-center justify-center p-4">
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
                    <div>
                        <div className="flex justify-center space-x-4 mb-6">
                            <Button
                                className={`${
                                    queryType === "natural"
                                        ? "bg-zinc-300"
                                        : "bg-zinc-100"
                                } text-black hover:bg-zinc-300`}
                                onClick={() => setQueryType("natural")}
                            >
                                Natural Language
                            </Button>
                            <Button
                                className={`${
                                    queryType === "scripture"
                                        ? "bg-zinc-300"
                                        : "bg-zinc-100"
                                } text-black hover:bg-zinc-300`}
                                onClick={() => setQueryType("scripture")}
                            >
                                Scripture Reference
                            </Button>
                        </div>
                    </div>
                    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
                        {queryType === "natural" ? (
                            <SearchBox setResults={setResults} />
                        ) : (
                            <ScriptureBox setResults={setResults} />
                        )}
                    </div>
                    {results.length === 0 ? (
                        <div className="text-center">
                            <p className="text-slate-500 text-sm">
                                Enter your query above to find similar verses.
                            </p>
                        </div>
                    ) : (
                        <RenderResults results={results} />
                    )}
                </div>
            </main>
            <Footer />
        </div>
    );
}
