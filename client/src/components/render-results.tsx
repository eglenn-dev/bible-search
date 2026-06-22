import type { Result, Source } from "@/lib/types";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

interface RenderResultsProps {
    results: Result[];
}

const SOURCE_META: Record<Source, { label: string; badge: string }> = {
    bible: {
        label: "Bible",
        badge: "bg-[oklch(0.45_0.06_245)] text-white",
    },
    "book-of-mormon": {
        label: "Book of Mormon",
        badge: "bg-[oklch(0.48_0.09_180)] text-white",
    },
    "doctrine-and-covenants": {
        label: "D&C",
        badge: "bg-[oklch(0.48_0.12_300)] text-white",
    },
    "pearl-of-great-price": {
        label: "Pearl of Great Price",
        badge: "bg-[oklch(0.5_0.1_55)] text-white",
    },
    conference: {
        label: "Conference",
        badge: "bg-primary text-primary-foreground",
    },
    handbook: {
        label: "Handbook",
        badge: "bg-accent text-accent-foreground",
    },
};

// Sources whose results are scripture verses (heading = reference, subtitle = volume).
const SCRIPTURE_SOURCES: Source[] = [
    "bible",
    "book-of-mormon",
    "doctrine-and-covenants",
    "pearl-of-great-price",
];

const MONTHS: Record<string, string> = { "04": "April", "10": "October" };

function headingFor(result: Result): string {
    if (SCRIPTURE_SOURCES.includes(result.source)) return result.reference;
    if (result.source === "conference")
        return result.title || result.reference;
    return result.metadata?.section_title || result.title || result.reference;
}

function subtitleFor(result: Result): string {
    const m = result.metadata || {};
    if (result.source === "conference") {
        const date =
            m.year && m.month
                ? `${MONTHS[m.month] || m.month} ${m.year}`
                : undefined;
        return [m.speaker, date].filter(Boolean).join(" • ");
    }
    if (result.source === "handbook") {
        return [m.chapter, m.section_number].filter(Boolean).join(" • ");
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
        <div className="flex flex-col gap-4">
            {results.map((result, index) => {
                const meta = SOURCE_META[result.source];
                const subtitle = subtitleFor(result);
                return (
                    <a
                        key={`${result.source}-${index}`}
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="group block"
                    >
                        <article className="relative p-5 bg-card rounded-xl border border-border shadow-sm hover:shadow-md hover:border-primary/40 transition-all">
                            <div className="flex items-center justify-between gap-3 mb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                        className={cn(
                                            "rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide",
                                            meta.badge
                                        )}
                                    >
                                        {meta.label}
                                    </span>
                                    <h3 className="font-display text-lg font-semibold text-foreground">
                                        {headingFor(result)}
                                    </h3>
                                </div>
                                <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                            </div>
                            {subtitle && (
                                <p className="text-xs text-muted-foreground mb-2">
                                    {subtitle}
                                </p>
                            )}
                            <p className="text-foreground/90 leading-relaxed whitespace-pre-line line-clamp-5">
                                {result.text}
                            </p>
                            <div className="mt-3 flex items-center gap-2">
                                <div className="h-1.5 w-24 rounded-full bg-secondary overflow-hidden">
                                    <div
                                        className="h-full bg-primary"
                                        style={{
                                            width: `${Math.max(
                                                0,
                                                Math.min(100, result.score * 100)
                                            )}%`,
                                        }}
                                    />
                                </div>
                                <span className="text-xs text-muted-foreground">
                                    {Math.round(result.score * 100)}% match
                                </span>
                            </div>
                        </article>
                    </a>
                );
            })}
        </div>
    );
}
