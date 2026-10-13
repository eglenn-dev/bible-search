import { Bookmark as BookmarkIcon } from "lucide-react";
import type { Bookmark } from "@/lib/bookmarks";
import type { Result } from "@/lib/types";
import ResultCard from "./result-card";

interface SavedTabProps {
    bookmarks: Bookmark[];
    onOpen: (result: Result) => void;
    onToggleSaved: (result: Result) => void;
}

const savedDate = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
});

export default function SavedTab({
    bookmarks,
    onOpen,
    onToggleSaved,
}: SavedTabProps) {
    return (
        <div className="px-4 pt-[calc(env(safe-area-inset-top)+1.25rem)]">
            <h1 className="font-display text-[34px] font-semibold leading-tight text-foreground">
                Saved
            </h1>
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
                            onOpen={() => onOpen(bookmark.result)}
                            onToggleSaved={() => onToggleSaved(bookmark.result)}
                            footnote={`Saved ${savedDate.format(bookmark.savedAt)}`}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}
