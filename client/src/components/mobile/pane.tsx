import { X } from "lucide-react";

// Same props as Sheet, so a caller can swap one for the other.
interface PaneProps {
    /** Unused: the caller unmounts the pane when there's nothing to show. */
    open?: boolean;
    onOpenChange: (open: boolean) => void;
    title: React.ReactNode;
    /** Small line above the title. */
    eyebrow?: React.ReactNode;
    /** Pinned under the scrolling body (action buttons). */
    footer?: React.ReactNode;
    children: React.ReactNode;
}

/**
 * Sheet's split-view twin: the same header, body and footer, laid out as a
 * floating glass column beside the results instead of a modal over them.
 */
export default function Pane({
    title,
    eyebrow,
    footer,
    onOpenChange,
    children,
}: PaneProps) {
    return (
        <section
            aria-label="Passage"
            className="glass-thick flex h-full flex-col overflow-hidden rounded-[30px] text-foreground"
        >
            <div className="flex flex-none items-start gap-3 px-5 pb-3 pt-5">
                <div className="min-w-0 flex-1">
                    {eyebrow && (
                        <div className="mb-0.5 text-[13px] text-muted-foreground">
                            {eyebrow}
                        </div>
                    )}
                    <h2 className="font-sans text-xl font-semibold leading-snug">
                        {title}
                    </h2>
                </div>
                <button
                    type="button"
                    onClick={() => onOpenChange(false)}
                    aria-label="Close passage"
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-foreground/10 text-foreground transition-transform active:scale-90"
                >
                    <X className="h-[18px] w-[18px]" strokeWidth={2.5} />
                </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
                {children}
            </div>
            {footer && (
                <div className="flex-none border-t border-foreground/10 px-4 py-3">
                    {footer}
                </div>
            )}
        </section>
    );
}
