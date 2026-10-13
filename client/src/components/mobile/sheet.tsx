import { useRef } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface SheetProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: React.ReactNode;
    /** Small line above the title. */
    eyebrow?: React.ReactNode;
    /** Pinned under the scrolling body (action buttons). */
    footer?: React.ReactNode;
    children: React.ReactNode;
}

// Past this many pixels of downward drag, letting go dismisses the sheet.
const DISMISS_DISTANCE = 110;

/**
 * Bottom sheet in the iOS 26 style: a floating glass panel inset from the
 * screen edges, dismissed by the close button, a tap outside, Escape, or by
 * dragging its header down. Radix Dialog supplies the focus trap, scroll lock
 * and labelling.
 */
export default function Sheet({
    open,
    onOpenChange,
    title,
    eyebrow,
    footer,
    children,
}: SheetProps) {
    const panelRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ startY: number; dy: number } | null>(null);

    const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        // Let the close button be a button.
        if ((e.target as HTMLElement).closest("button")) return;
        drag.current = { startY: e.clientY, dy: 0 };
        e.currentTarget.setPointerCapture(e.pointerId);
        if (panelRef.current) panelRef.current.style.transition = "none";
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!drag.current || !panelRef.current) return;
        // Follow the finger down; resist being pulled up past the rest position.
        const raw = e.clientY - drag.current.startY;
        const dy = raw > 0 ? raw : raw / 6;
        drag.current.dy = dy;
        panelRef.current.style.transform = `translateY(${dy}px)`;
    };

    const onPointerEnd = () => {
        const panel = panelRef.current;
        const state = drag.current;
        drag.current = null;
        if (!panel || !state) return;
        if (state.dy > DISMISS_DISTANCE) {
            // Leave the inline transform in place: the exit animation picks up
            // from the dragged position instead of snapping back first.
            onOpenChange(false);
            return;
        }
        panel.style.transition = "transform 0.3s cubic-bezier(0.3, 1.2, 0.5, 1)";
        panel.style.transform = "";
    };

    return (
        <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
            <DialogPrimitive.Portal>
                <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/25 duration-300 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0 dark:bg-black/45" />
                <DialogPrimitive.Content
                    ref={panelRef}
                    aria-describedby={undefined}
                    className={cn(
                        "mobile-sheet glass-thick fixed inset-x-2 z-50 mx-auto flex max-h-[min(86dvh,46rem)] max-w-lg flex-col rounded-[34px] text-foreground outline-none",
                        "bottom-[calc(env(safe-area-inset-bottom)+0.5rem)]",
                        "duration-300 ease-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-bottom data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom",
                    )}
                >
                    <div
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={onPointerEnd}
                        onPointerCancel={onPointerEnd}
                        className="flex-none touch-none px-5 pb-3 pt-2.5"
                    >
                        <div
                            aria-hidden="true"
                            className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-foreground/25"
                        />
                        <div className="flex items-start gap-3">
                            <div className="min-w-0 flex-1">
                                {eyebrow && (
                                    <div className="mb-0.5 text-[13px] text-muted-foreground">
                                        {eyebrow}
                                    </div>
                                )}
                                <DialogPrimitive.Title className="font-sans text-xl font-semibold leading-snug">
                                    {title}
                                </DialogPrimitive.Title>
                            </div>
                            <DialogPrimitive.Close
                                aria-label="Close"
                                className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-foreground/10 text-foreground transition-transform active:scale-90"
                            >
                                <X className="h-[18px] w-[18px]" strokeWidth={2.5} />
                            </DialogPrimitive.Close>
                        </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
                        {children}
                    </div>
                    {footer && (
                        <div className="flex-none border-t border-foreground/10 px-4 py-3">
                            {footer}
                        </div>
                    )}
                </DialogPrimitive.Content>
            </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
    );
}
