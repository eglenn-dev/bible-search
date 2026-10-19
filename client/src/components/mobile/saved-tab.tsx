import { useMemo, useState } from "react";
import {
    Bookmark as BookmarkIcon,
    Copy,
    Download,
    Link2,
    Share as ShareIcon,
} from "lucide-react";
import type { Bookmark } from "@/lib/bookmarks";
import type { Result } from "@/lib/types";
import {
    downloadMarkdown,
    markdownFilename,
    passagesToMarkdown,
} from "@/lib/markdown-export";
import { useShareLink } from "@/lib/share";
import ResultCard from "./result-card";
import Sheet from "./sheet";

interface SavedTabProps {
    bookmarks: Bookmark[];
    /** Whether a passage is the one showing in the split view's pane. */
    isOpen: (result: Result) => boolean;
    onOpen: (result: Result) => void;
    onToggleSaved: (result: Result) => void;
    onNotify: (message: string) => void;
}

const savedDate = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
});

const row =
    "flex min-h-[60px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors active:bg-foreground/[0.06]";

export default function SavedTab({
    bookmarks,
    isOpen,
    onOpen,
    onToggleSaved,
    onNotify,
}: SavedTabProps) {
    const [exportOpen, setExportOpen] = useState(false);
    const results = useMemo(() => bookmarks.map((b) => b.result), [bookmarks]);
    // Built while the sheet is open so tapping "Share as a link" can open
    // the share sheet straight away (Safari won't after an await).
    const share = useShareLink(results, exportOpen);

    // Each action closes the sheet first so the toast isn't hidden under it.
    const copyMarkdown = async () => {
        setExportOpen(false);
        try {
            await navigator.clipboard.writeText(passagesToMarkdown(results));
            onNotify("Markdown copied");
        } catch {
            onNotify("Couldn’t copy");
        }
    };

    const download = () => {
        setExportOpen(false);
        downloadMarkdown(passagesToMarkdown(results), markdownFilename());
    };

    const shareLink = async () => {
        if (share.status === "pending") return;
        setExportOpen(false);
        if (share.status === "error") {
            onNotify(
                share.error.code === "too-long"
                    ? "Too many to fit in a link"
                    : "Couldn’t make a link",
            );
            return;
        }
        const url = share.url;
        try {
            if (navigator.share) {
                await navigator.share({ title: "Saved passages", url });
                return;
            }
            await navigator.clipboard.writeText(url);
            onNotify("Link copied");
        } catch {
            // The share sheet was dismissed, or the clipboard is unavailable.
        }
    };

    return (
        <div className="px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
            <div className="flex items-start justify-between gap-3">
                <h1 className="font-display text-[34px] font-semibold leading-tight text-foreground">
                    Saved
                </h1>
                {bookmarks.length > 0 && (
                    <button
                        type="button"
                        onClick={() => setExportOpen(true)}
                        aria-label="Export and share"
                        className="glass mt-1 flex h-11 w-11 flex-none items-center justify-center rounded-full text-primary transition-transform active:scale-90"
                    >
                        <ShareIcon className="h-5 w-5" />
                    </button>
                )}
            </div>
            <p className="mt-1 text-[15px] text-muted-foreground">
                {bookmarks.length === 0
                    ? "Kept on this device"
                    : `${bookmarks.length} ${
                          bookmarks.length === 1 ? "passage" : "passages"
                      } · kept on this device`}
            </p>

            {bookmarks.length === 0 ? (
                <div className="mt-20 flex flex-col items-center px-6 text-center">
                    <span className="glass mb-5 flex h-16 w-16 items-center justify-center rounded-full text-primary">
                        <BookmarkIcon className="h-7 w-7" />
                    </span>
                    <p className="text-[17px] font-semibold text-foreground">
                        Nothing saved yet
                    </p>
                    <p className="mt-1.5 max-w-[17rem] text-[15px] text-muted-foreground">
                        Tap the bookmark on any search result to keep it here.
                    </p>
                </div>
            ) : (
                <div className="mt-5 flex flex-col gap-3">
                    {bookmarks.map((bookmark) => (
                        <ResultCard
                            key={bookmark.id}
                            result={bookmark.result}
                            saved
                            selected={isOpen(bookmark.result)}
                            onOpen={() => onOpen(bookmark.result)}
                            onToggleSaved={() => onToggleSaved(bookmark.result)}
                            footnote={`Saved ${savedDate.format(bookmark.savedAt)}`}
                        />
                    ))}
                </div>
            )}

            <Sheet
                open={exportOpen}
                onOpenChange={setExportOpen}
                eyebrow={`${bookmarks.length} ${
                    bookmarks.length === 1 ? "passage" : "passages"
                }`}
                title="Export & share"
            >
                <div className="overflow-hidden rounded-[22px] bg-foreground/[0.06]">
                    <button type="button" onClick={copyMarkdown} className={row}>
                        <Copy className="h-5 w-5 flex-none text-primary" />
                        <span className="flex-1">
                            <span className="block text-[16px] text-foreground">
                                Copy as Markdown
                            </span>
                            <span className="block text-[13px] text-muted-foreground">
                                Quotes with references and links
                            </span>
                        </span>
                    </button>
                    <div className="ml-12 h-px bg-foreground/10" />
                    <button type="button" onClick={download} className={row}>
                        <Download className="h-5 w-5 flex-none text-primary" />
                        <span className="flex-1">
                            <span className="block text-[16px] text-foreground">
                                Download .md
                            </span>
                            <span className="block text-[13px] text-muted-foreground">
                                Save a file to Notes, Files or Drive
                            </span>
                        </span>
                    </button>
                    <div className="ml-12 h-px bg-foreground/10" />
                    <button type="button" onClick={shareLink} className={row}>
                        <Link2 className="h-5 w-5 flex-none text-primary" />
                        <span className="flex-1">
                            <span className="block text-[16px] text-foreground">
                                Share as a link
                            </span>
                            <span className="block text-[13px] text-muted-foreground">
                                Anyone with it can read and save these
                            </span>
                        </span>
                    </button>
                </div>
            </Sheet>
        </div>
    );
}
