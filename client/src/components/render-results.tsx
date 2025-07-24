import type { Result } from "@/lib/types";

interface RenderResultsProps {
    results: Result[];
}

export default function RenderResults({ results }: RenderResultsProps) {
    if (results.length === 0) {
        return (
            <div className="text-center text-slate-500">No results found.</div>
        );
    }

    return (
        <div className="space-y-4">
            {results.map((result, index) => (
                <div
                    key={index}
                    className="p-4 bg-white rounded-lg shadow hover:shadow-lg transition-shadow"
                >
                    <h3 className="text-lg font-semibold text-slate-900">
                        {result.reference}
                    </h3>
                    <p className="text-slate-700">{result.text}</p>
                    <span className="text-sm text-slate-500">
                        Distance: {result.distance.toFixed(2)}
                    </span>
                </div>
            ))}
        </div>
    );
}
