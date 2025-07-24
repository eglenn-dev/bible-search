import { useState } from "react";
import type { Result } from "./lib/types";
import SearchBox from "./components/search-box";
import RenderResults from "./components/render-results";

export default function App() {
    const [results, setResults] = useState<Result[]>([]);

    return (
        <>
            <div className="min-h-screen w-[99vw] bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
                <div className="w-full max-w-2xl space-y-8">
                    <div className="text-center space-y-4">
                        <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent">
                            Gospel Search
                        </h1>
                        <p className="text-slate-600 text-lg">
                            Find what you are looking for in the scriptures
                        </p>
                    </div>
                    <div className="bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
                        <SearchBox setResults={setResults} />
                    </div>
                    {results.length === 0 ? (
                        <div className="text-center">
                            <p className="text-slate-500 text-sm">
                                Press Enter or click Search to begin
                            </p>
                        </div>
                    ) : (
                        <RenderResults results={results} />
                    )}
                </div>
            </div>
        </>
    );
}
