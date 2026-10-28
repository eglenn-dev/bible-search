import { Bookmark as BookmarkIcon } from "lucide-react";
import type { Result } from "@/lib/types";
import {
    SOURCE_LABELS,
    headingFor,
    metaLineFor,
    scorePercent,
} from "@/lib/result-display";
import { cn } from "@/lib/utils";

interface ResultCardProps {
    result: Result;
    saved: boolean;
    onOpen: () => void;
    onToggleSaved: () => void;
    /** Relevance only means something next to the query that produced it. */
    showScore?: boolean;
    /** Replaces the score in the footer (the Saved tab's "Saved 12 Oct"). */
    footnote?: string;
    /** Showing in the split view's passage pane. */
    selected?: boolean;
    /** Ask's citation number for this passage. */
    marker?: number;
    style?: React.CSSProperties;
}

export default function ResultCard({
    result,
    saved,
    onOpen,
    onToggleSaved,
    showScore = false,
    footnote,
    selected = false,
    marker,
    style,
}: ResultCardProps) {
    const heading = headingFor(result);
    const metaLine = metaLineFor(result);

    return (
        <article
            style={style}
            aria-current={selected || undefined}
            className={cn(
                "relative rounded-[22px] border bg-[var(--app-card)] p-4 shadow-[0_1px_3px_rgba(16,60,78,0.05)] transition-[transform,border-color,box-shadow] duration-150 has-[.card-hit:active]:scale-[0.985]",
                selected
                    ? "border-primary/60 ring-1 ring-primary/40"
                    : "border-border/70",
            )}
        >
            {/* The whole card opens the passage; the bookmark button sits
                above this hit area so it stays its own target. */}
            <button
                type="button"
                onClick={onOpen}
                aria-label={`Open ${heading}`}
                className="card-hit absolute inset-0 rounded-[22px]"
            />
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] text-muted-foreground">
                        {marker !== undefined && (
                            <span className="mr-1.5 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary/[0.14] px-1 align-[1px] text-[11px] font-semibold leading-none text-primary">
                                {marker}
                            </span>
                        )}
                        <span className="text-foreground">
                            {SOURCE_LABELS[result.source]}
                        </span>
                        {metaLine && ` / ${metaLine}`}
                    </div>
                    <h3 className="mt-0.5 font-sans text-[17px] font-semibold leading-snug text-primary">
                        {heading}
                    </h3>
                </div>
                <button
                    type="button"
                    onClick={onToggleSaved}
                    aria-pressed={saved}
                    aria-label={saved ? "Remove bookmark" : "Bookmark"}
                    className={cn(
                        "relative z-10 -mr-2 -mt-2 flex h-11 w-11 flex-none items-center justify-center rounded-full transition-transform active:scale-75",
                        saved ? "text-primary" : "text-muted-foreground",
                    )}
                >
                    <BookmarkIcon
                        className="h-[22px] w-[22px]"
                        fill={saved ? "currentColor" : "none"}
                    />
                </button>
            </div>
            <p className="mt-1.5 line-clamp-4 whitespace-pre-line font-display text-[17px] leading-relaxed">
                {result.text}
            </p>
            {(showScore || footnote) && (
                <div className="mt-2 text-[13px] tabular-nums text-muted-foreground">
                    {showScore ? `${scorePercent(result)}% match` : footnote}
                </div>
            )}
        </article>
    );
}
