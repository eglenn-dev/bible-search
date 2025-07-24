import type { Result } from "@/lib/types";
import { getUrlChapter } from "@/lib/chapter-map";

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
        <div className="space-y-4 flex flex-col gap-2">
            {results.map((result, index) => (
                <a
                    key={`${result.reference.split(" ").join("-")}-${index}`}
                    href={`https://www.churchofjesuschrist.org/study/scriptures/${getUrlChapter(
                        result.reference
                    )}`}
                    target="_blank"
                >
                    <div className="p-4 bg-white rounded-lg shadow hover:shadow-lg transition-shadow">
                        <h3 className="text-lg font-semibold text-slate-900">
                            {result.reference}
                        </h3>
                        <p className="text-slate-700">{result.text}</p>
                        <span className="text-sm text-slate-500">
                            Distance: {result.distance.toFixed(2)}
                        </span>
                    </div>
                </a>
            ))}
        </div>
    );
}
