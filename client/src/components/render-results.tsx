import type { Result } from "@/lib/types";
import {
    SOURCE_LABELS,
    headingFor,
    metaLineFor,
    scorePercent,
} from "@/lib/result-display";

interface RenderResultsProps {
    results: Result[];
}

export default function RenderResults({ results }: RenderResultsProps) {
    if (results.length === 0) {
        return (
            <div className="text-center text-muted-foreground">
                No results found.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-7">
            {results.map((result, index) => {
                const metaLine = metaLineFor(result);
                return (
                    <article
                        key={`${result.source}-${index}`}
                        className="flex flex-col gap-1"
                        style={{
                            animation: `gsFade .4s ease ${Math.min(index, 8) * 45}ms both`,
                        }}
                    >
                        {/* Breadcrumb line over a teal, underlined title, as
                            on the Church's own search results page. */}
                        <div className="flex items-baseline gap-3 text-[13px] text-muted-foreground">
                            <span>
                                <span className="text-foreground">
                                    {SOURCE_LABELS[result.source]}
                                </span>
                                {metaLine && ` / ${metaLine}`}
                            </span>
                            <span className="ml-auto shrink-0 tabular-nums">
                                {scorePercent(result)}%
                            </span>
                        </div>
                        <a
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="self-start text-xl font-semibold leading-snug text-primary underline decoration-1 transition-colors hover:text-primary-strong"
                        >
                            {headingFor(result)}
                        </a>
                        <p className="mt-1 max-w-2xl whitespace-pre-line font-display text-lg leading-relaxed line-clamp-5">
                            {result.text}
                        </p>
                    </article>
                );
            })}
        </div>
    );
}
