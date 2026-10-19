import { useState } from "react";
import {
    Bookmark as BookmarkIcon,
    ChevronDown,
    ChevronUp,
    ExternalLink,
    Share as ShareIcon,
    Sparkles,
} from "lucide-react";
import type { Result } from "@/lib/types";
import { isSaved } from "@/lib/bookmarks";
import {
    SOURCE_LABELS,
    contextLabel,
    headingFor,
    metaLineFor,
} from "@/lib/result-display";
import { cn } from "@/lib/utils";
import PassageContext from "../passage-context";
import Pane from "./pane";
import Sheet from "./sheet";

interface ResultSheetProps {
    /** The passage to show; null keeps the sheet closed. */
    result: Result | null;
    savedIds: Set<string>;
    onClose: () => void;
    onToggleSaved: (result: Result) => void;
    onNotify: (message: string) => void;
    /** "More like this": search from this passage. */
    onMoreLike: (result: Result) => void;
    /**
     * "sheet" (default): a modal bottom sheet. "pane": the split view's
     * column beside the results, shown only while `result` is set.
     */
    variant?: "sheet" | "pane";
}

/**
 * Full text of one passage, with bookmark / share / open-source actions: in a
 * sheet on phones, or in the split view's pane on wide screens.
 */
export default function ResultSheet({
    result: current,
    savedIds,
    onClose,
    onToggleSaved,
    onNotify,
    onMoreLike,
    variant = "sheet",
}: ResultSheetProps) {
    // Hold on to the last passage so the sheet still has content to show
    // while it animates out after `result` goes back to null.
    const [result, setResult] = useState(current);
    // Which passage is showing its surroundings; a newly opened one starts
    // collapsed.
    const [expandedFor, setExpandedFor] = useState<Result | null>(null);
    if (current && current !== result) setResult(current);
    if (!result) return null;

    const saved = isSaved(savedIds, result);
    const { id } = result;
    const expanded = !!id && expandedFor === result;
    const heading = headingFor(result);
    const metaLine = metaLineFor(result);

    const share = async () => {
        const data = {
            title: heading,
            text: `“${result.text}”\n— ${heading}`,
            url: result.url,
        };
        try {
            if (navigator.share) {
                await navigator.share(data);
                return;
            }
            await navigator.clipboard.writeText(`${data.text}\n${data.url}`);
            onNotify("Copied to clipboard");
        } catch {
            // The share sheet was dismissed, or the clipboard is unavailable.
        }
    };

    const action =
        "flex h-12 flex-1 items-center justify-center gap-2 rounded-full text-[15px] font-semibold transition-transform active:scale-95";
    const pill =
        "flex h-10 items-center gap-1.5 rounded-full bg-foreground/[0.08] px-4 text-[15px] font-semibold text-primary transition-transform active:scale-95";

    // The pane has no exit animation to hold the last passage for.
    const Container = variant === "pane" ? Pane : Sheet;
    if (variant === "pane" && !current) return null;

    return (
        <Container
            open={current !== null}
            onOpenChange={(open) => {
                if (!open) onClose();
            }}
            eyebrow={
                <>
                    <span className="text-foreground">
                        {SOURCE_LABELS[result.source]}
                    </span>
                    {metaLine && ` / ${metaLine}`}
                </>
            }
            title={heading}
            footer={
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={() => onToggleSaved(result)}
                        aria-pressed={saved}
                        className={cn(
                            action,
                            saved
                                ? "bg-[var(--glass-thumb)] text-primary"
                                : "bg-foreground/[0.08] text-foreground",
                        )}
                    >
                        <BookmarkIcon
                            className="h-[18px] w-[18px]"
                            fill={saved ? "currentColor" : "none"}
                        />
                        {saved ? "Saved" : "Save"}
                    </button>
                    <button
                        type="button"
                        onClick={share}
                        className={cn(
                            action,
                            "bg-foreground/[0.08] text-foreground",
                        )}
                    >
                        <ShareIcon className="h-[18px] w-[18px]" />
                        Share
                    </button>
                    <a
                        href={result.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                            action,
                            "flex-[1.25] bg-primary text-primary-foreground",
                        )}
                    >
                        Read
                        <ExternalLink className="h-[18px] w-[18px]" />
                    </a>
                </div>
            }
        >
            {expanded && id ? (
                <div className="select-text">
                    <PassageContext
                        result={{ ...result, id }}
                        textClassName="text-[19px] leading-[1.65]"
                        scrollToTarget
                    />
                </div>
            ) : (
                <p className="select-text whitespace-pre-line font-display text-[19px] leading-[1.65]">
                    {result.text}
                </p>
            )}
            {/* Both need the passage's id, which bookmarks saved before the
                API returned one don't have. */}
            {id && (
                <div className="mt-4 flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={() => setExpandedFor(expanded ? null : result)}
                        aria-expanded={expanded}
                        className={pill}
                    >
                        {expanded ? (
                            <ChevronUp className="h-4 w-4" />
                        ) : (
                            <ChevronDown className="h-4 w-4" />
                        )}
                        {expanded ? "Hide context" : contextLabel(result)}
                    </button>
                    <button
                        type="button"
                        onClick={() => onMoreLike(result)}
                        className={pill}
                    >
                        <Sparkles className="h-4 w-4" />
                        More like this
                    </button>
                </div>
            )}
        </Container>
    );
}
