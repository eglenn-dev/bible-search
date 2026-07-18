import type { Result, Source } from "@/lib/types";
import { dateLabelFor } from "@/lib/result-date";

interface RenderResultsProps {
    results: Result[];
}

const SOURCE_LABELS: Record<Source, string> = {
    bible: "Bible",
    "book-of-mormon": "Book of Mormon",
    "doctrine-and-covenants": "D&C",
    "pearl-of-great-price": "Pearl of Great Price",
    conference: "Conference",
    "byu-speeches": "BYU Speeches",
    handbook: "Handbook",
};

// Sources whose results are scripture verses (heading = reference, subtitle = volume).
const SCRIPTURE_SOURCES: Source[] = [
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
];

function headingFor(result: Result): string {
    if (SCRIPTURE_SOURCES.includes(result.source)) return result.reference;
    if (result.source === "conference" || result.source === "byu-speeches")
        return result.title || result.reference;
    return result.metadata?.section_title || result.title || result.reference;
}

// Secondary line under the heading (joined with the date label where present).
function subtitleFor(result: Result): string {
    const m = result.metadata || {};
    if (result.source === "conference" || result.source === "byu-speeches") {
        return m.speaker || "";
    }
    if (result.source === "handbook") {
        return [m.chapter, m.section_number].filter(Boolean).join(" · ");
    }
    return m.volume || m.translation || "";
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
        <div className="flex flex-col gap-9">
            {results.map((result, index) => {
                const metaLine = [subtitleFor(result), dateLabelFor(result)]
                    .filter(Boolean)
                    .join(" · ");
                return (
                    <article
                        key={`${result.source}-${index}`}
                        className="flex flex-col gap-1.5"
                        style={{
                            animation: `gsFade .4s ease ${Math.min(index, 8) * 45}ms both`,
                        }}
                    >
                        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                            <a
                                href={result.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-display text-2xl font-medium text-foreground transition-colors hover:text-primary hover:underline hover:underline-offset-[3px]"
                            >
                                {headingFor(result)}
                            </a>
                            <span className="relative -top-px shrink-0 rounded-full border border-primary/30 bg-secondary px-2.5 py-0.5 text-xs uppercase tracking-[0.12em] text-primary">
                                {SOURCE_LABELS[result.source]}
                            </span>
                            <span className="ml-auto shrink-0 text-sm text-muted-foreground">
                                {Math.round(
                                    Math.max(0, Math.min(1, result.score)) *
                                        100,
                                )}
                                %
                            </span>
                        </div>
                        {metaLine && (
                            <div className="text-[15px] text-muted-foreground">
                                {metaLine}
                            </div>
                        )}
                        <p className="max-w-2xl whitespace-pre-line text-lg line-clamp-5">
                            {result.text}
                        </p>
                    </article>
                );
            })}
        </div>
    );
}
