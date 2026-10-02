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
        <div className="flex flex-col gap-7">
            {results.map((result, index) => {
                const metaLine = [subtitleFor(result), dateLabelFor(result)]
                    .filter(Boolean)
                    .join(" · ");
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
                                {Math.round(
                                    Math.max(0, Math.min(1, result.score)) *
                                        100,
                                )}
                                %
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
