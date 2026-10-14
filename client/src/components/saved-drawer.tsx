import { useEffect, useMemo, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Bookmark as BookmarkIcon, Trash2, XIcon } from "lucide-react";
import {
    removeBookmark,
    restoreBookmarks,
    useBookmarks,
    type Bookmark,
} from "@/lib/bookmarks";
import { headingFor } from "@/lib/result-display";
import { cn } from "@/lib/utils";
import ExportBar from "./export-bar";
import PassageItem from "./passage-item";

interface SavedButtonProps {
    count: number;
    onClick: () => void;
    /** Icon-and-count only, for the results header. */
    compact?: boolean;
}

/** Header control that opens the Saved panel; styled like ThemeToggle. */
export function SavedButton({ count, onClick, compact = false }: SavedButtonProps) {
    return (
        <button
            type="button"
            onClick={onClick}
            aria-haspopup="dialog"
            aria-label={`Saved passages (${count})`}
            title="Saved passages"
            className={cn(
                "inline-flex select-none items-center gap-2 rounded-md border border-input bg-card text-foreground transition-colors hover:border-primary",
                compact ? "px-2 py-1.5 text-sm" : "px-3.5 py-2 text-sm",
            )}
        >
            <BookmarkIcon
                className="h-4 w-4"
                fill={count > 0 ? "currentColor" : "none"}
            />
            {!compact && <span>Saved</span>}
            {count > 0 && (
                <span className="tabular-nums text-muted-foreground">
                    {count > 99 ? "99+" : count}
                </span>
            )}
        </button>
    );
}

interface SavedDrawerProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
}

const savedDate = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
});

/**
 * The desktop's Saved view: a panel that slides in from the right over the
 * page. A panel rather than its own route because the search lives in App's
 * state; opening Saved this way leaves the query and results exactly where
 * they were. Reads the same store as the mobile Saved tab, so the two layouts
 * (and other open tabs) always agree.
 */
export default function SavedDrawer({ open, onOpenChange }: SavedDrawerProps) {
    const bookmarks = useBookmarks();
    const results = useMemo(() => bookmarks.map((b) => b.result), [bookmarks]);
    // The last removal, offered back for a few seconds.
    const [removed, setRemoved] = useState<Bookmark | null>(null);

    useEffect(() => {
        if (!removed) return;
        const timer = setTimeout(() => setRemoved(null), 6000);
        return () => clearTimeout(timer);
    }, [removed]);

    useEffect(() => {
        if (!open) setRemoved(null);
    }, [open]);

    const remove = (bookmark: Bookmark) => {
        removeBookmark(bookmark.id);
        setRemoved(bookmark);
    };

    const count = bookmarks.length;

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/30 duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/50" />
                <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[34rem] flex-col border-l border-border bg-background text-foreground shadow-[var(--shadow-popover)] outline-none duration-300 ease-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:animate-in data-[state=open]:slide-in-from-right">
                    <div className="flex-none border-b border-border px-6 pb-4 pt-5">
                        <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                                <DialogPrimitive.Title className="font-display text-[28px] leading-tight text-foreground">
                                    Saved passages
                                </DialogPrimitive.Title>
                                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">
                                    {count === 0
                                        ? "Kept in this browser"
                                        : `${count} ${count === 1 ? "passage" : "passages"} · newest first · kept in this browser`}
                                </DialogPrimitive.Description>
                            </div>
                            <DialogPrimitive.Close
                                aria-label="Close"
                                className="-mr-2 flex h-9 w-9 flex-none items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                            >
                                <XIcon className="h-5 w-5" />
                            </DialogPrimitive.Close>
                        </div>
                        {count > 0 && (
                            <ExportBar
                                className="mt-4"
                                results={results}
                                shareable
                            />
                        )}
                    </div>

                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 py-6">
                        {count === 0 ? (
                            <div className="flex flex-col items-center px-6 pt-16 text-center">
                                <span className="mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-primary">
                                    <BookmarkIcon className="h-6 w-6" />
                                </span>
                                <p className="text-lg font-semibold text-foreground">
                                    Nothing saved yet
                                </p>
                                <p className="mt-1.5 max-w-xs text-[15px] text-muted-foreground">
                                    Click the bookmark beside any search result
                                    to keep it here. Saved passages also show
                                    up on your phone’s Saved tab when you use
                                    this browser.
                                </p>
                            </div>
                        ) : (
                            <div className="flex flex-col gap-7">
                                {bookmarks.map((bookmark) => (
                                    <PassageItem
                                        key={bookmark.id}
                                        result={bookmark.result}
                                        footnote={`Saved ${savedDate.format(bookmark.savedAt)}`}
                                        action={
                                            <button
                                                type="button"
                                                onClick={() => remove(bookmark)}
                                                aria-label={`Remove ${headingFor(bookmark.result)} from Saved`}
                                                title="Remove from Saved"
                                                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </button>
                                        }
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    <div
                        aria-live="polite"
                        // Always mounted (only collapsed) so the live region
                        // is in place before "Removed …" is announced.
                        className={cn(
                            "flex-none text-sm",
                            removed && "border-t border-border px-6 py-3",
                        )}
                    >
                        {removed && (
                            <div className="flex items-center gap-3">
                                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                                    Removed{" "}
                                    <span className="text-foreground">
                                        {headingFor(removed.result)}
                                    </span>
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        restoreBookmarks([removed]);
                                        setRemoved(null);
                                    }}
                                    className="font-semibold text-primary hover:underline"
                                >
                                    Undo
                                </button>
                            </div>
                        )}
                    </div>
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
