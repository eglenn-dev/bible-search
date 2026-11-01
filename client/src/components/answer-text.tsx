import type { AskSegment } from "@/lib/ask";
import { headingFor } from "@/lib/result-display";
import type { Result } from "@/lib/types";
import { cn } from "@/lib/utils";

interface AnswerTextProps {
    segments: AskSegment[];
    /** Cited passages by number; a number not here yet shows disabled. */
    citations: Record<number, Result>;
    /** Still streaming: show a caret after the last word. */
    running?: boolean;
    /** Highlights the number whose passage is showing. */
    isOpen?: (passage: Result) => boolean;
    onCite: (n: number, passage: Result) => void;
    className?: string;
}

/**
 * An Ask answer: each run of text followed by its citation numbers, each
 * number a button for its passage. Text is rendered as text.
 */
export default function AnswerText({
    segments,
    citations,
    running = false,
    isOpen,
    onCite,
    className,
}: AnswerTextProps) {
    return (
        <p
            className={cn(
                "select-text whitespace-pre-line font-display leading-relaxed text-foreground",
                className,
            )}
        >
            {segments.map((segment, i) => (
                <span key={i}>
                    {i === 0 ? segment.text.trimStart() : segment.text}
                    {segment.cites.map((n) => {
                        const passage = citations[n];
                        return (
                            <button
                                key={n}
                                type="button"
                                disabled={!passage}
                                onClick={() => passage && onCite(n, passage)}
                                aria-label={
                                    passage
                                        ? `Source ${n}: ${headingFor(passage)}`
                                        : `Source ${n}`
                                }
                                className={cn(
                                    "mx-0.5 inline-flex h-[20px] min-w-[20px] items-center justify-center rounded-full px-1.5 align-[3px] font-sans text-[12px] font-semibold leading-none transition-transform active:scale-90",
                                    passage && isOpen?.(passage)
                                        ? "bg-primary text-primary-foreground"
                                        : "bg-primary/[0.14] text-primary",
                                )}
                            >
                                {n}
                            </button>
                        );
                    })}
                </span>
            ))}
            {running && (
                <span
                    aria-hidden="true"
                    className="ml-0.5 inline-block h-[1em] w-[2px] animate-pulse bg-primary align-[-2px]"
                />
            )}
        </p>
    );
}
