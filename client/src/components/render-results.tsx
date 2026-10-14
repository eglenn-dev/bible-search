import { useState } from "react";
import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import type { Result } from "@/lib/types";
import {
    SOURCE_LABELS,
    contextLabel,
    headingFor,
    metaLineFor,
    scorePercent,
} from "@/lib/result-display";
import PassageContext from "./passage-context";

interface RenderResultsProps {
    results: Result[];
    /** "More like this": search from this result's passage. */
    onMoreLike?: (result: Result) => void;
}

export default function RenderResults({
    results,
    onMoreLike,
}: RenderResultsProps) {
    if (results.length === 0) {
        return (
            <div className="text-center text-muted-foreground">
                No results found.
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-7">
            {results.map((result, index) => (
                <ResultItem
                    key={result.id ?? `${result.source}-${index}`}
                    result={result}
                    index={index}
                    onMoreLike={onMoreLike}
                />
            ))}
        </div>
    );
}

const actionClass =
    "inline-flex items-center gap-1 text-sm font-semibold text-primary transition-colors hover:text-primary-strong hover:underline";

function ResultItem({
    result,
    index,
    onMoreLike,
}: {
    result: Result;
    index: number;
    onMoreLike?: (result: Result) => void;
}) {
    const [expanded, setExpanded] = useState(false);
    const metaLine = metaLineFor(result);
    const { id } = result;

    return (
        <article
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
            {expanded && id ? (
                <div className="mt-2 max-w-2xl">
                    <PassageContext
                        result={{ ...result, id }}
                        textClassName="text-lg leading-relaxed"
                    />
                </div>
            ) : (
                <p className="mt-1 max-w-2xl whitespace-pre-line font-display text-lg leading-relaxed line-clamp-5">
                    {result.text}
                </p>
            )}
            {/* Both actions need the passage's id, which results saved
                before the API returned one don't have. */}
            {id && (
                <div className="mt-1.5 flex flex-wrap items-center gap-x-5 gap-y-1">
                    <button
                        type="button"
                        onClick={() => setExpanded((open) => !open)}
                        aria-expanded={expanded}
                        className={actionClass}
                    >
                        {expanded ? (
                            <ChevronUp className="h-4 w-4" aria-hidden="true" />
                        ) : (
                            <ChevronDown
                                className="h-4 w-4"
                                aria-hidden="true"
                            />
                        )}
                        {expanded ? "Hide context" : contextLabel(result)}
                    </button>
                    {onMoreLike && (
                        <button
                            type="button"
                            onClick={() => onMoreLike(result)}
                            className={actionClass}
                        >
                            <Sparkles className="h-4 w-4" aria-hidden="true" />
                            More like this
                        </button>
                    )}
                </div>
            )}
        </article>
    );
}
