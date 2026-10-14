import { Bookmark as BookmarkIcon } from "lucide-react";
import type { Result } from "@/lib/types";
import { SOURCE_LABELS, headingFor, metaLineFor } from "@/lib/result-display";
import { isAllowedSourceUrl } from "@/lib/share";
import { cn } from "@/lib/utils";

interface BookmarkToggleProps {
    saved: boolean;
    onToggle: () => void;
    className?: string;
}

/** Outline bookmark that fills in once the passage is saved. */
export function BookmarkToggle({ saved, onToggle, className }: BookmarkToggleProps) {
    const label = saved ? "Remove from Saved" : "Save passage";
    return (
        <button
            type="button"
            onClick={onToggle}
            aria-pressed={saved}
            aria-label={label}
            title={label}
            className={cn(
                "flex h-8 w-8 flex-none items-center justify-center rounded-md transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                saved
                    ? "text-primary"
                    : "text-muted-foreground hover:text-primary",
                className,
            )}
        >
            <BookmarkIcon
                className="h-[18px] w-[18px]"
                fill={saved ? "currentColor" : "none"}
            />
        </button>
    );
}

interface PassageItemProps {
    result: Result;
    /** Right of the breadcrumb (a bookmark toggle, a remove button). */
    action?: React.ReactNode;
    /** Small line under the text ("Saved 12 Oct 2026"). */
    footnote?: React.ReactNode;
}

/**
 * A passage in the desktop's Saved panel and on a shared collection, styled
 * like a search result: breadcrumb, teal title linking to the source, then
 * the text in the book serif. Text is rendered as text, and the title only
 * becomes a link for churchofjesuschrist.org / speeches.byu.edu addresses.
 */
export default function PassageItem({ result, action, footnote }: PassageItemProps) {
    const heading = headingFor(result);
    const metaLine = metaLineFor(result);
    const linkable = isAllowedSourceUrl(result.url);

    return (
        <article className="flex flex-col gap-1">
            <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-muted-foreground">
                        <span className="text-foreground">
                            {SOURCE_LABELS[result.source]}
                        </span>
                        {metaLine && ` / ${metaLine}`}
                    </div>
                    {linkable ? (
                        <a
                            href={result.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-lg font-semibold leading-snug text-primary underline decoration-1 transition-colors hover:text-primary-strong"
                        >
                            {heading}
                        </a>
                    ) : (
                        <span className="text-lg font-semibold leading-snug text-foreground">
                            {heading}
                        </span>
                    )}
                </div>
                {action && <div className="-mr-1.5 flex gap-0.5">{action}</div>}
            </div>
            <p className="mt-0.5 whitespace-pre-line font-display text-[17px] leading-relaxed">
                {result.text}
            </p>
            {footnote && (
                <div className="mt-1 text-[13px] text-muted-foreground">
                    {footnote}
                </div>
            )}
        </article>
    );
}
