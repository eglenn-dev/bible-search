import { useState } from "react";
import {
    Bookmark as BookmarkIcon,
    ExternalLink,
    Share as ShareIcon,
} from "lucide-react";
import type { Result } from "@/lib/types";
import { bookmarkId } from "@/lib/bookmarks";
import { SOURCE_LABELS, headingFor, metaLineFor } from "@/lib/result-display";
import { cn } from "@/lib/utils";
import Sheet from "./sheet";

interface ResultSheetProps {
    /** The passage to show; null keeps the sheet closed. */
    result: Result | null;
    savedIds: Set<string>;
    onClose: () => void;
    onToggleSaved: (result: Result) => void;
    onNotify: (message: string) => void;
}

/** Full text of one passage, with bookmark / share / open-source actions. */
export default function ResultSheet({
    result: current,
    savedIds,
    onClose,
    onToggleSaved,
    onNotify,
}: ResultSheetProps) {
    // Hold on to the last passage so the sheet still has content to show
    // while it animates out after `result` goes back to null.
    const [result, setResult] = useState(current);
    if (current && current !== result) setResult(current);
    if (!result) return null;

    const saved = savedIds.has(bookmarkId(result));
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

    return (
        <Sheet
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
            <p className="select-text whitespace-pre-line font-display text-[19px] leading-[1.65]">
                {result.text}
            </p>
        </Sheet>
    );
}
